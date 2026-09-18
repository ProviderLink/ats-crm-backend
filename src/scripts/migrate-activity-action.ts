import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import '../config/env';
import ActivityLog from '../features/activity-logs/activityLog.model';
import logger from '../shared/utils/logger';

/**
 * One-time migration for activity logs written before commit `fa6af42`
 * (2026-07-06, "updated new system of activity logging").
 *
 * That commit renamed the event field from `type` to `action` but shipped no
 * data migration. Because Mongoose runs in default strict mode, rows still
 * holding only `type` are returned by the API with `action: undefined`, which
 * the UI renders as "logged a legacy entry".
 *
 * This script:
 *   1. Renames `type` -> `action` on every legacy row.
 *   2. Rewrites the historical token onto the current vocabulary, so the token
 *      matches what today's services emit (e.g. `updated_candidate` ->
 *      `updated`, `candidate_stage_changed` -> `stage_changed`).
 *
 * Safety:
 *   - Dry run by default. Pass `--apply` to write.
 *   - Idempotent: only rows with a missing/null `action` are touched, so a
 *     second run is a no-op.
 *   - Rows whose token has no modern equivalent (auth + email events) are
 *     SKIPPED and left untouched, because they are not entity events and the
 *     `email` resource type no longer exists. They stay exactly as they are.
 */
const APPLY = process.argv.includes('--apply');

/**
 * Historical token -> current token.
 *
 * `null` means "leave this row completely untouched" — used for events that
 * are not activity on an entity (logins, email delivery) and so have nowhere
 * sensible to land in the current vocabulary.
 *
 * Tokens that are already current are listed explicitly so they still get the
 * `type` -> `action` rename.
 */
const LEGACY_TOKEN_MAP: Record<string, string | null> = {
  // ── Not entity events: skip (needs a product decision) ──────────────
  login: null,
  sent_email: null,
  email_sent: null,
  email_read: null,
  email_resent: null,
  email_deleted: null,

  // ── Application ─────────────────────────────────────────────────────
  application_created: 'applied',
  created_application: 'applied',
  application_approved: 'approved',
  application_rejected: 'rejected',
  application_hired: 'hired',
  application_stage_moved: 'stage_changed',
  application_notes_updated: 'notes_updated',
  application_ai_score_updated: 'ai_score_updated',
  application_ai_validation_updated: 'ai_validation_updated',
  updated_application: 'updated',

  // ── Candidate ───────────────────────────────────────────────────────
  candidate_created: 'created',
  candidate_updated: 'updated',
  updated_candidate: 'updated',
  candidate_deleted: 'deleted',
  candidate_status_changed: 'status_changed',
  candidate_stage_changed: 'stage_changed',
  candidate_parsed_data_updated: 'parsed_data_updated',
  candidate_ai_score_updated: 'ai_score_updated',
  candidate_ai_validation_updated: 'ai_validation_updated',
  candidate_added_to_talent_pool: 'talent_pool_added',
  candidate_talent_pool_added: 'talent_pool_added',
  candidate_talent_pool_removed: 'talent_pool_removed',

  // ── Client ──────────────────────────────────────────────────────────
  client_created: 'created',
  created_client: 'created',
  client_updated: 'updated',
  updated_client: 'updated',
  client_deleted: 'deleted',
  client_contact_added: 'contact_added',
  contact_added: 'contact_added',
  client_contact_updated: 'contact_updated',
  client_contact_removed: 'contact_removed',
  client_crm_profile_updated: 'crm_profile_updated',
  client_note_added: 'note_added',
  client_note_updated: 'note_updated',
  client_note_deleted: 'note_deleted',

  // ── Job ─────────────────────────────────────────────────────────────
  job_created: 'created',
  created_job: 'created',
  job_updated: 'updated',
  updated_job: 'updated',
  job_deleted: 'deleted',
  job_status_changed: 'status_changed',
  job_closed: 'status_changed',
  job_pipeline_assigned: 'pipeline_changed',
  job_pipeline_changed: 'pipeline_changed',

  // ── Interview ───────────────────────────────────────────────────────
  interview_scheduled: 'interview_scheduled',
  scheduled_interview: 'interview_scheduled',
  interview_updated: 'interview_updated',
  interview_cancelled: 'interview_cancelled',
  interview_completed: 'interview_completed',
  interview_feedback_submitted: 'interview_feedback_submitted',

  // ── User / team ─────────────────────────────────────────────────────
  user_created: 'created',
  user_updated: 'updated',
  user_deactivated: 'deactivated',
  user_permissions_updated: 'permissions_updated',
  user_provisioned_va: 'provisioned_va',
  user_provisioned_client: 'provisioned_client',

  // ── Assignment ──────────────────────────────────────────────────────
  assignment_created: 'created',
  assignment_updated: 'updated',
  assignment_ended: 'ended',
  assignment_status_changed: 'status_changed',

  // ── Tag ─────────────────────────────────────────────────────────────
  tag_created: 'created',
  tag_updated: 'updated',
  tag_deleted: 'deleted',

  // ── Work entry ──────────────────────────────────────────────────────
  work_entry_created: 'created',
  work_entry_updated: 'updated',
  work_entry_deleted: 'deleted',

  // ── Performance review ──────────────────────────────────────────────
  performance_review_generated: 'review_generated',
  performance_review_completed: 'review_completed',

  // ── EOD / survey / settings ─────────────────────────────────────────
  eod_submitted: 'eod_submitted',
  survey_reminder_sent: 'survey_dispatched',
  settings_updated: 'settings_updated',

  // ── AI jobs ─────────────────────────────────────────────────────────
  ai_resume_parsing_completed: 'resume_parsing_completed',
  ai_resume_validation_completed: 'resume_validation_completed',
  ai_candidate_scoring_completed: 'candidate_scoring_completed',
  ai_candidacy_validation_completed: 'candidacy_validation_completed',
};

interface PlanRow {
  token: string;
  count: number;
  target: string | null;
  resourceTypes: string[];
}

async function buildPlan(): Promise<{ plan: PlanRow[]; total: number }> {
  const coll = ActivityLog.collection;

  const total = await coll.countDocuments({});
  const tokens = (await coll.distinct('type', {
    action: null,
  })) as unknown as Array<string | null>;

  const plan: PlanRow[] = [];
  for (const raw of tokens) {
    const token = raw === null || raw === undefined ? '' : String(raw);
    const count = await coll.countDocuments({ type: raw, action: null });
    const resourceTypes = (
      (await coll.distinct('resourceType', {
        type: raw,
        action: null,
      })) as unknown as string[]
    ).filter(Boolean);

    plan.push({
      token,
      count,
      target: token ? (LEGACY_TOKEN_MAP[token] ?? null) : null,
      resourceTypes: resourceTypes.slice(0, 4),
    });
  }

  plan.sort((a, b) => b.count - a.count);
  return { plan, total };
}

async function run(): Promise<void> {
  await connectDB();
  logger.info(
    `Activity-log legacy migration (${APPLY ? 'APPLY' : 'DRY RUN'})...`
  );

  const coll = ActivityLog.collection;
  const { plan, total } = await buildPlan();

  const migratable = plan.filter(r => r.target !== null);
  const skipped = plan.filter(r => r.target === null);
  const unmapped = migratable.filter(
    r => r.token !== '' && !(r.token in LEGACY_TOKEN_MAP)
  );

  const migrateRows = migratable.reduce((sum, r) => sum + r.count, 0);
  const skipRows = skipped.reduce((sum, r) => sum + r.count, 0);

  console.log(
    '\n================ LEGACY ACTIVITY LOG MIGRATION ================'
  );
  console.log(`total rows in collection        : ${total}`);
  console.log(`legacy rows (action missing)    : ${migrateRows + skipRows}`);
  console.log(`  will migrate (entity events)  : ${migrateRows}`);
  console.log(`  will skip   (non-entity)      : ${skipRows}`);
  console.log(`unrecognised tokens             : ${unmapped.length}`);

  console.log('\n--- WILL MIGRATE: legacy token -> current token ---');
  for (const row of migratable) {
    const arrow = row.token === row.target ? '=' : '→';
    console.log(
      `${String(row.count).padStart(5)}  ${row.token.padEnd(34)} ${arrow} ${row.target}`
    );
  }

  console.log('\n--- WILL SKIP: no modern equivalent ---');
  for (const row of skipped) {
    console.log(
      `${String(row.count).padStart(5)}  ${row.token.padEnd(34)} ` +
        `resourceType: ${row.resourceTypes.join(', ') || '(none)'}`
    );
  }

  if (unmapped.length > 0) {
    console.log('\n--- NOT IN MAP (left untouched) ---');
    for (const row of unmapped) {
      console.log(`${String(row.count).padStart(5)}  ${row.token}`);
    }
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to migrate.');
    await mongoose.disconnect();
    return;
  }

  console.log('\n--- APPLYING ---');
  let renamed = 0;
  let remapped = 0;

  for (const row of migratable) {
    // `$rename` cannot coexist with `$set` on the same field, so set the new
    // value and drop the old field explicitly.
    const update = {
      $set: { action: row.target },
      $unset: { type: '' },
    };
    const filter =
      row.token === ''
        ? { action: null, type: { $in: [null, ''] } }
        : { action: null, type: row.token };

    const result = await coll.updateMany(
      { ...filter, resourceId: { $nin: [null] } },
      update as Record<string, unknown>
    );
    const n = result.modifiedCount ?? 0;
    renamed += n;
    if (row.token !== row.target) remapped += n;

    console.log(
      `${String(n).padStart(5)}  ${(row.token || '(empty)').padEnd(34)} → ${row.target}`
    );
  }

  // Tokens absent from the map would otherwise be silently ignored.
  const allTokens = (await coll.distinct('action', {
    type: { $exists: true },
  })) as unknown as string[];
  if (allTokens.length > 0) {
    console.log(
      `\nWARNING: ${allTokens.length} legacy row(s) still have \`type\``
    );
  }

  console.log('\n--- DONE ---');
  console.log(`rows renamed type->action : ${renamed}`);
  console.log(`rows re-mapped to a token : ${remapped}`);
  console.log(`rows left untouched       : ${skipRows}`);
  console.log(
    `remaining legacy rows     : ${await coll.countDocuments({ action: null, type: { $exists: true } })}`
  );

  await mongoose.disconnect();
}

run().catch(err => {
  logger.error('Activity-log migration failed', { err });
  process.exit(1);
});
