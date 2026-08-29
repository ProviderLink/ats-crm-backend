/**
 * Find (and optionally delete) orphaned resume files in Cloudinary.
 *
 * Resumes are uploaded to Cloudinary folder `ats/resumes` with resource_type
 * `raw`. A resume is "orphaned" when its secure_url is not referenced by any
 * candidate's `resumeUrl` in MongoDB (e.g. uploaded during the stateless
 * upload-and-parse step before the candidate abandoned the flow, or left
 * behind after a candidate was deleted without cleanup).
 *
 * Usage:
 *   npx ts-node src/scripts/find-orphan-resumes.ts          # dry-run (report only)
 *   npx ts-node src/scripts/find-orphan-resumes.ts --delete # delete orphans
 */
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
  process.env;

const DO_DELETE = process.argv.includes('--delete');

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

interface CloudinaryResource {
  public_id: string;
  secure_url: string;
  bytes: number;
  created_at: string;
  format?: string;
}

async function listCloudinaryResumes(): Promise<CloudinaryResource[]> {
  const all: CloudinaryResource[] = [];
  let nextCursor: string | undefined;

  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await cloudinary.api.resources({
      type: 'upload',
      resource_type: 'raw',
      prefix: 'ats/resumes',
      max_results: 500,
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
    });

    all.push(...((result?.resources ?? []) as CloudinaryResource[]));
    nextCursor = result?.next_cursor;
  } while (nextCursor);

  return all;
}

function normalizeUrl(url: string): string {
  return url.split('?')[0];
}

/**
 * Canonical Cloudinary asset key: strip the domain, resource type and the
 * optional version segment so both DB URLs and Cloudinary resource listing
 * URLs map to the same key (e.g. `ats/resumes/abc123.pdf`).
 */
function canonicalKey(url: string): string {
  return normalizeUrl(url).replace(
    /^https?:\/\/res\.cloudinary\.com\/[^/]+\/(?:raw|image)\/upload\/(?:v\d+\/)?/,
    ''
  );
}

async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI!);

  const docs = await mongoose.connection
    .collection('candidates')
    .find({ resumeUrl: { $type: 'string', $ne: '' } })
    .project({ resumeUrl: 1 })
    .toArray();

  const referenced = new Set<string>();
  for (const doc of docs) {
    const url = (doc as { resumeUrl?: string }).resumeUrl;
    if (url) {
      referenced.add(url);
      referenced.add(normalizeUrl(url));
      referenced.add(canonicalKey(url));
    }
  }
  console.log(`Candidates with a resumeUrl: ${docs.length}`);

  console.log('Listing Cloudinary `ats/resumes` assets…');
  const assets = await listCloudinaryResumes();
  console.log(`Cloudinary assets found: ${assets.length}`);

  const orphans = assets.filter(a => {
    const u = a.secure_url || '';
    return (
      !referenced.has(u) &&
      !referenced.has(normalizeUrl(u)) &&
      !referenced.has(canonicalKey(u))
    );
  });

  const orphanBytes = orphans.reduce((sum, a) => sum + (a.bytes || 0), 0);
  console.log(
    `\nOrphaned resumes: ${orphans.length} (${(orphanBytes / 1024 / 1024).toFixed(2)} MB)\n`
  );

  for (const o of orphans) {
    console.log(
      `  - ${o.public_id}  (${((o.bytes || 0) / 1024).toFixed(1)} KB, ${o.created_at})`
    );
  }

  if (!orphans.length) {
    console.log('\nNothing to clean up.');
    await mongoose.disconnect();
    process.exit(0);
  }

  if (!DO_DELETE) {
    console.log(
      `\nDry run — no files deleted. Re-run with --delete to remove these ${orphans.length} files.`
    );
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('\nDeleting orphaned resumes…');
  let deleted = 0;
  for (const o of orphans) {
    try {
      await cloudinary.uploader.destroy(o.public_id, { resource_type: 'raw' });
      console.log(`  ✓ deleted ${o.public_id}`);
      deleted++;
    } catch (e) {
      console.error(`  ✗ failed ${o.public_id}:`, (e as Error).message);
    }
  }

  console.log(`\nDeleted ${deleted}/${orphans.length} orphaned resumes.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
