/**
 * Data Migration — Phase 5: Load to MongoDB
 *
 * 1. Drops all existing collections
 * 2. Inserts documents in dependency order
 * 3. Builds _migrationOldId → _id cross-reference map
 * 4. Replaces all string references with real ObjectIds
 * 5. Removes _migrationOldId and _migrationJobId from all documents
 *
 * Usage:
 *   cd ats-crm-backend
 *   npx ts-node scripts/data-migration/load-to-mongodb.ts
 */

import dotenv from 'dotenv';
import * as fs from 'fs';
import mongoose from 'mongoose';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DATA_DIR = path.resolve(process.cwd(), '..', 'new-data');
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/ats-crm';

// ─── Load all JSON files ──────────────────────────────────────────────────────

function loadJSON(fileName: string): any[] {
  const filePath = path.join(DATA_DIR, fileName + '.json');
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return Array.isArray(raw) ? raw : [raw];
}

// ─── Insert in dependency order ───────────────────────────────────────────────

const COLLECTION_DEFS = [
  { file: 'tags', collection: 'tags' },
  { file: 'users', collection: 'users' },
  { file: 'emailTemplates', collection: 'emailtemplates' },
  { file: 'pipelines', collection: 'pipelinetemplates' },
  { file: 'clients', collection: 'clients' },
  { file: 'jobs', collection: 'jobs' },
  { file: 'candidates', collection: 'candidates' },
  { file: 'applications', collection: 'applications' },
  { file: 'interviews', collection: 'interviews' },
  { file: 'emails', collection: 'emails' },
  { file: 'settings', collection: 'settings' },
  { file: 'activityLogs', collection: 'activitylogs' },
];

// NOTE: file names may differ from collection names.
// Fix mismatches based on actual model files:
// - pipelines.json → collection 'pipelinetemplates'
// - emailTemplates.json → collection 'emailtemplates'
// Other CRM collections (assignments, workentries, eodsubmissions, eodreminders, surveyreminders, performancereviews) have no data.

// ─── Reference fields that need ObjectId remapping ────────────────────────────

// For each collection, list fields that hold _migrationOldId references
const REFERENCE_MAP: Record<string, string[]> = {
  tags: ['createdBy'],
  users: ['createdBy', 'updatedBy', 'clientRef', 'candidateRef'],
  emailTemplates: ['createdBy', 'updatedBy'],
  pipelines: ['createdBy', 'updatedBy'],
  clients: ['createdBy', 'updatedBy'],
  jobs: ['clientId', 'createdBy', 'updatedBy', 'pipeline.templateId'], // tags[] already ObjectId?
  candidates: ['tags[]', 'createdBy', 'updatedBy', 'appliedJobId'],
  applications: [
    'candidateId',
    'jobId',
    'clientId',
    'approvedBy',
    'rejectedBy',
    'hiredBy',
    'createdBy',
    'updatedBy',
    'interviewId',
  ],
  interviews: [
    'applicationId',
    'candidateId',
    'jobId',
    'clientId',
    'organizerId',
    'interviewerIds[]',
  ],
  emails: [], // context holds candidateId etc as email string
  settings: [], // singleton, no refs
  activityLogs: ['resourceId', 'performedBy'],
};

// Fields where the value is an ARRAY of _migrationOldIds (need each item remapped)
const ARRAY_REFS = ['tags[]', 'interviewerIds[]'];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('Phase 5: Load to MongoDB');
  console.log('═══════════════════════════════════════');
  console.log('');
  console.log('MongoDB URI: ' + MONGODB_URI);
  console.log('Data dir:    ' + DATA_DIR);
  console.log('');

  // Connect
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;

  // Drop ALL existing collections
  console.log('🗑️  Dropping all existing collections...');
  const existing = await db.listCollections().toArray();
  for (const col of existing) {
    await db.dropCollection(col.name);
  }
  console.log(`   Dropped ${existing.length} collection(s)`);
  console.log('');

  // Insert collections in dependency order
  const idMap: Map<string, mongoose.Types.ObjectId> = new Map();

  for (const def of COLLECTION_DEFS) {
    const docs = loadJSON(def.file);
    if (docs.length === 0) {
      console.log(`⚠️  ${def.collection}: 0 documents — skipped`);
      continue;
    }

    // Record _migrationOldId before insert
    const oldIds: string[] = docs
      .map(doc => doc._migrationOldId)
      .filter(Boolean);

    // Insert using raw MongoDB driver (bypasses Mongoose validators)
    const col = db.collection(def.collection);
    const result = await col.insertMany(docs, { ordered: false });
    const insertedIds: Record<string, mongoose.Types.ObjectId> =
      result.insertedIds;

    // Map oldId → new _id
    let mapped = 0;
    Object.entries(insertedIds).forEach(([idx, newId]) => {
      const oldId = oldIds[parseInt(idx)];
      if (oldId) {
        idMap.set(oldId, newId);
        mapped++;
      }
    });

    console.log(
      `✅ ${def.collection}: ${docs.length} docs (${mapped} IDs mapped)`
    );
  }

  console.log('');
  console.log(`ID map: ${idMap.size} entries`);
  console.log('');

  // Phase 2: Replace all references with real ObjectIds
  console.log('🔄 Replacing references with ObjectIds...');

  // Build email → _id map from candidates collection for email-based
  // resolution. In the source data, applications reference candidates by
  // email (not by _migrationOldId), so the idMap alone cannot resolve them.
  const emailToCandidateId = new Map<string, mongoose.Types.ObjectId>();
  try {
    const candidateCol = db.collection('candidates');
    const allCandidates = await candidateCol
      .find({}, { projection: { _id: 1, email: 1 } })
      .toArray();
    for (const c of allCandidates) {
      if (c.email && typeof c.email === 'string') {
        emailToCandidateId.set(c.email.toLowerCase(), c._id);
      }
    }
    console.log(`   Email→Candidate map: ${emailToCandidateId.size} entries`);
  } catch {
    console.log(
      '   ⚠️  Could not build email→candidate map (candidates collection may not exist yet)'
    );
  }

  let totalUpdates = 0;

  for (const def of COLLECTION_DEFS) {
    const refFields = REFERENCE_MAP[def.file] || [];
    if (refFields.length === 0) continue;

    const col = db.collection(def.collection);
    const allDocs = await col.find({}).toArray();
    const bulkOps: any[] = [];

    for (const doc of allDocs) {
      const updates: Record<string, any> = {};
      let hasChanges = false;

      for (const field of refFields) {
        const isArray = field.endsWith('[]');
        const cleanField = isArray ? field.slice(0, -2) : field;

        // Handle nested dot-path fields (e.g. 'pipeline.templateId')
        const isNested = cleanField.includes('.');

        if (isArray) {
          // Array of old IDs → array of ObjectIds
          const arr = isNested
            ? undefined // nested arrays not supported
            : doc[cleanField];
          if (Array.isArray(arr) && arr.length > 0) {
            const mapped = arr
              .map((id: any) => (typeof id === 'string' ? idMap.get(id) : null))
              .filter(Boolean);
            if (
              mapped.length > 0 ||
              arr.some((id: any) => typeof id === 'string')
            ) {
              updates[cleanField] = mapped;
              hasChanges = true;
            }
          }
        } else if (isNested) {
          // Nested dot-path reference (e.g. pipeline.templateId)
          const parts = cleanField.split('.');
          let val = doc;
          for (const part of parts) {
            if (val && typeof val === 'object') val = val[part];
            else {
              val = undefined;
              break;
            }
          }

          if (val && typeof val === 'string') {
            const newId = idMap.get(val);
            if (newId) {
              updates[cleanField] = newId;
              hasChanges = true;
            } else {
              // Unresolvable nested reference → null it out
              updates[cleanField] = null;
              hasChanges = true;
            }
          }
        } else {
          // Single scalar reference
          const val = doc[cleanField];
          if (val && typeof val === 'string') {
            let newId = idMap.get(val);

            // Fallback: resolve email-based references (e.g. candidateId)
            // The source data uses emails instead of _migrationOldId for
            // some reference fields — look up the target collection by email.
            if (!newId && cleanField === 'candidateId' && val.includes('@')) {
              newId = emailToCandidateId.get(val.toLowerCase());
              if (newId) {
                console.log(
                  `   ✉️  Resolved candidateId email "${val}" → ${newId}`
                );
              }
            }

            if (newId) {
              updates[cleanField] = newId;
              hasChanges = true;
            } else if (
              cleanField.endsWith('Id') ||
              cleanField.endsWith('By') ||
              cleanField === 'resourceId' ||
              cleanField === 'performedBy' ||
              cleanField === 'organizerId' ||
              cleanField === 'clientRef' ||
              cleanField === 'candidateRef'
            ) {
              // Reference field with unresolvable ID → set null
              updates[cleanField] = null;
              hasChanges = true;
            }
          }
        }
      }

      if (hasChanges) {
        bulkOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: updates },
          },
        });
      }
    }

    if (bulkOps.length > 0) {
      await col.bulkWrite(bulkOps);
      totalUpdates += bulkOps.length;
      console.log(`   ${def.collection}: ${bulkOps.length} docs updated`);
    }
  }

  console.log(`   Total updates: ${totalUpdates}`);
  console.log('');

  // Phase 2.5: Generate ObjectIds for pipeline stages
  // The raw MongoDB driver does not auto-generate _id for subdocuments.
  // Every pipeline stage in every job must have a real ObjectId so the
  // frontend pipeline board can match applications to columns.
  console.log('🆔 Generating stage _id values...');
  const jobCol = db.collection('jobs');
  const allJobs = await jobCol
    .find({ pipeline: { $ne: null } }, { projection: { 'pipeline.stages': 1 } })
    .toArray();

  let stageIdsGenerated = 0;
  const stageBulkOps: any[] = [];
  for (const job of allJobs) {
    const stages = job.pipeline?.stages;
    if (!Array.isArray(stages)) continue;

    const stagesNeedingId = stages.filter(s => !s._id);
    if (stagesNeedingId.length === 0) continue;

    const setOps: Record<string, any> = {};
    for (let i = 0; i < stages.length; i++) {
      if (!stages[i]._id) {
        setOps[`pipeline.stages.${i}._id`] = new mongoose.Types.ObjectId();
        stageIdsGenerated++;
      }
    }

    stageBulkOps.push({
      updateOne: {
        filter: { _id: job._id },
        update: { $set: setOps },
      },
    });
  }

  if (stageBulkOps.length > 0) {
    await jobCol.bulkWrite(stageBulkOps);
  }
  console.log(`   ${stageIdsGenerated} stage _id values assigned`);

  // Phase 3: Remove migration metadata fields
  console.log('🧹 Removing migration metadata...');
  for (const def of COLLECTION_DEFS) {
    const col = db.collection(def.collection);
    const result = await col.updateMany(
      {},
      {
        $unset: {
          _migrationOldId: '',
          _migrationSource: '',
          _migrationJobId: '',
        },
      }
    );
    if (result.acknowledged) {
      console.log(`   ${def.collection}: cleaned`);
    }
  }

  // Phase 4: Handle emails special case — context.author etc are email strings, not ObjectIds
  // Those are already strings and left as-is — correct.

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('MIGRATION COMPLETE');
  console.log('═══════════════════════════════════════');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
