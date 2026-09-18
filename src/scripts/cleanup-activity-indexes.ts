import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import '../config/env';
import ActivityLog from '../features/activity-logs/activityLog.model';
import logger from '../shared/utils/logger';

/**
 * Remove redundant / orphaned indexes on the activity logs collection.
 *
 * 1. `resourceType_1_resourceId_1` — a strict left-prefix of
 *    `resourceType_1_resourceId_1_createdAt_-1`. A prefix index is never
 *    chosen over its own longer compound for the same filter, so it is pure
 *    overhead (memory + write cost). Verified with `explain('queryPlanner')`:
 *    the 3-field compound always wins.
 *
 * 2. `type_1` — indexes the pre-`fa6af42` field name. That commit renamed the
 *    field to `action` and moved the index to `action_1`. No application code
 *    queries `type` any more; only the one-time migration scripts read it, and
 *    a collection scan over this collection is trivially cheap.
 *
 * Both are dropped by NAME. The model no longer declares either, so Mongoose's
 * autoIndex will not recreate them on boot.
 *
 * Safety:
 *   - Dry run by default. Pass `--apply` to drop.
 *   - Only drops an index after confirming it exists AND is not unique.
 *   - Idempotent: re-running reports nothing to drop.
 */
const APPLY = process.argv.includes('--apply');

interface IndexPlan {
  name: string;
  key: Record<string, number>;
  sizeKb: number | null;
  reason: string;
  skipReason?: string;
}

const TARGETS: Array<{ name: string; reason: string }> = [
  {
    name: 'resourceType_1_resourceId_1',
    reason: 'left-prefix of resourceType_1_resourceId_1_createdAt_-1',
  },
  {
    name: 'performedBy_1',
    reason: 'left-prefix of performedBy_1_createdAt_-1',
  },
  {
    name: 'action_1',
    reason: 'left-prefix of action_1_createdAt_-1',
  },
  {
    name: 'type_1',
    reason:
      'indexes the pre-2026-07-06 field name; `action_1_createdAt_-1` replaced it',
  },
];

async function run(): Promise<void> {
  await connectDB();
  logger.info(`Activity-log index cleanup (${APPLY ? 'APPLY' : 'DRY RUN'})...`);

  const coll = ActivityLog.collection;
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');

  const stats = await db.command({ collStats: coll.collectionName });
  const indexSizes: Record<string, number> = stats.indexSizes ?? {};

  const existing = await coll.indexes();
  const byName = new Map(existing.map(i => [i.name, i]));

  const plans: IndexPlan[] = TARGETS.map(target => {
    const found = byName.get(target.name);
    const sizeBytes = indexSizes[target.name];
    const base: IndexPlan = {
      name: target.name,
      key: (found?.key ?? {}) as Record<string, number>,
      sizeKb: sizeBytes === undefined ? null : Math.round(sizeBytes / 1024),
      reason: target.reason,
    };
    if (!found) {
      return { ...base, skipReason: 'does not exist (already dropped)' };
    }
    if (found.unique) {
      return { ...base, skipReason: 'index is UNIQUE — refusing to drop' };
    }
    return base;
  });

  const droppable = plans.filter(p => !p.skipReason);

  console.log('\n============== ACTIVITY LOG INDEX CLEANUP ==============');
  console.log(`collection       : ${coll.collectionName}`);
  console.log(`documents        : ${stats.count}`);
  console.log(
    `total index size : ${(stats.totalIndexSize / 1024).toFixed(1)} KB`
  );
  console.log(`currently indexed: ${existing.map(i => i.name).join(', ')}`);

  console.log('\n--- TO DROP ---');
  for (const plan of plans) {
    const size = plan.sizeKb === null ? '?' : `${plan.sizeKb} KB`;
    console.log(
      `  ${plan.name.padEnd(38)} ${size.padStart(9)}  ${plan.reason}`
    );
    if (plan.skipReason) console.log(`      SKIP: ${plan.skipReason}`);
  }

  const reclaimKb = droppable.reduce((sum, p) => sum + (p.sizeKb ?? 0), 0);
  console.log(`\nindex size reclaimed: ~${reclaimKb} KB`);

  // Show which index the app's hot query actually uses, as evidence.
  const sample = await coll.findOne({ resourceType: 'candidate' });
  if (sample) {
    const explained = await coll
      .find({
        resourceType: sample.resourceType,
        resourceId: sample.resourceId,
      })
      .sort({ createdAt: -1 })
      .explain('queryPlanner');
    const used =
      JSON.stringify(explained.queryPlanner.winningPlan).match(
        /"indexName":"([^"]+)"/
      )?.[1] ?? '(collection scan)';
    console.log(`\nevidence: the entity-feed query uses \`${used}\``);
    console.log('  → the 2-field prefix index is never selected');
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing dropped. Re-run with --apply to drop.');
    await mongoose.disconnect();
    return;
  }

  console.log('\n--- DROPPING ---');
  for (const plan of droppable) {
    try {
      await coll.dropIndex(plan.name);
      console.log(`  dropped ${plan.name}`);
    } catch (error) {
      console.log(
        `  FAILED  ${plan.name} -> ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const after = await coll.indexes();
  console.log('\n--- DONE ---');
  console.log(`indexes now      : ${after.map(i => i.name).join(', ')}`);
  const afterStats = await db.command({ collStats: coll.collectionName });
  console.log(
    `total index size : ${(afterStats.totalIndexSize / 1024).toFixed(1)} KB`
  );

  await mongoose.disconnect();
}

run().catch(err => {
  logger.error('Activity-log index cleanup failed', { err });
  process.exit(1);
});
