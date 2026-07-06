import mongoose from 'mongoose';
import { env } from '../../config/env';
import AppError from '../../shared/utils/AppError';
import {
  sendEmail as sendEmailUtil,
  substituteVariables,
} from '../../shared/utils/email';
import Email from './email.model';
import type { IEmail, SendEmailInput } from './email.types';

export const getAllEmails = async (filters: {
  candidateId?: string;
  jobId?: string;
  applicationId?: string;
  status?: string;
  direction?: string;
  threadId?: string;
  page?: number;
  limit?: number;
}) => {
  const query: Record<string, unknown> = {};

  if (filters.candidateId) query['context.candidateId'] = filters.candidateId;
  if (filters.jobId) query['context.jobId'] = filters.jobId;
  if (filters.applicationId)
    query['context.applicationId'] = filters.applicationId;
  if (filters.status) query['status'] = filters.status;
  if (filters.direction) query['direction'] = filters.direction;
  if (filters.threadId) query['threadId'] = filters.threadId;

  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const [emails, total] = await Promise.all([
    Email.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Email.countDocuments(query),
  ]);

  return {
    emails: emails.map(e => e.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getEmailById = async (id: string): Promise<IEmail> => {
  const email = await Email.findById(id);
  if (!email) throw new AppError(404, 'EMAIL_NOT_FOUND', 'Email not found');
  return email.toSafeObject();
};

export const getEmailThread = async (threadId: string): Promise<IEmail[]> => {
  const emails = await Email.find({ threadId }).sort({ createdAt: 1 });
  return emails.map(e => e.toSafeObject());
};

export const sendEmail = async (input: SendEmailInput): Promise<IEmail> => {
  let subject = input.subject;
  let bodyHtml = input.bodyHtml;
  if (input.variables) {
    subject = substituteVariables(subject, input.variables);
    bodyHtml = substituteVariables(bodyHtml, input.variables);
  }

  const threadId = input.threadId ?? new mongoose.Types.ObjectId().toString();

  const email = await Email.create({
    direction: 'outbound',
    from: env.COMPANY_EMAIL,
    to: input.to,
    cc: input.cc ?? [],
    bcc: input.bcc ?? [],
    subject,
    bodyHtml,
    bodyText: input.bodyText ?? '',
    status: 'pending',
    threadId,
    inReplyTo: input.inReplyTo ?? null,
    templateId: input.templateId ?? null,
    context: input.context ?? {},
    sentBy: input.sentBy ?? null,
  });

  try {
    const result = await sendEmailUtil({
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject,
      html: bodyHtml,
      text: input.bodyText,
    });
    email.status = 'sent';
    email.resendId = result.id;
    email.sentAt = new Date();
    await email.save();
  } catch (error) {
    email.status = 'failed';
    email.failedAt = new Date();
    email.failureReason =
      error instanceof Error ? error.message : 'Unknown error';
    await email.save();
  }

  return email.toSafeObject();
};

export const markEmailAsRead = async (id: string): Promise<IEmail> => {
  const email = await Email.findByIdAndUpdate(
    id,
    { isRead: true },
    { new: true }
  );
  if (!email) throw new AppError(404, 'EMAIL_NOT_FOUND', 'Email not found');

  return email.toSafeObject();
};

export const deleteEmail = async (id: string): Promise<void> => {
  const email = await Email.findByIdAndDelete(id);
  if (!email) throw new AppError(404, 'EMAIL_NOT_FOUND', 'Email not found');
};

export const resendEmail = async (id: string): Promise<IEmail> => {
  const email = await Email.findById(id);
  if (!email) throw new AppError(404, 'EMAIL_NOT_FOUND', 'Email not found');

  if (email.status !== 'failed') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Only failed emails can be resent'
    );
  }

  email.status = 'pending';

  try {
    const result = await sendEmailUtil({
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      subject: email.subject,
      html: email.bodyHtml,
      text: email.bodyText,
    });
    email.status = 'sent';
    email.resendId = result.id;
    email.sentAt = new Date();
    await email.save();
  } catch (error) {
    email.status = 'failed';
    email.failedAt = new Date();
    email.failureReason =
      error instanceof Error ? error.message : 'Unknown error';
    await email.save();
  }

  return email.toSafeObject();
};
