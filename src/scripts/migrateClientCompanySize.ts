/**
 * One-off migration: normalize companySize on all existing Client documents.
 *
 * Logic mirrors the pre('save') / pre('findOneAndUpdate') middleware in
 * client.model.ts:
 *   - remap known typos (e.g. "1-50" → "11-50")
 *   - unset / fall back to default any value not in COMPANY_SIZE_ENUM
 *
 * Idempotent and guarded by a `migrations` ledger so it runs only once
 * per environment. Re-running on subsequent startups is a cheap no-op
 * that stays silent. Also runnable standalone:
 *   npx ts-node src/scripts/migrateClientCompanySize.ts
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import {
  COMPANY_SIZE_ENUM,
  normalizeCompanySize,
} from '../features/clients/client.model';
import logger from '../shared/utils/logger';

const MIGRATION_KEY = 'clientCompanySize:1';
const FALLBACK: (typeof COMPANY_SIZE_ENUM)[number] = '1-10';

async function hasRunMigration(key: string): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) return false;
  const doc = await db.collection('migrations').findOne({ _id: key });
  return !!doc;
}

async function markMigrationRun(
  key: string,
  fixed: number,
  scanned: number
): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;
  await db.collection('migrations').updateOne(
    { _id: key },
    {
      $set: {
        key,
        scanned,
        fixed,
        ranAt: new Date(),
      },
    },
    { upsert: true }
  );
}

export async function migrateClientCompanySize(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    logger.warn('[migrateClientCompanySize] No db connection — skipping');
    return;
  }

  if (await hasRunMigration(MIGRATION_KEY)) {
    // Already applied — silent no-op.
    return;
  }

  const collection = db.collection('clients');
  const allDocs = await collection
    .find({}, { projection: { _id: 1, companySize: 1 } })
    .toArray();

  if (!allDocs.length) {
    await markMigrationRun(MIGRATION_KEY, 0, 0);
    return;
  }

  const validSet = new Set<string>(COMPANY_SIZE_ENUM);
  let fixed = 0;
  let scanned = 0;

  for (const doc of allDocs) {
    scanned += 1;
    const raw = (doc as { companySize?: unknown }).companySize;
    if (validSet.has(String(raw))) continue; // already canonical

    const normalized = normalizeCompanySize(raw);
    const next = normalized ?? FALLBACK;

    await collection.updateOne(
      { _id: doc._id },
      { $set: { companySize: next } }
    );
    fixed += 1;
    logger.info(
      `[migrateClientCompanySize] ${doc._id}: "${String(raw)}" → "${next}"`
    );
  }

  logger.info(`[migrateClientCompanySize] Scanned=${scanned}, fixed=${fixed}`);
  await markMigrationRun(MIGRATION_KEY, fixed, scanned);
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(env.MONGODB_URI);
    await migrateClientCompanySize();
    await mongoose.disconnect();
    process.exit(0);
  })().catch(error => {
    console.error('migrateClientCompanySize failed:', error);
    process.exit(1);
  });
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(env.MONGODB_URI);
    await migrateClientCompanySize();
    await mongoose.disconnect();
    process.exit(0);
  })().catch(error => {
    console.error('migrateClientCompanySize failed:', error);
    process.exit(1);
  });
}
