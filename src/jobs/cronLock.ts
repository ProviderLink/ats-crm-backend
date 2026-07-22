import { Document, Schema, model } from 'mongoose';

export interface ICronLockDocument extends Document {
  name: string;
  lockedAt: Date;
  instanceId: string;
}

const cronLockSchema = new Schema<ICronLockDocument>(
  {
    name: { type: String, required: true, unique: true },
    lockedAt: { type: Date, required: true },
    instanceId: { type: String, required: true },
  },
  { timestamps: false }
);

// Auto-delete locks older than 5 minutes (stale lock cleanup)
cronLockSchema.index({ lockedAt: 1 }, { expireAfterSeconds: 300 });

const CronLock = model<ICronLockDocument>('CronLock', cronLockSchema);
export default CronLock;

const LOCK_TTL_MS = 4 * 60 * 1000; // 4 minutes (TTL index clean up at 5)

/**
 * Acquire a distributed lock for a named cron job.
 * Returns true if lock was acquired, false if another instance holds it.
 */
export async function acquireLock(
  name: string,
  instanceId: string
): Promise<boolean> {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - LOCK_TTL_MS);

  try {
    // Atomically claim the lock — only succeeds if:
    // - no document exists for this name, OR
    // - existing document's lockedAt is older than the stale threshold
    const result = await CronLock.findOneAndUpdate(
      {
        name,
        $or: [
          { lockedAt: { $exists: false } },
          { lockedAt: { $lt: staleThreshold } },
        ],
      },
      { $set: { lockedAt: now, instanceId } },
      { upsert: true, new: true }
    );

    // If upsert created a new doc or updated a stale one, we own the lock
    return result.instanceId === instanceId;
  } catch (err: any) {
    // Duplicate key error (11000) — another instance won the race
    if (err?.code === 11000) return false;
    throw err;
  }
}

/**
 * Release a lock so the next scheduled run can proceed immediately.
 * Best-effort — the TTL index handles cleanup if this fails.
 */
export async function releaseLock(name: string): Promise<void> {
  try {
    await CronLock.deleteOne({ name });
  } catch {
    // Best-effort
  }
}
