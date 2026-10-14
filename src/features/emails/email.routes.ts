import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
import { uploadEmailAttachment } from '../../shared/middleware/upload';
import { validate } from '../../shared/validators/common.validator';
import {
  deleteEmail,
  getAllEmails,
  getEmailById,
  getEmailThread,
  markAsRead,
  resendEmail,
  sendEmail,
  uploadAttachment,
} from './email.controller';

const sendEmailSchema = z.object({
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1).max(200),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
  templateId: z.string().optional(),
  context: z
    .object({
      type: z.string().optional(),
      candidateId: z.string().optional().nullable(),
      applicationId: z.string().optional().nullable(),
      jobId: z.string().optional().nullable(),
      interviewId: z.string().optional().nullable(),
    })
    .optional(),
  inReplyTo: z.string().optional(),
  threadId: z.string().optional(),
  variables: z.record(z.string()).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        url: z.string().url().startsWith('https://'),
        contentType: z.string().max(255),
        size: z.number().nonnegative(),
      })
    )
    .max(10)
    .optional(),
});

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('ats'));

router.get('/', requirePermission('emails', 'read'), getAllEmails);

router.post(
  '/',
  requirePermission('emails', 'write'),
  validate(sendEmailSchema),
  sendEmail
);

router.post(
  '/attachments',
  requirePermission('emails', 'write'),
  uploadEmailAttachment,
  uploadAttachment
);

router.get(
  '/thread/:threadId',
  requirePermission('emails', 'read'),
  getEmailThread
);

router.get('/:id', requirePermission('emails', 'read'), getEmailById);

router.patch('/:id/read', requirePermission('emails', 'read'), markAsRead);

router.delete('/:id', requirePermission('emails', 'write'), deleteEmail);

router.post('/:id/resend', requirePermission('emails', 'write'), resendEmail);

export default router;
