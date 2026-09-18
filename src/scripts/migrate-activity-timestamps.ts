import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import '../config/env';
import ActivityLog from '../features/activity-logs/activityLog.model';
import logger from '../shared/utils/logger';

/**
 * Normalise `createdAt` / `updatedAt` to real BSON dates on activity logs.
 *
 * Rows written before commit `fa6af42` (2026-07-06) stored these timestamps as
 * ISO-8601 **strings**; rows written after store real dates. MongoDB sorts and
 * compares across BSON types by type-order, not by value, so a collection with
 * both shapes is quietly unsafe:
 *
 *   - `sort({ createdAt: -1 })` puts ALL strings before ALL dates. It currently
 *     looks correct only because the newest string (2026-06-26) happens to
 *     predate the oldest date (2026-07-02). Any future backfill or import with
 *     an older string would silently reorder history.
 *   - `aggregate([{ $dateToString: ... }])` throws outright:
 *     `$dateToString parameter 'date' must be coercible to date`.
 *
 * Safety:
 *   - Dry run by default. Pass `--apply` to write.
 *   - Only touches string-typed values; rows already holding dates are skipped.
 *   - Values that cannot be parsed to a valid date are skipped and reported,
 *     never guessed at or nulled.
 *   - Idempotent: a second run finds nothing to update.
 */
const APPLY = process.argv.includes('--apply');

interface FieldPlan {
  field: string;
  count: number;
  unparseable: number;
  unparseableSamples: string[];
  min: string | null;
  max: string | null;
}

/**
 * Build a plan for one timestamp field. Reads in batches rather than loading
 * the whole set, so this stays comfortable if the collection grows.
 */
async function planField(
  coll: mongoose.mongo.Collection,
  field: string
): Promise<FieldPlan> {
  const filter = { [field]: { $type: 'string' } };
  const count = await coll.countDocuments(filter);

  let min: number | null = null;
  let max: number | null = null;
  let unparseable = 0;
  const unparseableSamples: string[] = [];

  const cursor = coll.find(filter, { projection: { [field]: 1 } });
  for await (const doc of cursor) {
    const raw = String((doc as Record<string, unknown>)[field]);
    const ts = new Date(raw).getTime();
    if (Number.isNaN(ts)) {
      unparseable++;
      if (unparseableSamples.length < 5) unparseableSamples.push(raw);
      continue;
    }
    if (min === null || ts < min) min = ts;
    if (max === null || ts > max) max = ts;
  }

  return {
    field,
    count,
    unparseable,
    unparseableSamples,
    min: min === null ? null : new Date(min).toISOString(),
    max: max === null ? null : new Date(max).toISOString(),
  };
}

async function run(): Promise<void> {
  await connectDB();
  logger.info(
    `Activity-log timestamp normalisation (${APPLY ? 'APPLY' : 'DRY RUN'})...`
  );

  const coll = ActivityLog.collection;
  const total = await coll.countDocuments({});

  console.log('\n=========== ACTIVITY LOG TIMESTAMP NORMALISATION ===========');
  console.log(`total rows                 : ${total}`);

  const plans: FieldPlan[] = [];
  for (const field of ['createdAt', 'updatedAt']) {
    plans.push(await planField(coll, field));
  }

  for (const plan of plans) {
    console.log(`\n--- ${plan.field} ---`);
    console.log(`  string-typed rows to fix : ${plan.count}`);
    console.log(
      `  parseable                : ${plan.count - plan.unparseable}`
    );
    console.log(`  unparseable (skipped)    : ${plan.unparseable}`);
    if (plan.min && plan.max) {
      console.log(`  value range              : ${plan.min} → ${plan.max}`);
    }
    if (plan.unparseableSamples.length > 0) {
      console.log(
        `  unparseable samples      : ${JSON.stringify(plan.unparseableSamples)}`
      );
    }
  }

  // Confirm there is genuinely no mixed-type ordering hazard left afterwards.
  const remaining = await coll.countDocuments({
    $or: [
      { createdAt: { $type: 'string' } },
      { updatedAt: { $type: 'string' } },
    ],
  });

  if (!APPLY) {
    console.log(
      `\nDRY RUN — nothing written. ${remaining} row(s) would be converted.`
    );
    console.log('Re-run with --apply to migrate.');
    await mongoose.disconnect();
    return;
  }

  console.log('\n--- APPLYING ---');
  let converted = 0;
  let skipped = 0;

  for (const plan of plans) {
    // One pass per field: read a batch, convert, write the converted values
    // back. Values that do not parse are left exactly as they are.
    const filter = { [plan.field]: { $type: 'string' } };
    const cursor = coll.find(filter, { projection: { [plan.field]: 1 } });

    const updates: Array<{
      updateOne: {
        filter: Record<string, unknown>;
        update: Record<string, unknown>;
      };
    }> = [];

    for await (const doc of cursor) {
      const raw = String((doc as Record<string, unknown>)[plan.field]);
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) {
        skipped++;
        continue;
      }
      updates.push({
        updateOne: {
          filter: { _id: doc._id, [plan.field]: raw },
          update: { $set: { [plan.field]: date } },
        },
      });
    }

    if (updates.length > 0) {
      const result = await coll.bulkWrite(updates, { ordered: false });
      converted += result.modifiedCount ?? 0;
    }
    console.log(
      `${plan.field.padEnd(12)} converted=${String(updates.length).padStart(5)}`
    );
  }

  console.log('\n--- DONE ---');
  console.log(`rows converted            : ${converted}`);
  console.log(`values skipped (unparseable): ${skipped}`);
  console.log(
    `remaining string-typed rows: ${await coll.countDocuments({
      $or: [
        { createdAt: { $type: 'string' } },
        { updatedAt: { $type: 'string' } },
      ],
    })}`
  );

  // Verify that date aggregation now works end-to-end.
  try {
    const months = await coll
      .aggregate<{ _id: string; n: number }>([
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            n: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    console.log(
      `\nverification: $dateToString now works across ${months.length} months`
    );
    for (const m of months) console.log(`  ${m._id}  ${m.n}`);
  } catch (error) {
    console.log(
      `\nverification: aggregation STILL FAILS -> ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  await mongoose.disconnect();
}

run().catch(err => {
  logger.error('Activity-log timestamp normalisation failed', { err });
  process.exit(1);
});
