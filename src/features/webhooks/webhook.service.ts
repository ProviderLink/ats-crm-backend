import { Request } from 'express';
import { Resend } from 'resend';
import { Webhook } from 'svix';
import { env } from '../../config/env';
import logger from '../../shared/utils/logger';
import Candidate from '../candidates/candidate.model';
import Email from '../emails/email.model';
import { broadcastEmail } from '../emails/email.realtime';
import type { ProcessedAttachment, ResendWebhookEvent } from './webhook.types';

const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';
const resend = new Resend(env.RESEND_API_KEY);

/**
 * Verify Resend webhook signature using the official Svix library.
 * Resend uses Svix under the hood for webhook signing.
 *
 * The raw body buffer (captured in app.ts via express.json verify callback)
 * MUST be used — JSON.stringify(req.body) loses byte-for-byte fidelity.
 */
export function verifyWebhookSignature(req: Request): boolean {
  // Reject requests older than 5 minutes to prevent replay attacks
  const svixTimestamp = req.headers['svix-timestamp'] as string;
  if (svixTimestamp) {
    const timestampMs = parseInt(svixTimestamp, 10) * 1000;
    if (Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      logger.warn('Webhook timestamp too old, possible replay attack');
      return false;
    }
  }

  try {
    const wh = new Webhook(RESEND_WEBHOOK_SECRET);
    const rawBody =
      ((req as any).rawBody as Buffer)?.toString('utf8') ||
      JSON.stringify(req.body);
    wh.verify(rawBody, req.headers as Record<string, string>);
    return true;
  } catch (err: any) {
    logger.warn('Webhook signature verification failed:', err.message);
    return false;
  }
}

/**
 * Find an email document by its Resend ID.
 */
export async function findEmailByResendId(resendId: string) {
  return Email.findOne({ resendId });
}

/**
 * Process an "email.sent" event — mark the email as sent.
 */
export async function handleEmailSent(data: { email_id: string }) {
  const email = await findEmailByResendId(data.email_id);
  if (email) {
    email.status = 'sent';
    email.sentAt = new Date();
    await email.save();
  }
}

/**
 * Process an "email.delivered" event.
 */
export async function handleEmailDelivered(data: { email_id: string }) {
  const email = await findEmailByResendId(data.email_id);
  if (email) {
    email.status = 'delivered';
    email.deliveredAt = new Date();
    await email.save();
  }
}

/**
 * Process an "email.delivery_delayed" event.
 */
export async function handleEmailDelayed(data: { email_id: string }) {
  const email = await findEmailByResendId(data.email_id);
  if (email) {
    email.status = 'delayed';
    await email.save();
  }
}

/**
 * Process an "email.complained" event (spam report).
 */
export async function handleEmailComplained(data: { email_id: string }) {
  const email = await findEmailByResendId(data.email_id);
  if (email) {
    email.status = 'complained';
    await email.save();
    logger.warn(`Email marked as spam: ${data.email_id}`);
  }
}

/**
 * Process an "email.bounced" event.
 */
export async function handleEmailBounced(data: { email_id: string }) {
  const email = await findEmailByResendId(data.email_id);
  if (email) {
    email.status = 'bounced';
    email.bouncedAt = new Date();
    await email.save();
    logger.warn(`Email bounced: ${data.email_id}`);
  }
}

/**
 * Process an "email.opened" event.
 */
export async function handleEmailOpened(data: { email_id: string }) {
  const email = await findEmailByResendId(data.email_id);
  if (email) {
    email.openedAt = new Date();
    email.openCount = (email.openCount || 0) + 1;
    await email.save();
  }
}

/**
 * Process an "email.clicked" event.
 */
export async function handleEmailClicked(data: { email_id: string }) {
  const email = await findEmailByResendId(data.email_id);
  if (email) {
    email.clickedAt = new Date();
    email.clickCount = (email.clickCount || 0) + 1;
    await email.save();
  }
}

/**
 * Process an "email.received" event (inbound email).
 * Fetches full email content from Resend API, matches to candidate,
 * and stores both the email and creates a thread.
 */
export async function handleEmailReceived(data: { email_id: string }) {
  const emailId = data.email_id;

  if (!emailId) {
    logger.error('No email_id in received event');
    return;
  }

  // Resend retries webhooks that time out or fail, so the same inbound email
  // can be delivered more than once. Store each one only once.
  if (await Email.exists({ direction: 'inbound', resendId: emailId })) {
    logger.info(`Inbound email ${emailId} already stored, skipping`);
    return;
  }

  logger.info(
    `Fetching full email content from Resend API for email_id: ${emailId}`
  );

  // Fetch the full email content from Resend API.
  // The webhook only contains metadata, not the actual email body.
  const { data: emailData, error: resendError } =
    await resend.emails.receiving.get(emailId);

  if (resendError || !emailData) {
    logger.error('Failed to fetch email from Resend API:', resendError);
    return;
  }

  const fromEmail = emailData.from;
  const toEmail = emailData.to;
  const subject = emailData.subject || 'No Subject';

  // The mailbox that actually receives replies is pinned to COMPANY_EMAIL:
  // `sendEmail` always sets Reply-To to it, because Resend only delivers inbound
  // mail for the verified domain's configured address. Reading this from
  // settings would silently stop ingest the moment an admin edited it.
  const systemEmail = env.COMPANY_EMAIL.toLowerCase();

  // Check if the email is addressed to or from our system email.
  const toEmails = Array.isArray(toEmail) ? toEmail : [toEmail];
  const isToSystemEmail = toEmails.some(
    (e: string) => e.toLowerCase() === systemEmail
  );

  if (!isToSystemEmail) {
    logger.info(
      `Email not addressed to system email (${systemEmail}), skipping`,
      { from: fromEmail, to: toEmails }
    );
    return;
  }

  const textBody = emailData.text || '';
  const htmlBody = emailData.html || '';

  // Extract metadata.
  const messageId = emailData.message_id;
  const inReplyTo =
    emailData.headers?.['in-reply-to'] || emailData.headers?.['In-Reply-To'];
  const references =
    emailData.headers?.['references'] || emailData.headers?.['References'];

  // Fetch attachments with download URLs.
  let processedAttachments: ProcessedAttachment[] = [];
  const attachmentMetadata = emailData.attachments || [];

  if (attachmentMetadata.length > 0) {
    logger.info(
      `Fetching ${attachmentMetadata.length} attachment(s) from Resend API`
    );

    const { data: attachmentsList, error: attachmentsError } =
      await resend.emails.receiving.attachments.list({ emailId });

    if (attachmentsError) {
      logger.error(
        'Failed to fetch attachments from Resend API:',
        attachmentsError
      );
    } else if (attachmentsList?.data) {
      processedAttachments = attachmentsList.data.map((att: any) => ({
        id: att.id,
        filename: att.filename,
        contentType: att.content_type,
        contentDisposition: att.content_disposition,
        contentId: att.content_id,
        size: att.size,
        downloadUrl: att.download_url,
        expiresAt: att.expires_at,
      }));
      logger.info(
        `Fetched ${processedAttachments.length} attachment(s) with download URLs`
      );
    }
  }

  logger.info(
    `Received email from ${fromEmail} to ${Array.isArray(toEmail) ? toEmail.join(', ') : toEmail}`,
    {
      subject,
      hasAttachments: processedAttachments.length > 0,
      attachmentCount: processedAttachments.length,
      messageId,
      inReplyTo,
      references,
    }
  );

  // Try to find the candidate by sender email.
  const candidate = await Candidate.findOne({
    email: fromEmail.toLowerCase(),
  });

  // Determine thread ID based on inReplyTo or messageId.
  let threadId: string = inReplyTo || messageId || '';

  // Try to find the original email this is replying to.
  // Strategy 1: match by messageId (if outbound email stored it).
  let originalEmail = null;
  if (inReplyTo) {
    originalEmail = await Email.findOne({ messageId: inReplyTo });
  }

  // Strategy 2: if messageId match failed, try matching by finding the most
  // recent outbound email sent to this sender — replies are usually to the
  // email that was last received by that person.
  if (!originalEmail) {
    originalEmail = await Email.findOne({
      direction: 'outbound',
      to: fromEmail.toLowerCase(),
      status: { $in: ['sent', 'delivered'] },
    }).sort({ createdAt: -1 });
  }

  if (originalEmail?.threadId) {
    threadId = originalEmail.threadId;
  }

  if (candidate) {
    // Create an Email record for the inbound email.
    const inbound = await Email.create({
      direction: 'inbound',
      from: fromEmail,
      to: Array.isArray(toEmail) ? toEmail : [toEmail],
      subject,
      bodyHtml: htmlBody,
      bodyText: textBody,
      status: 'received',
      receivedAt: new Date(),
      resendId: emailId,
      threadId,
      inReplyTo: inReplyTo || null,
      messageId: messageId || null,
      context: {
        candidateId: candidate._id,
        applicationId: originalEmail?.context?.applicationId || null,
        jobId: originalEmail?.context?.jobId || null,
        interviewId: originalEmail?.context?.interviewId || null,
      },
      attachments: processedAttachments.map(att => ({
        filename: att.filename,
        url: att.downloadUrl,
        contentType: att.contentType,
        size: att.size,
      })),
    });
    broadcastEmail('email:created', inbound);

    logger.info(
      `Created inbound email record for candidate ${candidate.email}`,
      { candidateId: candidate._id, threadId }
    );
  } else {
    // Sender email not found in candidates. Try to link via original email's context.
    let linkedCandidate = null;
    if (originalEmail?.context?.candidateId) {
      try {
        linkedCandidate = await Candidate.findById(
          originalEmail.context.candidateId
        );
      } catch {
        // ID may be invalid — ignore.
      }
    }

    if (linkedCandidate) {
      logger.info(
        `Linked inbound reply to candidate ${linkedCandidate.email} via thread context (sender used different email: ${fromEmail})`,
        { candidateId: linkedCandidate._id, threadId }
      );

      const inbound = await Email.create({
        direction: 'inbound',
        from: fromEmail,
        to: Array.isArray(toEmail) ? toEmail : [toEmail],
        subject,
        bodyHtml: htmlBody,
        bodyText: textBody,
        status: 'received',
        receivedAt: new Date(),
        resendId: emailId,
        threadId,
        inReplyTo: inReplyTo || null,
        messageId: messageId || null,
        context: {
          candidateId: linkedCandidate._id,
          applicationId: originalEmail?.context?.applicationId || null,
          jobId: originalEmail?.context?.jobId || null,
          interviewId: originalEmail?.context?.interviewId || null,
        },
        attachments: processedAttachments.map(att => ({
          filename: att.filename,
          url: att.downloadUrl,
          contentType: att.contentType,
          size: att.size,
        })),
      });
      broadcastEmail('email:created', inbound);
    } else {
      // Truly unknown — store for manual review.
      logger.warn(`Received email from unknown sender: ${fromEmail}`);

      const inbound = await Email.create({
        direction: 'inbound',
        from: fromEmail,
        to: Array.isArray(toEmail) ? toEmail : [toEmail],
        subject,
        bodyHtml: htmlBody,
        bodyText: textBody,
        status: 'received',
        receivedAt: new Date(),
        resendId: emailId,
        threadId,
        inReplyTo: inReplyTo || null,
        messageId: messageId || null,
        attachments: processedAttachments.map(att => ({
          filename: att.filename,
          url: att.downloadUrl,
          contentType: att.contentType,
          size: att.size,
        })),
      });
      broadcastEmail('email:created', inbound);

      logger.info('Stored unmatched inbound email for manual review');
    }
  }
}

/**
 * Route a webhook event to the appropriate handler.
 */
export async function processWebhookEvent(event: ResendWebhookEvent) {
  logger.info(`Processing Resend webhook: ${event.type}`, {
    eventId: event.data?.email_id,
  });

  switch (event.type) {
    case 'email.sent':
      await handleEmailSent(event.data);
      break;
    case 'email.delivered':
      await handleEmailDelivered(event.data);
      break;
    case 'email.delivery_delayed':
      await handleEmailDelayed(event.data);
      break;
    case 'email.complained':
      await handleEmailComplained(event.data);
      break;
    case 'email.bounced':
      await handleEmailBounced(event.data);
      break;
    case 'email.opened':
      await handleEmailOpened(event.data);
      break;
    case 'email.clicked':
      await handleEmailClicked(event.data);
      break;
    case 'email.received':
      await handleEmailReceived(event.data);
      break;
    default:
      logger.warn(`Unhandled webhook event type: ${event.type}`);
  }
}
