/**
 * Data Repair — Fix null/email candidateId references in applications
 *
 * When the migration script (load-to-mongodb.ts) was run before the
 * email-based candidateId resolution fix, all application.candidateId
 * values were set to null because emails could not be resolved against
 * the _migrationOldId→ObjectId map.
 *
 * APPROACH: Delete all applications and re-insert from source data
 * with proper email-based candidate resolution. Other collections
 * (jobs, candidates, clients, etc.) are not touched.
 *
 * Usage:
 *   cd ats-crm-backend
 *   npx ts-node scripts/data-migration/repair-candidate-refs.ts
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

function resolveRef(
  val: string,
  field: string,
  idMap: Map<string, mongoose.Types.ObjectId>,
  emailToCandidateId: Map<string, mongoose.Types.ObjectId>
): mongoose.Types.ObjectId | null {
  // Try direct _migrationOldId lookup first
  const directId = idMap.get(val);
  if (directId) return directId;

  // Fallback: resolve email-based references (e.g. candidateId)
  if (field === 'candidateId' && val.includes('@')) {
    const emailId = emailToCandidateId.get(val.toLowerCase());
    if (emailId) return emailId;
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('Repair: Re-insert applications with fixed references');
  console.log('═══════════════════════════════════════');
  console.log('');

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;

  // ── Step 1: Build ID maps from existing collections ──────────────────────
  console.log('📧 Building email→candidate lookup...');
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
  console.log(`   ${emailToCandidateId.size} candidates`);

  // Build _migrationOldId → ObjectId maps for each collection
  // We need this to resolve jobId, clientId, approvedBy, createdBy, etc.
  const COLLECTIONS_FOR_IDMAP = [
    'tags',
    'users',
    'emailtemplates',
    'pipelinetemplates',
    'clients',
    'jobs',
    'candidates',
    'interviews',
  ];

  const idMap = new Map<string, mongoose.Types.ObjectId>();

  // Load source data to get _migrationOldId → (title/email) mapping,
  // then match to MongoDB documents by those properties.
  for (const colName of COLLECTIONS_FOR_IDMAP) {
    const sourceDocs = loadJSON(
      colName === 'pipelinetemplates' ? 'pipelines' : colName
    );
    if (sourceDocs.length === 0) continue;

    const mongoDocs = await db.collection(colName).find({}).toArray();

    for (const sd of sourceDocs) {
      const oldId = sd._migrationOldId as string;
      if (!oldId || idMap.has(oldId)) continue;

      // Match by email for candidates, by title for jobs/pipelines,
      // by name for clients/tags, by email for users
      let match: any = null;
      if (colName === 'candidates') {
        const email = (sd.email as string)?.toLowerCase();
        match = mongoDocs.find(
          d => (d.email as string)?.toLowerCase() === email
        );
      } else if (colName === 'jobs' || colName === 'pipelinetemplates') {
        const title = (sd.title || sd.name) as string;
        match = mongoDocs.find(d => {
          const dt = (d.title || d.name) as string;
          return dt?.toLowerCase().trim() === title?.toLowerCase().trim();
        });
      } else if (colName === 'clients') {
        const name = sd.companyName as string;
        match = mongoDocs.find(
          d =>
            (d.companyName as string)?.toLowerCase().trim() ===
            name?.toLowerCase().trim()
        );
      } else if (colName === 'users') {
        const email = (sd.email as string)?.toLowerCase();
        match = mongoDocs.find(
          d => (d.email as string)?.toLowerCase() === email
        );
      } else {
        const name = sd.name as string;
        match = mongoDocs.find(
          d =>
            (d.name as string)?.toLowerCase().trim() ===
            name?.toLowerCase().trim()
        );
      }

      if (match) {
        idMap.set(oldId, match._id);
      }
    }
    console.log(
      `   ${colName}: ${sourceDocs.length} source → ${idMap.size} total in map`
    );
  }
  console.log('');

  // ── Step 2: Delete all existing applications ─────────────────────────────
  console.log('🗑️  Deleting all applications...');
  const deleteResult = await db.collection('applications').deleteMany({});
  console.log(`   Deleted ${deleteResult.deletedCount} application(s)`);
  console.log('');

  // ── Step 3: Prepare & insert applications with resolved refs ─────────────
  console.log('📄 Loading & resolving application references...');
  const sourceApps = loadJSON('applications');
  const resolvedApps: any[] = [];
  let unresolvable = 0;

  const REF_FIELDS = [
    'candidateId',
    'jobId',
    'clientId',
    'approvedBy',
    'rejectedBy',
    'hiredBy',
    'createdBy',
    'updatedBy',
    'interviewId',
  ];

  for (const sa of sourceApps) {
    const doc: Record<string, any> = { ...sa };

    // Remove _migrationOldId (will be cleaned later anyway)
    delete doc._migrationOldId;
    delete doc._migrationSource;
    delete doc._migrationJobId;

    let allResolved = true;

    for (const field of REF_FIELDS) {
      const val = doc[field];
      if (!val || typeof val !== 'string') continue;

      // For approvedBy/rejectedBy/hiredBy/createdBy/updatedBy → try idMap
      // For interviewId → try idMap
      // For candidateId → try idMap first, then email fallback
      // For jobId/clientId → try idMap

      const resolved = resolveRef(val, field, idMap, emailToCandidateId);
      if (resolved) {
        doc[field] = resolved;
      } else {
        doc[field] = null;
        if (
          field === 'candidateId' ||
          field === 'jobId' ||
          field === 'clientId'
        ) {
          allResolved = false;
        }
      }
    }

    // Handle currentStage nested object
    if (doc.currentStage && typeof doc.currentStage === 'object') {
      const stage = doc.currentStage as Record<string, any>;
      if (stage.assignedBy && typeof stage.assignedBy === 'string') {
        const resolved = idMap.get(stage.assignedBy);
        stage.assignedBy = resolved ?? null;
      }
      // stageId is already a valid ObjectId string from pipeline stages
    }

    if (!allResolved) {
      unresolvable++;
    }
    resolvedApps.push(doc);
  }

  console.log(
    `   ${resolvedApps.length} apps prepared (${unresolvable} with unresolvable refs)`
  );
  console.log('');

  // ── Step 4: Insert ───────────────────────────────────────────────────────
  console.log('📥 Inserting applications...');
  if (resolvedApps.length > 0) {
    await db
      .collection('applications')
      .insertMany(resolvedApps, { ordered: false });
  }
  console.log(`   Inserted ${resolvedApps.length} application(s)`);
  console.log('');

  // ── Step 5: Verify ───────────────────────────────────────────────────────
  console.log('🧪 Verification...');
  const total = await db.collection('applications').countDocuments();
  const nullCand = await db
    .collection('applications')
    .countDocuments({ candidateId: null });
  const emailCand = (
    await db
      .collection('applications')
      .find({ candidateId: { $type: 'string' } })
      .toArray()
  ).filter(a => {
    const cid = a.candidateId;
    return typeof cid === 'string' && (cid as string).includes('@');
  }).length;

  console.log(`   Total applications: ${total}`);
  console.log(`   candidateId = null:  ${nullCand}`);
  console.log(`   candidateId = email: ${emailCand}`);

  if (nullCand === 0 && emailCand === 0) {
    console.log(
      '   ✅ All applications have valid ObjectId candidateId references'
    );
  } else {
    console.log('   ⚠️  Some references could not be resolved');
  }

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('REPAIR COMPLETE');
  console.log('═══════════════════════════════════════');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
