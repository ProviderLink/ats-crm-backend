import { connectDB } from '../config/db';
import '../config/env';
import ActivityLog from '../features/activity-logs/activityLog.model';
import Application from '../features/applications/application.model';
import Candidate, {
  normalizePhone,
} from '../features/candidates/candidate.model';
import logger from '../shared/utils/logger';

/**
 * One-time migration for the disposition feature.
 * Idempotent — safe to re-run.
 *
 * 1. Sets eligibilityStatus='eligible' and legalHold=false on all existing candidates.
 * 2. Backfills phoneNormalized on all candidates with phone numbers.
 * 3. For legacy rejected applications:
 *    - Sets closedAt = rejectedAt (we genuinely know when it closed)
 *    - Sets closedBy = rejectedBy (we genuinely know who)
 *    - Sets dispositionDate = rejectedAt
 *    - Copies rejectionReason to internalNotes (preserves historical note)
 *    - Attempts to reconstruct lastStage from the most recent stage_changed
 *      ActivityLog that occurred before the rejectedAt date. Only stageName
 *      is available in the ActivityLog metadata; stageId and assignedBy are
 *      left null. If no suitable stage_changed entry exists, lastStage stays
 *      null.
 *    - Leaves dispositionDestination = null (do NOT fabricate)
 *    - Leaves dispositionReasonId = null (no structured reason existed)
 */
async function run(): Promise<void> {
  await connectDB();
  logger.info('Starting disposition feature migration...');

  // ── 1. Set defaults on all candidates ──
  const candidateResult = await Candidate.updateMany(
    { eligibilityStatus: { $exists: false } },
    { $set: { eligibilityStatus: 'eligible', legalHold: false } }
  );
  logger.info(
    `Candidates updated with defaults: ${candidateResult.modifiedCount}`
  );

  // ── 2. Backfill phoneNormalized ──
  const candidatesWithPhone = await Candidate.find({
    phone: { $ne: '', $exists: true },
    phoneNormalized: null,
  });

  let phoneCount = 0;
  for (const cand of candidatesWithPhone) {
    const normalized = normalizePhone(cand.phone);
    if (normalized) {
      cand.phoneNormalized = normalized;
      await cand.save();
      phoneCount++;
    }
  }
  logger.info(`Phone normalized: ${phoneCount} candidates`);

  // ── 3. Backfill legacy rejected applications ──
  const legacyRejected = await Application.find({
    phase: 'rejected',
    closedAt: null,
    rejectedAt: { $ne: null },
  });

  let appCount = 0;
  for (const app of legacyRejected) {
    app.closedAt = app.rejectedAt;
    app.dispositionDate = app.rejectedAt;
    app.closedBy = app.rejectedBy;
    app.internalNotes = app.rejectionReason ?? null;
    // dispositionDestination and dispositionReasonId remain null

    // Reconstruct lastStage from the most recent stage_changed ActivityLog
    // that occurred before the application was rejected.
    if (app.rejectedAt && !app.lastStage) {
      const lastStageChanged = await ActivityLog.findOne({
        resourceType: 'application',
        resourceId: app._id,
        action: 'stage_changed',
        createdAt: { $lt: app.rejectedAt },
      }).sort({ createdAt: -1 });

      if (lastStageChanged) {
        const metadata = lastStageChanged.metadata as
          | Record<string, unknown>
          | undefined;
        const toStageName = metadata?.['to'] as string | undefined;
        if (toStageName) {
          app.lastStage = {
            stageName: toStageName,
          } as any;
        }
      }
    }

    await app.save();
    appCount++;
  }
  logger.info(`Legacy rejected applications backfilled: ${appCount}`);

  logger.info('Disposition feature migration complete.');
  process.exit(0);
}

run().catch(err => {
  logger.error('Migration failed:', err);
  process.exit(1);
});
