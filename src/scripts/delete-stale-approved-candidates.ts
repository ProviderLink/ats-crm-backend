/**
 * Permanently delete the "stale approved" candidates — candidates whose
 * `status` is 'approved' but who have no approved-phase application — along
 * with their related records and Cloudinary assets.
 *
 * Deletes, for each target candidate:
 *   - the candidate document
 *   - related records in every collection that references them by
 *     candidateId / candidateRef / vaId / relatedId / resourceId
 *   - Cloudinary assets: resume (raw), avatar (image), video intro (video)
 *
 * Dry-run (default) only reports. Pass --delete to actually delete.
 *
 * Usage:
 *   npx ts-node src/scripts/delete-stale-approved-candidates.ts           # dry-run
 *   npx ts-node src/scripts/delete-stale-approved-candidates.ts --delete  # delete
 */
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const DO_DELETE = process.argv.includes('--delete');

// Fields that may reference a candidate id across the various collections.
const CANDIDATE_REF_FIELDS = [
  'candidateId',
  'candidateRef',
  'candidate',
  'vaId',
  'relatedId',
  'resourceId',
] as const;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

/** Extract a Cloudinary public_id from a stored secure_url. */
function extractPublicId(
  url: string,
  resourceType: 'raw' | 'image' | 'video'
): string | null {
  const match = url.split('?')[0].match(/\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  let publicId = match[1];
  try {
    publicId = decodeURIComponent(publicId);
  } catch {
    // keep raw path if decoding fails
  }
  // Images/videos store their format separately; strip the extension.
  if (resourceType === 'image' || resourceType === 'video') {
    publicId = publicId.replace(/\.[^.]+$/, '');
  }
  return publicId;
}

interface CandidateDoc {
  _id: mongoose.Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email?: string;
  resumeUrl?: string;
  avatar?: string;
  videoIntroUrl?: string;
  videoIntroSource?: string;
  legalHold?: boolean;
}

async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI!);
  const db = mongoose.connection.db!;

  const candidates = (await db
    .collection('candidates')
    .find({ status: 'approved' })
    .project({
      firstName: 1,
      lastName: 1,
      email: 1,
      resumeUrl: 1,
      avatar: 1,
      videoIntroUrl: 1,
      videoIntroSource: 1,
      legalHold: 1,
    })
    .toArray()) as unknown as CandidateDoc[];

  const approvedApps = await db
    .collection('applications')
    .find({ phase: 'approved' })
    .project({ candidateId: 1 })
    .toArray();
  const approvedIds = new Set(approvedApps.map(a => String(a.candidateId)));

  const targets = candidates.filter(c => !approvedIds.has(String(c._id)));

  console.log(`\nCandidates with status 'approved': ${candidates.length}`);
  console.log(
    `Targets (approved, no approved application): ${targets.length}\n`
  );

  const ids = targets.map(t => String(t._id));
  const objectIds = ids.map(i => new mongoose.Types.ObjectId(i));

  // ── Report related records across all collections ──
  const collections = await db.listCollections().toArray();
  const refCounts = new Map<string, number>();
  for (const { name } of collections) {
    if (name.startsWith('system.')) continue;
    const col = db.collection(name);
    let count = 0;
    for (const field of CANDIDATE_REF_FIELDS) {
      count += await col.countDocuments({
        [field]: { $in: [...objectIds, ...ids] },
      });
    }
    if (count > 0) refCounts.set(name, count);
  }

  for (const c of targets) {
    const name =
      `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || '(no name)';
    const resumePid = c.resumeUrl ? extractPublicId(c.resumeUrl, 'raw') : null;
    const avatarPid = c.avatar ? extractPublicId(c.avatar, 'image') : null;
    const videoPid =
      c.videoIntroSource === 'cloudinary' && c.videoIntroUrl
        ? extractPublicId(c.videoIntroUrl, 'video')
        : null;

    console.log(
      `  - ${name} <${c.email ?? 'no email'}> id=${c._id}` +
        `${c.legalHold ? ' [LEGAL HOLD]' : ''}`
    );
    console.log(`      resume: ${resumePid ?? '(none)'}`);
    console.log(`      avatar: ${avatarPid ?? '(none)'}`);
    console.log(`      video:  ${videoPid ?? '(none)'}`);
  }

  console.log('\nRelated records (by collection):');
  if (refCounts.size === 0) {
    console.log('  (none)');
  } else {
    for (const [col, n] of refCounts) console.log(`  ${col}: ${n}`);
  }

  if (!DO_DELETE) {
    console.log(
      '\nDry-run complete — nothing deleted. Pass --delete to delete.'
    );
    await mongoose.disconnect();
    return;
  }

  console.log('\nDeleting…');
  let cloudinaryDeleted = 0;

  for (const c of targets) {
    const id = c._id;
    const oid = new mongoose.Types.ObjectId(id);

    // Legal hold must survive every code path that deletes a candidate, scripts
    // included. This script bypassed the service guard and would have erased a
    // candidate subject to a hold.
    if (c.legalHold) {
      console.log(`  SKIP ${id} — legal hold is set`);
      continue;
    }

    // Cloudinary assets
    const assets: Array<{ pid: string; type: 'raw' | 'image' | 'video' }> = [];
    const resumePid = c.resumeUrl ? extractPublicId(c.resumeUrl, 'raw') : null;
    const avatarPid = c.avatar ? extractPublicId(c.avatar, 'image') : null;
    const videoPid =
      c.videoIntroSource === 'cloudinary' && c.videoIntroUrl
        ? extractPublicId(c.videoIntroUrl, 'video')
        : null;
    if (resumePid) assets.push({ pid: resumePid, type: 'raw' });
    if (avatarPid) assets.push({ pid: avatarPid, type: 'image' });
    if (videoPid) assets.push({ pid: videoPid, type: 'video' });

    for (const a of assets) {
      await cloudinary.uploader.destroy(a.pid, { resource_type: a.type });
      cloudinaryDeleted++;
    }

    // Related records across all collections
    for (const { name } of collections) {
      if (name.startsWith('system.') || name === 'candidates') continue;
      const col = db.collection(name);
      for (const field of CANDIDATE_REF_FIELDS) {
        await col.deleteMany({ [field]: { $in: [oid, id] } });
      }
    }

    // The candidate itself
    await db.collection('candidates').deleteOne({ _id: oid });
  }

  console.log(`Deleted ${targets.length} candidate(s)`);
  console.log(`Deleted ${cloudinaryDeleted} Cloudinary asset(s)`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
