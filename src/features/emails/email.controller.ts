import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as emailService from './email.service';

export const getAllEmails = catchAsync(async (req: Request, res: Response) => {
  const {
    candidateId,
    jobId,
    applicationId,
    status,
    direction,
    threadId,
    page,
    limit,
  } = req.query;

  const result = await emailService.getAllEmails({
    candidateId: candidateId as string | undefined,
    jobId: jobId as string | undefined,
    applicationId: applicationId as string | undefined,
    status: status as string | undefined,
    direction: direction as string | undefined,
    threadId: threadId as string | undefined,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });

  sendSuccess(res, result.emails, 'Emails retrieved', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

export const getEmailById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const email = await emailService.getEmailById(id);
  sendSuccess(res, email, 'Email retrieved', 200);
});

export const getEmailThread = catchAsync(
  async (req: Request, res: Response) => {
    const { threadId } = req.params;
    const emails = await emailService.getEmailThread(threadId);
    sendSuccess(res, emails, 'Email thread retrieved', 200);
  }
);

export const sendEmail = catchAsync(async (req: Request, res: Response) => {
  const sentBy = req.user!._id;
  const email = await emailService.sendEmail({ ...req.body, sentBy });
  sendSuccess(
    res,
    email,
    email.status === 'sent'
      ? 'Email sent successfully'
      : 'Email queued but delivery failed',
    201
  );
});

export const resendEmail = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const email = await emailService.resendEmail(id);
  sendSuccess(
    res,
    email,
    email.status === 'sent'
      ? 'Email resent successfully'
      : 'Email resend failed',
    200
  );
});

export const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const email = await emailService.markEmailAsRead(id);
  sendSuccess(res, email, 'Email marked as read', 200);
});

export const deleteEmail = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  await emailService.deleteEmail(id);
  sendSuccess(res, null, 'Email deleted', 200);
});
