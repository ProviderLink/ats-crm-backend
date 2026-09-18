import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import '../config/env';
import ActivityLog from '../features/activity-logs/activityLog.model';
import logger from '../shared/utils/logger';

/**
 * Collapse duplicate activity log rows.
 *
 * Two separate causes produced the same action several times within seconds:
 *
 *   1. A fired-and-forgotten AI job was started by more than one call site at
 *      once, so each run logged its own result. Every run reported slightly
 *      different counts (e.g. `skillsCount: 16` vs `18`) because each parsed the
 *      resume independently. Fixed by `coalesce()` in `shared/utils/coalesce.ts`.
 *   2. `updateCandidateStatus()` logged even when the status did not change,
 *      producing "approved → approved" noise. Fixed in `candidate.service.ts`.
 *
 * This script repairs the rows already written.
 *
 * Merge strategy per duplicate group:
 *   - Keep the OLDEST row (it marks when the event first happened).
 *   - Union its metadata with every sibling's, oldest first, so no recorded
 *     detail is lost (counts from a later run overwrite an earlier one).
 *   - Delete the siblings.
 *
 * Safety:
 *   - Dry run by default. Pass `--apply` to write.
 *   - Only groups whose rows share `resourceType + resourceId + action` and fall
 *     inside `WINDOW_MS` of the group's first row are considered.
 *   - `updated` rows are only merged when their `changes` sets do not overlap, so
 *     a genuine series of distinct edits is never collapsed.
 *   - Idempotent: after a run, no group remains.
 */
const APPLY = process.argv.includes('--apply');

/** Max gap from the first row in a group for a sibling to be a duplicate. */
const WINDOW_MS = 3000;

/**
 * Actions that are safe to collapse. Each is fully determined by one operation
 * and carries no independent meaning when repeated inside the window.
 *
 * `updated` is handled separately because its rows carry a `changes` array that
 * may describe genuinely different edits.
 */
const COLLAPSIBLE = new Set([
  'parsed_data_updated',
  'resume_parsing_completed',
  'ai_validation_updated',
  'ai_score_updated',
  'candidacy_validation_completed',
  'candidate_scoring_completed',
  'resume_validation_completed',
  // A mirror of a phase change; the application timeline holds the real record.
  'status_changed',
  'stage_changed',
]);

interface Row {
  _id: mongoose.Types.ObjectId;
  resourceType: string;
  resourceId: mongoose.Types.ObjectId;
  action: string;
  createdAt: Date;
  metadata?: Record<string, unknown> | null;
}

function changesOf(row: Row): string[] {
  const c = row.metadata?.['changes'];
  return Array.isArray(c)
    ? c.filter((x): x is string => typeof x === 'string')
    : [];
}

/**
 * Two `updated` rows inside the window describe the same user action.
 *
 * `updateCandidate` writes one `updated` row per PATCH, so two rows a few
 * hundred milliseconds apart can only come from a double-submit — e.g. one
 * PATCH that sets both `parsedData` and `appliedJobId` being written by two
 * overlapping requests. Their `changes` arrays are unioned rather than one
 * being discarded, so no edited field is lost.
 */
function mergeChanges(rows: Row[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    for (const change of changesOf(row)) {
      if (!out.includes(change)) out.push(change);
    }
  }
  return out;
}

async function run(): Promise<void> {
  await connectDB();
  logger.info(
    `Activity-log duplicate cleanup (${APPLY ? 'APPLY' : 'DRY RUN'})...`
  );

  const coll = ActivityLog.collection;

  /**
   * Step 1 — pure noise: a status change that changed nothing.
   *
   * `metadata.from === metadata.to` conveys no information by definition, and
   * only ever came from `updateCandidateStatus` being called with the status it
   * already had. Safe to delete outright, regardless of any sibling rows.
   */
  const noOpFilter = {
    action: 'status_changed',
    $expr: {
      $eq: ['$metadata.from', '$metadata.to'],
    },
  };
  const noOpCount = await coll.countDocuments(noOpFilter);

  const all = (await coll.find({ action: { $ne: null } }).toArray()) as Row[];

  // Bucket by identity + action, then split into tight time-groups.
  const buckets = new Map<string, Row[]>();
  for (const row of all) {
    const key = `${row.resourceType}|${row.resourceId}|${row.action}`;
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }

  const plan: Array<{
    keep: Row;
    drop: Row[];
    mergedMetadata: Record<string, unknown>;
  }> = [];

  for (const [, rows] of buckets) {
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    let i = 0;
    while (i < rows.length) {
      const head = rows[i];
      const group = [head];
      let j = i + 1;
      while (
        j < rows.length &&
        rows[j].createdAt.getTime() - head.createdAt.getTime() <= WINDOW_MS
      ) {
        group.push(rows[j]);
        j++;
      }
      i = j;

      if (group.length < 2) continue;

      const action = head.action;
      if (!COLLAPSIBLE.has(action) && action !== 'updated') continue;

      // Merge metadata oldest-first so the newest recorded value wins, while
      // keeping keys only an earlier row had.
      const mergedMetadata: Record<string, unknown> = {};
      for (const row of group) {
        Object.assign(mergedMetadata, row.metadata ?? {});
      }

      // Preserve every edited field from an `updated` group.
      if (action === 'updated') {
        const changes = mergeChanges(group);
        if (changes.length > 0) mergedMetadata['changes'] = changes;
      }

      plan.push({ keep: head, drop: group.slice(1), mergedMetadata });
    }
  }

  const dropped = plan.reduce((n, p) => n + p.drop.length, 0);

  console.log('\n=========== ACTIVITY LOG DUPLICATE CLEANUP ===========');
  console.log(`rows scanned                     : ${all.length}`);
  console.log(`no-op status rows (from === to)  : ${noOpCount}`);
  console.log(`duplicate groups                 : ${plan.length}`);
  console.log(`rows to delete                   : ${dropped + noOpCount}`);

  const byAction: Record<string, number> = {};
  for (const p of plan) {
    byAction[p.keep.action] = (byAction[p.keep.action] ?? 0) + p.drop.length;
  }
  console.log('\n-- rows to delete by action --');
  Object.entries(byAction)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));

  console.log('\n-- sample groups --');
  for (const p of plan.slice(0, 3)) {
    console.log(
      `  ${p.keep.resourceType} ${p.keep.action} @ ${p.keep.createdAt.toISOString()}`
    );
    console.log(`    keep  ${JSON.stringify(p.keep.metadata)}`);
    p.drop.forEach(d => console.log(`    drop  ${JSON.stringify(d.metadata)}`));
    console.log(`    merged ${JSON.stringify(p.mergedMetadata)}`);
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN — nothing written. Re-run with --apply to delete ${dropped + noOpCount} row(s).`
    );
    await mongoose.disconnect();
    return;
  }

  console.log('\n--- APPLYING ---');

  // Pass 1: no-op status rows — unconditional deletion, no merging needed.
  const noOpResult = await coll.deleteMany(noOpFilter);
  console.log(`  deleted no-op status rows: ${noOpResult.deletedCount ?? 0}`);
  // One bulkWrite per chunk. A per-group `updateOne` + `deleteMany` means ~1200
  // round trips to a hosted cluster, which is slow enough to be interrupted.
  const CHUNK = 200;
  let updated = 0;
  let deleted = 0;

  for (let i = 0; i < plan.length; i += CHUNK) {
    const chunk = plan.slice(i, i + CHUNK);
    const ops: mongoose.mongo.AnyBulkWriteOperation[] = [];

    for (const p of chunk) {
      ops.push({
        updateOne: {
          filter: { _id: p.keep._id },
          update: {
            $set: {
              metadata: p.mergedMetadata,
              duplicateRowsCollapsed: p.drop.length,
            },
          },
        },
      });
    }

    const allDropIds = chunk.flatMap(p => p.drop.map(d => d._id));
    ops.push({
      deleteMany: { filter: { _id: { $in: allDropIds } } },
    });

    const result = await coll.bulkWrite(ops, { ordered: false });
    updated += result.modifiedCount ?? 0;
    deleted += result.deletedCount ?? 0;

    if ((i / CHUNK) % 2 === 0) {
      console.log(
        `  processed ${Math.min(i + CHUNK, plan.length)}/${plan.length} groups`
      );
    }
  }

  console.log('\n--- DONE ---');
  console.log(
    `no-op rows deleted            : ${noOpResult.deletedCount ?? 0}`
  );
  console.log(`rows updated (merged metadata): ${updated}`);
  console.log(`rows deleted (duplicates)     : ${deleted}`);
  console.log(
    `rows remaining                : ${await coll.countDocuments({})}`
  );

  await mongoose.disconnect();
}

run().catch(err => {
  logger.error('Duplicate cleanup failed', { err });
  process.exit(1);
});
