/**
 * Stage Restoration — Restore pipeline stages from old activity logs
 *
 * Analyzes old-data activityLogs for "candidate_stage_changed" events,
 * cross-references with pipeline templates to determine each candidate's
 * true pipeline stage, and updates MongoDB currentStage accordingly.
 *
 * Usage:
 *   cd ats-crm-backend
 *   npx ts-node scripts/data-migration/restore-stages.ts
 */

import dotenv from 'dotenv';
import * as fs from 'fs';
import mongoose from 'mongoose';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DATA_DIR = path.resolve(process.cwd(), '..', 'old-data');
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/ats-crm';

function loadJSON(fileName: string): any[] {
  const filePath = path.join(DATA_DIR, fileName + '.json');
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return Array.isArray(raw) ? raw : [raw];
}

// ─── Stage resolution mapping ────────────────────────────────────────────────
// Built from exhaustive analysis of old-data activityLogs.
// email → stageName (the correct historical stage for this candidate)

const STAGE_MAP: Record<string, string> = {
  'arjeanjoygarcia@gmail.com': 'Invited to Zoom',
  'carnajedohmangelo@gmail.com': 'Add to Talent Pool',
  'christinabasiwal21@gmail.com': 'Invited to Zoom',
  'crisjustinetaganahan98@gmail.com': 'Invited to Zoom',
  'devilla.hannah@yahoo.com': 'Group Interview Scheduled',
  'fhernroseamatorio@gmail.com': 'Candidates Placed',
  'harmonicaeraayque@gmail.com': 'Invited to Zoom',
  'hayahaidee@gmail.com': 'Invite to Client Group Interview',
  'james.gaite17@gmail.com': 'Invited to Zoom',
  'juliethfaith@gmail.com': 'Intro E-mail Sent',
  'katrina.macaraeg@gmail.com': 'Initial Zoom Scheduled',
  'lesliemarie07111986@gmail.com': 'Intro E-mail Sent',
  'liannecontrano.ptrp@gmail.com': 'Invited to Zoom',
  'markpenido12@gmail.com': 'Zoom Screening',
  'mohajar.abdullah.72@gmail.com': 'Invited to Zoom',
  'montasapril@gmail.com': 'Moved To Candidate Pool',
  'mtheresa10229@gmail.com': 'Offer Extended',
  'mujar.ethylrose@gmail.com': 'Candidates Placed',
  'patriciaaquisap12@gmail.com': 'Invited to Zoom',
  'perezivyg.24@gmail.com': 'Invite to Client Group Interview',
  'petwyn0608@gmail.com': 'Accepted',
  'pluksarahnasouri@gmail.com': 'Shortlisted Candidates',
  'priahannes@gmail.com': 'Group Interview Scheduled',
  'roselleybanez@gmail.com': 'Initial Zoom Scheduled',
  'serami1398@gmail.com': 'Group Interview Scheduled',
  'tmmcamposano@gmail.com': 'Client Group Interview',
  'trisha.sanao@gmail.com': 'Group Interview Scheduled',
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('Stage Restoration — From Old Activity Logs');
  console.log('═══════════════════════════════════════');
  console.log('');

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;

  // Step 1: Build MongoDB candidate email → _id
  console.log('📧 Building candidate lookup...');
  const allCandidates = await db
    .collection('candidates')
    .find({}, { projection: { _id: 1, email: 1 } })
    .toArray();
  const emailToCandidateId = new Map<string, mongoose.Types.ObjectId>();
  for (const c of allCandidates) {
    if (c.email && typeof c.email === 'string') {
      emailToCandidateId.set(c.email.toLowerCase(), c._id);
    }
  }
  console.log(`   ${emailToCandidateId.size} candidates indexed`);
  console.log('');

  // Step 2: For each mapped email, find application → job → pipeline → stage
  console.log('🔧 Restoring stages...');
  let restored = 0;
  let skippedNoApp = 0;
  let skippedNoStage = 0;
  const bulkOps: any[] = [];

  // Cache: job pipeline stages
  const jobPipelineCache = new Map<string, any[]>();

  for (const [email, stageName] of Object.entries(STAGE_MAP)) {
    const candidateId = emailToCandidateId.get(email);
    if (!candidateId) {
      console.log(`   ⚠️  Candidate not found: ${email}`);
      continue;
    }

    // Find all applications for this candidate
    const applications = await db
      .collection('applications')
      .find({ candidateId, phase: 'approved' })
      .toArray();

    if (applications.length === 0) {
      skippedNoApp++;
      continue;
    }

    for (const app of applications) {
      const jobId = String(app.jobId);

      // Get job pipeline stages (cached)
      let stages = jobPipelineCache.get(jobId);
      if (!stages) {
        const job = await db
          .collection('jobs')
          .findOne(
            { _id: new mongoose.Types.ObjectId(jobId) },
            { projection: { 'pipeline.stages': 1 } }
          );
        stages = (job?.pipeline?.stages || []) as any[];
        // Sort by order
        stages.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
        jobPipelineCache.set(jobId, stages);
      }

      if (stages.length === 0) {
        skippedNoStage++;
        continue;
      }

      // Find the matching stage in this job's pipeline
      const targetStage = stages.find(
        (s: any) =>
          (s.name as string).toLowerCase().trim() ===
          stageName.toLowerCase().trim()
      );

      if (!targetStage) {
        // Stage name doesn't exist in this job's pipeline.
        // This happens when the candidate's stage was from a different
        // pipeline template. Leave them in first stage (already set).
        console.log(
          `   ⚠️  Stage "${stageName}" not in pipeline for app ${app._id} — keeping first stage`
        );
        skippedNoStage++;
        continue;
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: app._id },
          update: {
            $set: {
              currentStage: {
                stageId: targetStage._id,
                stageName: targetStage.name,
                assignedAt: new Date(),
                assignedBy: null,
              },
            },
          },
        },
      });
      restored++;
    }
  }

  if (bulkOps.length > 0) {
    const result = await db.collection('applications').bulkWrite(bulkOps);
    console.log(`   Bulk write: ${result.modifiedCount} updated`);
  }
  console.log(`   ✅ Restored: ${restored}`);
  console.log(`   ⚠️  Skipped (no app): ${skippedNoApp}`);
  console.log(`   ⚠️  Skipped (stage not in pipeline): ${skippedNoStage}`);
  console.log('');

  // Step 3: Verify
  console.log('🧪 Verification...');
  let withStage = 0;
  let inFirstStage = 0;
  const apps = await db
    .collection('applications')
    .find({ phase: 'approved' })
    .toArray();

  for (const app of apps) {
    if (!app.currentStage || !app.currentStage.stageId) {
      continue;
    }
    const jobId = String(app.jobId);
    let stages = jobPipelineCache.get(jobId);
    if (!stages) {
      const job = await db
        .collection('jobs')
        .findOne(
          { _id: new mongoose.Types.ObjectId(jobId) },
          { projection: { 'pipeline.stages': 1 } }
        );
      stages = (job?.pipeline?.stages || []) as any[];
      stages.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      jobPipelineCache.set(jobId, stages);
    }
    if (stages.length === 0) continue;

    const firstStageId = String(stages[0]._id);
    const currentStageId = String(app.currentStage.stageId);
    if (currentStageId === firstStageId) {
      inFirstStage++;
    } else {
      withStage++;
    }
  }

  console.log(`   In first stage: ${inFirstStage}`);
  console.log(`   In other stage: ${withStage}`);
  console.log('');

  console.log('═══════════════════════════════════════');
  console.log('STAGE RESTORATION COMPLETE');
  console.log('═══════════════════════════════════════');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
