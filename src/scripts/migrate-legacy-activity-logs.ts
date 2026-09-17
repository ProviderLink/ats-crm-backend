import { connectDB } from '../config/db';
import '../config/env';
import ActivityLog from '../features/activity-logs/activityLog.model';
import User from '../features/users/user.model';
import logger from '../shared/utils/logger';

import fs from 'fs';
import path from 'path';

/**
 * One-time migration for legacy activity log entries.
 *
 * Background: an earlier revision of the activity-log subsystem wrote a free-form
 * `type` field (e.g. `updated_candidate`, `sent_email`) instead of the current
 * enumerated `action` field (e.g. `updated`, `approved`). The UI reads `action`,
 * so the 1,462 documents without it render as a meaningless "Activity", and
 * server-side `?action=` filtering cannot match them.
 *
 * STEP 1 — `action` backfill (additive, default, reversible)
 *   Maps a legacy `type` onto its modern `action`. This only ADDS a field to
 *   documents that lack one; it overwrites nothing. The legacy `type` field is
 *   preserved, which is what makes the change reversible:
 *
 *     db.activitylogs.updateMany(
 *       { type: { $exists: true }, action: { $exists: true } },
 *       { $unset: { action: '' } }
 *     )
 *
 *   Types with no modern equivalent (e.g. `login`, `sent_email`) are skipped
 *   rather than mapped to a fabricated action.
 *
 * STEP 2 — `performedBy` re-attribution (DESTRUCTIVE, opt-in, NOT run by default)
 *   Collapses legacy attribution onto a single admin. This OVERWRITES the
 *   existing `performedBy` value and there is no undo unless a separate copy is
 *   kept first, so it requires `--reattribute-performer` in addition to
 *   `--apply`, and refuses to run unless a backup is explicitly acknowledged.
 *
 *   Note: no evidence was ever found that the legacy writer mis-attributed
 *   entries. The displayed name was verified to match the stored value, so this
 *   step is only appropriate if there is a separate reason to distrust the
 *   historical attribution. Without a backup it should generally be skipped.
 *
 * Usage:
 *   npm run migrate:legacy-activity-logs                  # dry run (no writes)
 *   ... --apply                                           # apply STEP 1 only
 *   ... --apply --reattribute-performer --no-backup-exists # destructive
 */

/** The admin that legacy attribution is collapsed onto. Matched by role and
 * exact name — NOT by email, because an unrelated client account shares the
 * `cyril@` local part. */
const TARGET_PERFORMER = { firstName: /^cyril$/i, lastName: /^thomas$/i };

/**
 * Legacy `type` -> modern `action`.
 *
 * Every value on the right must be a member of the `ActivityAction` union in
 * `features/activity-logs/activityLog.types.ts`. Types omitted here are
 * reported and skipped.
 */
const TYPE_TO_ACTION: Record<string, string> = {
  // ── Generic CRUD ────────────────────────────────────────────────
  created_job: 'created',
  job_created: 'created',
  created_client: 'created',
  client_created: 'created',
  candidate_created: 'created',
  application_created: 'created',
  created_application: 'created',
  tag_created: 'created',
  user_created: 'created',

  updated_candidate: 'updated',
  candidate_updated: 'updated',
  updated_application: 'updated',
  updated_job: 'updated',
  job_updated: 'updated',
  updated_client: 'updated',
  client_updated: 'updated',
  user_updated: 'updated',

  candidate_deleted: 'deleted',
  client_deleted: 'deleted',

  // ── Status / pipeline ───────────────────────────────────────────
  candidate_status_changed: 'status_changed',
  job_status_changed: 'status_changed',
  job_closed: 'status_changed',
  candidate_stage_changed: 'stage_changed',
  application_stage_moved: 'stage_changed',
  job_pipeline_assigned: 'pipeline_changed',

  // ── Application lifecycle ───────────────────────────────────────
  application_approved: 'approved',
  application_rejected: 'rejected',
  application_notes_updated: 'notes_updated',

  // ── Talent pool ─────────────────────────────────────────────────
  candidate_added_to_talent_pool: 'talent_pool_added',
  candidate_talent_pool_added: 'talent_pool_added',
  candidate_talent_pool_removed: 'talent_pool_removed',

  // ── AI / parsing ────────────────────────────────────────────────
  candidate_parsed_data_updated: 'parsed_data_updated',
  ai_resume_parsing_completed: 'parsed_data_updated',
  candidate_ai_score_updated: 'ai_score_updated',
  application_ai_score_updated: 'ai_score_updated',
  ai_candidate_scoring_completed: 'ai_score_updated',
  candidate_ai_validation_updated: 'ai_validation_updated',
  application_ai_validation_updated: 'ai_validation_updated',
  ai_resume_validation_completed: 'ai_validation_updated',
  ai_candidacy_validation_completed: 'ai_validation_updated',

  // ── Interviews ──────────────────────────────────────────────────
  interview_scheduled: 'interview_scheduled',
  scheduled_interview: 'interview_scheduled',
  interview_updated: 'interview_updated',
  interview_cancelled: 'interview_cancelled',
  interview_completed: 'interview_completed',
  interview_feedback_submitted: 'interview_feedback_submitted',

  // ── Client contacts / notes ─────────────────────────────────────
  client_contact_added: 'contact_added',
  contact_added: 'contact_added',
  client_contact_updated: 'contact_updated',
  client_note_added: 'note_added',

  // ── Settings ────────────────────────────────────────────────────
  settings_updated: 'settings_updated',
};

interface GroupStat {
  type: string | null;
  action: string | null;
  count: number;
  unmapped: boolean;
}

/**
 * Export every document that a subsequent write could touch, so the exact
 * pre-migration state can always be restored — even when no database snapshot
 * exists. Written to `migration-backups/` as newline-delimited JSON, which
 * streams safely and is easy to re-import:
 *
 *   mongoimport --uri="$MONGODB_URI" --collection=activitylogs \
 *     --file=<backup>.ndjson
 *
 * (Re-importing replaces documents by `_id`, restoring lost fields.)
 */
async function writeBackup(): Promise<string> {
  const docs = await ActivityLog.find({
    type: { $exists: true },
  }).lean();

  const dir = path.resolve(__dirname, '../../migration-backups');
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `activitylogs-${stamp}.ndjson`);

  fs.writeFileSync(
    file,
    docs.map(d => JSON.stringify(d)).join('\n') + '\n',
    'utf8'
  );

  logger.info(
    `Backup written: ${file} (${docs.length} documents, ` +
      `${(fs.statSync(file).size / 1024).toFixed(0)} KB)`
  );
  return file;
}

async function summarise(
  label: string,
  legacyTypes: string[]
): Promise<GroupStat[]> {
  const raw = await ActivityLog.aggregate<{ _id: string | null; n: number }>([
    { $match: { type: { $in: legacyTypes } } },
    { $group: { _id: '$type', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);

  const stats: GroupStat[] = raw.map(r => ({
    type: r._id,
    action: r._id ? (TYPE_TO_ACTION[r._id] ?? null) : null,
    count: r.n,
    unmapped: !r._id || !TYPE_TO_ACTION[r._id],
  }));

  logger.info(`\n${label}`);
  logger.info(`${'count'.padStart(6)}  ${'legacy type'.padEnd(34)} -> action`);
  logger.info('-'.repeat(66));
  for (const s of stats) {
    logger.info(
      `${String(s.count).padStart(6)}  ${String(s.type ?? '(null)').padEnd(34)} -> ${
        s.action ?? (s.unmapped ? 'SKIP (no equivalent)' : '?')
      }`
    );
  }
  return stats;
}

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const reattribute = process.argv.includes('--reattribute-performer');
  const backupAcknowledged = process.argv.includes('--no-backup-exists');

  await connectDB();
  logger.info(
    `Activity log legacy migration — ${apply ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`
  );

  // ── Resolve the target performer (only needed for the destructive step) ──
  let performer: {
    _id: unknown;
    firstName?: string;
    lastName?: string;
    email?: string;
  } | null = null;
  let performerId: unknown = null;

  if (reattribute) {
    const matches = await User.find({
      roles: 'admin',
      ...TARGET_PERFORMER,
    }).select('firstName lastName email');

    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly 1 admin matching Cyril Thomas, found ${matches.length}. ` +
          'Aborting rather than re-attributing to the wrong account.'
      );
    }
    performer = matches[0];
    performerId = matches[0]._id;
    logger.info(
      `Target performer: ${matches[0].firstName} ${matches[0].lastName} ` +
        `<${matches[0].email}> (${String(performerId)})`
    );
  } else {
    logger.info(
      'Step 2 (performedBy re-attribution) is DISABLED — pass ' +
        '--reattribute-performer to include it. No existing attribution will be touched.'
    );
  }

  // ── Discover legacy documents ────────────────────────────────────
  const legacyTypes = (await ActivityLog.distinct('type', {
    action: { $exists: false },
  })) as string[];

  const totalLegacy = await ActivityLog.countDocuments({
    action: { $exists: false },
  });
  const withPerformer = await ActivityLog.countDocuments({
    action: { $exists: false },
    performedBy: { $ne: null },
  });

  logger.info(`\nLegacy documents (no action field): ${totalLegacy}`);
  logger.info(`  performedBy set    : ${withPerformer}`);
  logger.info(`  performedBy null   : ${totalLegacy - withPerformer}`);

  const stats = await summarise('Proposed action backfill:', legacyTypes);

  const mappable = stats.filter(s => !s.unmapped && s.type);
  const unmapped = stats.filter(s => s.unmapped);
  const mappableCount = mappable.reduce((t, s) => t + s.count, 0);
  const unmappedCount = unmapped.reduce((t, s) => t + s.count, 0);

  logger.info(
    `\nTotals: ${mappableCount} mappable, ${unmappedCount} unmapped (left alone)`
  );

  if (reattribute) {
    // Step 2 overwrites data, so it is only safe once step 1's additive change
    // has been recorded. Nothing below this point may write without it.
    logger.info(
      '\nStep 2 is enabled — a backup will be written before any modification.'
    );
  }

  if (!apply) {
    logger.info('\nDRY RUN complete — no documents were modified.');
    logger.info('Re-run with --apply to write these changes.');
    process.exit(0);
  }

  // ── Backup FIRST, before any write ───────────────────────────────
  // Covers the additive backfill and the destructive re-attribution alike, so
  // the pre-migration state is always recoverable even with no DB snapshot.
  const backupFile = await writeBackup();
  logger.info(`\nRoll back with mongoimport if needed: ${backupFile}`);

  // ── 1. Backfill `action` (scoped per type, idempotent) ───────────
  let actionUpdates = 0;
  for (const s of mappable) {
    const res = await ActivityLog.updateMany(
      { type: s.type, action: { $exists: false } },
      { $set: { action: s.action } }
    );
    actionUpdates += res.modifiedCount;
  }
  logger.info(`\nBackfilled action on ${actionUpdates} documents.`);

  // ── 2. Re-attribute performedBy (DESTRUCTIVE, opt-in only) ───────
  // Scoped by `type`, which only legacy documents carry, so modern entries
  // are never touched. Runs after step 1 on purpose: the scope does not
  // depend on `action`, so the two steps cannot interfere.
  if (reattribute) {
    if (!backupAcknowledged) {
      logger.info(
        '\nStep 2 skipped — pass --no-backup-exists to confirm you have ' +
          'reviewed the backup file listed above and accept the overwrite.'
      );
    } else {
      let attributionUpdates = 0;
      for (const type of legacyTypes) {
        if (!type) continue;
        const res = await ActivityLog.updateMany(
          { type, performedBy: { $ne: null } },
          { $set: { performedBy: performerId } }
        );
        attributionUpdates += res.modifiedCount;
      }
      logger.info(
        `Re-attributed performedBy on ${attributionUpdates} documents to ` +
          `${performer?.firstName} ${performer?.lastName}.`
      );
    }
  } else {
    logger.info('\nStep 2 skipped — no performedBy values were modified.');
  }

  logger.info('\nMigration complete.');
  process.exit(0);
}

run().catch(err => {
  logger.error('Activity log legacy migration failed', err);
  process.exit(1);
});
