/**
 * Repair inbound emails stored before the sender address was parsed and
 * attachments were copied: link them to their candidate, and move attachments
 * still on Resend's expiring links to Cloudinary (using fresh links from Resend).
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/backfill-inbound-emails.ts           # dry-run (report only)
 *   npx ts-node --transpile-only src/scripts/backfill-inbound-emails.ts --execute # apply
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Resend } from 'resend';

dotenv.config();

import Candidate from '../features/candidates/candidate.model';
import Email from '../features/emails/email.model';
import {
  bareEmailAddress,
  keepAttachments,
} from '../features/webhooks/webhook.service';

const EXECUTE = process.argv.includes('--execute');

async function main(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const resend = new Resend(process.env.RESEND_API_KEY);

  const unlinked = await Email.find({
    direction: 'inbound',
    'context.candidateId': null,
    'context.type': { $ne: 'external_meeting' },
  });
  let linked = 0;
  for (const email of unlinked) {
    const candidate = await Candidate.findOne({
      email: bareEmailAddress(email.from),
    }).select('_id');
    if (!candidate) continue;
    linked++;
    if (EXECUTE) {
      // Only the link changes: threads, order and everything else stay as is.
      await Email.updateOne(
        { _id: email._id },
        { $set: { 'context.candidateId': candidate._id } },
        { timestamps: false }
      );
    }
  }
  console.log(`Inbound emails unlinked: ${unlinked.length}, linkable: ${linked}`);

  const withAttachments = await Email.find({
    direction: 'inbound',
    'attachments.0': { $exists: true },
  });
  const pending = withAttachments.filter(email =>
    email.attachments.some(a => a.url && !a.url.includes('res.cloudinary.com'))
  );
  console.log(`Inbound emails with temporary attachment links: ${pending.length}`);

  if (EXECUTE) {
    for (const email of pending) {
      if (!email.resendId) continue;
      const { data } = await resend.emails.receiving.attachments.list({
        emailId: email.resendId,
      });
      for (const attachment of email.attachments) {
        const fresh = data?.data.find(a => a.filename === attachment.filename);
        if (fresh) attachment.url = fresh.download_url;
      }
      await keepAttachments(email);
    }
  }

  console.log(EXECUTE ? 'Done.' : 'Dry run. Pass --execute to apply.');
  await mongoose.disconnect();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
