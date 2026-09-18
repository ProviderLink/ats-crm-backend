import { connectDB } from '../config/db';
import '../config/env';
import ActivityLog from '../features/activity-logs/activityLog.model';
import mongoose from 'mongoose';
import logger from '../shared/utils/logger';

/**
 * Backfill the performer on derived candidate status changes.
 *
 * `applicationService.createApplication` / `approveApplication` /
 * `hireApplication` each call `candidateService.updateCandidateStatus(...)`
 * to mirror the application's phase onto the candidate. They did not pass the
 * acting user, so `updateCandidateStatus` wrote `performedBy: null`.
 *
 * The UI resolves an unattributed row to a system actor, which surfaced as
 * "System changed the candidate status from pending to approved" — misleading,
 * because a real person approved it. (Now fixed at all three call sites; this
 * script repairs the rows already written.)
 *
 * How the performer is recovered:
 *   Each derived status change is written in the same request as an
 *   application-level event on the SAME candidate that DOES carry the actor
 *   (`approved` / `hired` / `applied`). We look for such a sibling within a
 *   small time window and adopt its performer.
 *
 * Safety:
 *   - Dry run by default. Pass `--apply` to write.
 *   - Only touches rows with `performedBy: null`.
 *   - Only writes when the window contains EXACTLY ONE distinct performer. If a
 *     window is ambiguous the row is left alone and reported, never guessed.
 *   - Idempotent: a second run finds nothing left to repair.
 */
const APPLY = process.argv.includes('--apply');

/** How far either side of the status change to look for its sibling. */
const WINDOW_MS = 5000;

/** Actions that carry the acting user for the same request. */
const SIBLING_ACTIONS = ['approved', 'hired', 'applied', 'rejected', 'disposition'];

interface Repair {
  id: mongoose.Types.ObjectId;
  from: string | null;
  to: string | null;
  at: Date;
  performer: string;
  via: string;
}

interface Skipped {
  id: string;
  at: Date;
  reason: string;
}

async function run(): Promise<void> {
  await connectDB();
  logger.info(
    `Activity-log performer backfill (${APPLY ? 'APPLY' : 'DRY RUN'})...`
  );

  const coll = ActivityLog.collection;

  const orphans = await coll
    .find({
      resourceType: 'candidate',
      action: 'status_changed',
      performedBy: null,
    })
    .toArray();

  console.log('\n============= PERFORMER BACKFILL =============');
  console.log(`candidate status_changed rows without a performer: ${orphans.length}`);

  const repairs: Repair[] = [];
  const skipped: Skipped[] = [];

  for (const row of orphans) {
    const at = new Date(row.createdAt as Date);
    const siblings = await coll
      .find({
        resourceType: 'application',
        relatedId: row.resourceId,
        action: { $in: SIBLING_ACTIONS },
        performedBy: { $ne: null },
        createdAt: {
          $gte: new Date(at.getTime() - WINDOW_MS),
          $lte: new Date(at.getTime() + WINDOW_MS),
        },
      })
      .toArray();

    const performers = [...new Set(siblings.map(s => String(s.performedBy)))];

    if (performers.length === 1) {
      repairs.push({
        id: row._id as mongoose.Types.ObjectId,
        from: (row.metadata as Record<string, unknown> | null)?.['from'] as
          | string
          | null,
        to: (row.metadata as Record<string, unknown> | null)?.['to'] as
          | string
          | null,
        at,
        performer: performers[0],
        via: String(siblings[0].action),
      });
    } else {
      skipped.push({
        id: String(row._id),
        at,
        reason:
          performers.length === 0
            ? 'no sibling event in window'
            : `${performers.length} distinct performers — ambiguous`,
      });
    }
  }

  console.log(`\nrecoverable : ${repairs.length}`);
  console.log(`not recovered: ${skipped.length}`);

  const byTarget: Record<string, number> = {};
  for (const r of repairs) {
    const k = `${r.from} → ${r.to} (via ${r.via})`;
    byTarget[k] = (byTarget[k] || 0) + 1;
  }
  console.log('\n-- recoverable rows by transition --');
  Object.entries(byTarget)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));

  if (skipped.length > 0) {
    console.log('\n-- left untouched --');
    skipped.slice(0, 10).forEach(s =>
      console.log(`  ${s.at.toISOString()}  ${s.reason}`)
    );
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN — nothing written. Re-run with --apply to repair ${repairs.length} row(s).`
    );
    await mongoose.disconnect();
    return;
  }

  console.log('\n--- APPLYING ---');
  let updated = 0;
  for (const repair of repairs) {
    const result = await coll.updateOne(
      { _id: repair.id, performedBy: null },
      {
        $set: {
          performedBy: new mongoose.Types.ObjectId(repair.performer),
          'metadata.performerBackfilled': true,
          'metadata.performerBackfillSource': repair.via,
        },
      }
    );
    updated += result.modifiedCount ?? 0;
  }

  console.log('\n--- DONE ---');
  console.log(`rows updated            : ${updated}`);
  console.log(
    `rows still unattributed : ${await coll.countDocuments({
      resourceType: 'candidate',
      action: 'status_changed',
      performedBy: null,
    })}`
  );

  await mongoose.disconnect();
}

run().catch(err => {
  logger.error('Performer backfill failed', { err });
  process.exit(1);
});
