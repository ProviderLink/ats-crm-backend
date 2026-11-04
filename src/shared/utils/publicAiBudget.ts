import { Schema, model } from 'mongoose';

/** Most resumes parsed by AI for anonymous visitors per UTC day. */
const DAILY_PUBLIC_AI_LIMIT = 300;

const counterSchema = new Schema({
  day: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, expires: 7 * 24 * 60 * 60 },
});

const PublicAiCounter = model('PublicAiCounter', counterSchema);

/**
 * Count one public AI call against today's budget, across all IPs and dynos.
 * Returns false once the budget is spent.
 */
export async function takePublicAiSlot(): Promise<boolean> {
  const counter = await PublicAiCounter.findOneAndUpdate(
    { day: new Date().toISOString().slice(0, 10) },
    { $inc: { count: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return counter.count <= DAILY_PUBLIC_AI_LIMIT;
}
