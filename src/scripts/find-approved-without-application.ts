/**
 * Find candidates whose `status` is 'approved' but who have no approved-phase
 * application.
 *
 * These are the source of the dashboard "In Pipeline" vs Candidates page
 * "In Pipeline" discrepancy: the Candidates page counts candidates with an
 * approved application, whereas `candidate.status` can be 'approved' without
 * a matching application (e.g. approved at the candidate level, or a stale
 * status left over from a rejected/withdrawn application).
 *
 * Read-only — this script only reports, it never mutates data.
 *
 * Usage:
 *   npx ts-node src/scripts/find-approved-without-application.ts
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI!);

  const db = mongoose.connection.db!;

  const candidates = await db
    .collection('candidates')
    .find({ status: 'approved' })
    .project({ firstName: 1, lastName: 1, email: 1, status: 1, createdAt: 1 })
    .toArray();

  const approvedApps = await db
    .collection('applications')
    .find({ phase: 'approved' })
    .project({ candidateId: 1, jobId: 1 })
    .toArray();

  const approvedCandidateIds = new Set(
    approvedApps.map(a => String(a.candidateId))
  );

  const stale = candidates.filter(
    c => !approvedCandidateIds.has(String(c._id))
  );

  console.log(`\nCandidates with status 'approved': ${candidates.length}`);
  console.log(`Applications with phase 'approved': ${approvedApps.length}`);
  console.log(
    `Approved candidates WITHOUT an approved application: ${stale.length}\n`
  );

  for (const c of stale) {
    const name =
      `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || '(no name)';
    console.log(`  - ${name} <${c.email ?? 'no email'}>  id=${String(c._id)}`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
