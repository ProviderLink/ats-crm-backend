/**
 * Comprehensive Data Repair — Final Cleanup
 *
 * Handles ALL data integrity issues in one atomic run:
 *
 *   Step 1: Fix applications — drop & re-insert from source
 *           Maps source apps to MongoDB jobs via unique (title, status, clientName)
 *   Step 2: Generate ObjectId for every pipeline stage in every job
 *   Step 3: Assign default pipeline template to jobs without one
 *   Step 4: Set currentStage = first stage for every approved application
 *   Step 5: Verify all collections are clean (no nulls, no undefined, no Firestore IDs)
 *
 * Usage:
 *   cd ats-crm-backend
 *   npx ts-node scripts/data-migration/repair-final.ts
 */

import dotenv from 'dotenv';
import * as fs from 'fs';
import mongoose from 'mongoose';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DATA_DIR = path.resolve(process.cwd(), '..', 'new-data');
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/ats-crm';

function loadJSON(fileName: string): any[] {
  const filePath = path.join(DATA_DIR, fileName + '.json');
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return Array.isArray(raw) ? raw : [raw];
}

function clientNameById(clients: any[], oldId: string): string {
  const c = clients.find(c => c._migrationOldId === oldId);
  return (c?.companyName || '').toLowerCase().trim();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('FINAL REPAIR — Complete Data Cleanup');
  console.log('═══════════════════════════════════════');
  console.log('');

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Build all lookup maps
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('📋 Building lookup maps...');

  // 1a: email → candidate ObjectId
  const mongoCandidates = await db
    .collection('candidates')
    .find({}, { projection: { _id: 1, email: 1 } })
    .toArray();
  const emailToCandidateId = new Map<string, mongoose.Types.ObjectId>();
  for (const c of mongoCandidates) {
    if (c.email && typeof c.email === 'string') {
      emailToCandidateId.set(c.email.toLowerCase(), c._id);
    }
  }
  console.log(`   email→candidate: ${emailToCandidateId.size}`);

  // 1b: _migrationOldId → MongoDB ObjectId for clients, users, tags
  const idMap = new Map<string, mongoose.Types.ObjectId>();
  const sourceClients = loadJSON('clients');
  const mongoClients = await db
    .collection('clients')
    .find({}, { projection: { _id: 1, companyName: 1 } })
    .toArray();

  for (const sc of sourceClients) {
    const oldId = sc._migrationOldId as string;
    if (!oldId) continue;
    const match = mongoClients.find(
      m =>
        (m.companyName as string)?.toLowerCase().trim() ===
        (sc.companyName as string)?.toLowerCase().trim()
    );
    if (match) idMap.set(oldId, match._id);
  }

  for (const su of loadJSON('users')) {
    const oldId = su._migrationOldId as string;
    if (!oldId || idMap.has(oldId)) continue;
    const match = (
      await db
        .collection('users')
        .find({}, { projection: { _id: 1, email: 1 } })
        .toArray()
    ).find(
      m =>
        (m.email as string)?.toLowerCase() ===
        (su.email as string)?.toLowerCase()
    );
    if (match) idMap.set(oldId, match._id);
  }

  for (const st of loadJSON('tags')) {
    const oldId = st._migrationOldId as string;
    if (!oldId || idMap.has(oldId)) continue;
    const match = (
      await db
        .collection('tags')
        .find({}, { projection: { _id: 1, name: 1 } })
        .toArray()
    ).find(
      m =>
        (m.name as string)?.toLowerCase().trim() ===
        (st.name as string)?.toLowerCase().trim()
    );
    if (match) idMap.set(oldId, match._id);
  }

  // Interviews
  for (const si of loadJSON('interviews')) {
    const oldId = si._migrationOldId as string;
    if (!oldId || idMap.has(oldId)) continue;
    const match = (
      await db
        .collection('interviews')
        .find({}, { projection: { _id: 1, title: 1 } })
        .toArray()
    ).find(
      m =>
        (m.title as string)?.toLowerCase().trim() ===
        (si.title as string)?.toLowerCase().trim()
    );
    if (match) idMap.set(oldId, match._id);
  }

  // 1c: Source job (Firestore ID) → MongoDB job ObjectId
  //     Uses UNIQUE fingerprint: (title, status, clientName)
  const sourceJobs = loadJSON('jobs');
  const mongoJobsAll = await db
    .collection('jobs')
    .find({}, { projection: { _id: 1, title: 1, status: 1, clientId: 1 } })
    .toArray();

  const mongoJobByFp = new Map<string, mongoose.Types.ObjectId>();
  for (const mj of mongoJobsAll) {
    const c = mongoClients.find(cl => String(cl._id) === String(mj.clientId));
    const cn = ((c?.companyName as string) || '').toLowerCase().trim();
    const fp = `${(mj.title as string).toLowerCase().trim()}||${mj.status}||${cn}`;
    mongoJobByFp.set(fp, mj._id);
  }

  const sourceJobToMongo = new Map<string, mongoose.Types.ObjectId>();
  for (const sj of sourceJobs) {
    const oldId = sj._migrationOldId as string;
    if (!oldId) continue;
    const cn = clientNameById(sourceClients, sj.clientId as string);
    const fp = `${(sj.title as string).toLowerCase().trim()}||${sj.status}||${cn}`;
    const mongoId = mongoJobByFp.get(fp);
    if (mongoId) {
      sourceJobToMongo.set(oldId, mongoId);
      idMap.set(oldId, mongoId);
    }
  }
  console.log(
    `   source job→mongo: ${sourceJobToMongo.size}/${sourceJobs.length}`
  );
  console.log(`   total idMap: ${idMap.size}`);
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Drop & re-insert applications
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('🔄 Re-inserting applications from source...');
  await db.collection('applications').deleteMany({});
  console.log('   Deleted all existing applications');

  const resolvedApps: any[] = [];
  let badJobId = 0,
    badCandId = 0,
    badClientId = 0;

  for (const sa of loadJSON('applications')) {
    const doc: Record<string, any> = { ...sa };
    delete doc._migrationOldId;
    delete doc._migrationSource;
    delete doc._migrationJobId;

    // jobId
    const mongoJobId = sourceJobToMongo.get(sa.jobId as string);
    if (mongoJobId) {
      doc.jobId = mongoJobId;
    } else {
      doc.jobId = null;
      badJobId++;
    }

    // candidateId
    const scid = sa.candidateId as string;
    let mongoCandId = idMap.get(scid) ?? null;
    if (!mongoCandId && scid?.includes('@')) {
      mongoCandId = emailToCandidateId.get(scid.toLowerCase()) ?? null;
    }
    if (mongoCandId) {
      doc.candidateId = mongoCandId;
    } else {
      doc.candidateId = null;
      badCandId++;
    }

    // clientId
    const mongoClientId = idMap.get(sa.clientId as string) ?? null;
    if (mongoClientId) {
      doc.clientId = mongoClientId;
    } else {
      doc.clientId = null;
      badClientId++;
    }

    // user refs
    for (const f of [
      'approvedBy',
      'rejectedBy',
      'hiredBy',
      'createdBy',
      'updatedBy',
    ]) {
      const v = sa[f] as string | undefined;
      if (v) doc[f] = idMap.get(v) ?? null;
    }
    if (sa.interviewId) {
      doc.interviewId = idMap.get(sa.interviewId as string) ?? null;
    }

    // Clean Firestore stageId
    if (doc.currentStage?.stageId) {
      const sid = doc.currentStage.stageId;
      if (typeof sid === 'string' && !sid.match(/^[0-9a-f]{24}$/i)) {
        doc.currentStage = null;
      }
    }

    resolvedApps.push(doc);
  }

  console.log(`   Prepared ${resolvedApps.length} apps`);
  if (badJobId) console.log(`   ⚠️  ${badJobId} bad jobId`);
  if (badCandId) console.log(`   ⚠️  ${badCandId} bad candidateId`);
  if (badClientId) console.log(`   ⚠️  ${badClientId} bad clientId`);

  await db
    .collection('applications')
    .insertMany(resolvedApps, { ordered: false });
  console.log(`   ✅ Inserted ${resolvedApps.length}`);
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Generate ObjectId for every pipeline stage
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('🆔 Generating stage _id values...');
  const jobsWithPipeline = await db
    .collection('jobs')
    .find({ pipeline: { $ne: null } })
    .toArray();

  let stageIdsGen = 0;
  const stageOps: any[] = [];
  for (const job of jobsWithPipeline) {
    const stages = job.pipeline?.stages;
    if (!Array.isArray(stages)) continue;
    const setOps: Record<string, any> = {};
    for (let i = 0; i < stages.length; i++) {
      if (!stages[i]._id) {
        setOps[`pipeline.stages.${i}._id`] = new mongoose.Types.ObjectId();
        stageIdsGen++;
      }
    }
    if (Object.keys(setOps).length) {
      stageOps.push({
        updateOne: { filter: { _id: job._id }, update: { $set: setOps } },
      });
    }
  }
  if (stageOps.length) await db.collection('jobs').bulkWrite(stageOps);
  console.log(`   ${stageIdsGen} stage _id values assigned`);
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Assign default pipeline to jobs without one
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('🔗 Assigning pipelines to jobs without one...');
  const defaultTemplate = await db
    .collection('pipelinetemplates')
    .findOne({ isDefault: true, isActive: true });

  if (!defaultTemplate) {
    console.log('   ⚠️  No default template found');
  } else {
    const noPipeline = await db
      .collection('jobs')
      .find({
        $or: [
          { pipeline: null },
          { 'pipeline.stages': null },
          { 'pipeline.stages': { $size: 0 } },
        ],
      })
      .toArray();

    if (noPipeline.length) {
      const tplStages = (defaultTemplate.stages || []).map((s: any) => ({
        name: s.name,
        color: s.color || '#3b82f6',
        order: s.order,
        isActive: s.isActive ?? true,
        icon: s.icon || 'ClipboardList',
        _id: new mongoose.Types.ObjectId(),
      }));
      await db.collection('jobs').bulkWrite(
        noPipeline.map(j => ({
          updateOne: {
            filter: { _id: j._id },
            update: {
              $set: {
                pipeline: {
                  templateId: defaultTemplate._id,
                  stages: tplStages,
                },
              },
            },
          },
        }))
      );
      console.log(
        `   ${noPipeline.length} job(s) assigned pipeline (${defaultTemplate.name})`
      );
    } else {
      console.log('   ✅ All jobs already have pipelines');
    }
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Set currentStage = first stage for all approved applications
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('📌 Setting currentStage for approved applications...');
  const appsToStage = await db
    .collection('applications')
    .find({ phase: 'approved', currentStage: null })
    .toArray();

  if (appsToStage.length) {
    const jobIds = [...new Set(appsToStage.map(a => String(a.jobId)))];
    const jobs = await db
      .collection('jobs')
      .find({ _id: { $in: jobIds.map(id => new mongoose.Types.ObjectId(id)) } })
      .project({ _id: 1, 'pipeline.stages': 1 })
      .toArray();

    const firstStageByJob = new Map<
      string,
      { stageId: mongoose.Types.ObjectId; stageName: string }
    >();
    for (const j of jobs) {
      const stages = ((j.pipeline?.stages || []) as any[]).sort(
        (a, b) => (a.order || 0) - (b.order || 0)
      );
      if (stages.length) {
        firstStageByJob.set(String(j._id), {
          stageId: stages[0]._id,
          stageName: stages[0].name,
        });
      }
    }

    const ops: any[] = [];
    let staged = 0,
      skipped = 0;
    for (const a of appsToStage) {
      const fs = firstStageByJob.get(String(a.jobId));
      if (!fs) {
        skipped++;
        continue;
      }
      ops.push({
        updateOne: {
          filter: { _id: a._id },
          update: {
            $set: {
              currentStage: {
                stageId: fs.stageId,
                stageName: fs.stageName,
                assignedAt: new Date(),
                assignedBy: null,
              },
            },
          },
        },
      });
      staged++;
    }
    if (ops.length) await db.collection('applications').bulkWrite(ops);
    console.log(`   Staged: ${staged} | Skipped: ${skipped}`);
  } else {
    console.log('   ✅ No applications need staging');
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Verification
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════');
  console.log('VERIFICATION');
  console.log('═══════════════════════════════════════');
  console.log('');

  let clean = true;
  const check = (label: string, count: number, ok: boolean) => {
    console.log(`${label}: ${count} ${ok ? '✅' : '❌'}`);
    if (!ok) clean = false;
  };

  check(
    '1. candidateId null',
    await db.collection('applications').countDocuments({ candidateId: null }),
    false
  );
  check(
    '2. candidateId email',
    (
      await db
        .collection('applications')
        .find({ candidateId: { $type: 'string' } })
        .toArray()
    ).filter(a => (a.candidateId as string).includes('@')).length,
    false
  );
  check(
    '3. jobId null',
    await db.collection('applications').countDocuments({ jobId: null }),
    false
  );
  check(
    '4. clientId null',
    await db.collection('applications').countDocuments({ clientId: null }),
    false
  );
  check(
    '5. approved apps currentStage=null',
    await db
      .collection('applications')
      .countDocuments({ phase: 'approved', currentStage: null }),
    false
  );

  const appsWithSt = await db
    .collection('applications')
    .find({ currentStage: { $ne: null } })
    .project({ 'currentStage.stageId': 1 })
    .toArray();
  const badIds = appsWithSt.filter(a => {
    const sid = a.currentStage?.stageId;
    return !sid || (typeof sid === 'string' && !sid.match(/^[0-9a-f]{24}$/i));
  }).length;
  check('6. broken stageId', badIds, false);

  const allJobsP = await db
    .collection('jobs')
    .find({ pipeline: { $ne: null } })
    .toArray();
  let sidOk = 0,
    sidBad = 0;
  for (const j of allJobsP)
    for (const s of j.pipeline?.stages || []) s._id ? sidOk++ : sidBad++;
  check('7. stages _id ok / bad', sidBad, false);
  console.log(`   (${sidOk} ok, ${sidBad} bad)`);

  check(
    '8. jobs without pipeline',
    await db
      .collection('jobs')
      .countDocuments({
        $or: [
          { pipeline: null },
          { 'pipeline.stages': null },
          { 'pipeline.stages': { $size: 0 } },
        ],
      }),
    false
  );

  // App distribution
  console.log('');
  console.log('9. App distribution per job:');
  const appCounts = await db
    .collection('applications')
    .aggregate([
      { $group: { _id: '$jobId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

  const jobTitles = new Map<string, string>();
  for (const j of await db
    .collection('jobs')
    .find({}, { projection: { title: 1 } })
    .toArray()) {
    jobTitles.set(String(j._id), j.title as string);
  }

  let aggregationIssue = false;
  const seenTitles = new Map<string, { jid: string; c: number }>();
  for (const ac of appCounts) {
    const title = jobTitles.get(String(ac._id)) || '?';
    const key = title.toLowerCase().trim();
    const prev = seenTitles.get(key);
    if (prev && prev.jid !== String(ac._id) && prev.c > 0 && ac.count > 0) {
      console.log(
        `   ⚠️  DUPLICATE TITLE "${title}" — verify manually (jobs: ${prev.jid}, ${ac._id})`
      );
      aggregationIssue = true;
    }
    seenTitles.set(key, { jid: String(ac._id), c: ac.count });
    console.log(`   ${ac.count} apps → ${title}`);
  }

  check(
    '10. duplicate candidate emails',
    (
      await db
        .collection('candidates')
        .aggregate([
          { $group: { _id: { $toLower: '$email' }, count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } },
        ])
        .toArray()
    ).length,
    false
  );

  const candIdSet = new Set(
    (
      await db
        .collection('candidates')
        .find({}, { projection: { _id: 1 } })
        .toArray()
    ).map(c => String(c._id))
  );
  const orphanApps = (
    await db
      .collection('applications')
      .find({}, { projection: { candidateId: 1 } })
      .toArray()
  ).filter(a => !candIdSet.has(String(a.candidateId)));
  check('11. orphan candidateId', orphanApps.length, false);

  const clientIdSet = new Set(
    (
      await db
        .collection('clients')
        .find({}, { projection: { _id: 1 } })
        .toArray()
    ).map(c => String(c._id))
  );
  const orphanJobs = (
    await db
      .collection('jobs')
      .find({}, { projection: { clientId: 1 } })
      .toArray()
  ).filter(j => !clientIdSet.has(String(j.clientId)));
  check('12. orphan job clientId', orphanJobs.length, false);

  console.log('');
  if (clean && !aggregationIssue) {
    console.log('═══════════════════════════════════════');
    console.log('✅ ALL CHECKS PASSED — DATA IS CLEAN');
    console.log('═══════════════════════════════════════');
  } else if (clean) {
    console.log('═══════════════════════════════════════');
    console.log('✅ DATA IS CLEAN');
    console.log('⚠️  Review duplicate-title jobs above manually');
    console.log('═══════════════════════════════════════');
  } else {
    console.log('═══════════════════════════════════════');
    console.log('❌ SOME CHECKS FAILED — review output above');
    console.log('═══════════════════════════════════════');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
