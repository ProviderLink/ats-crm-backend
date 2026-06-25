import { Request, Response } from 'express';
import { env } from '../../config/env';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import logger from '../../shared/utils/logger';
import { sendSuccess } from '../../shared/utils/response';
import * as webhookService from './webhook.service';

const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';

/**
 * POST /api/webhooks/resend
 * Handle incoming Resend webhook events.
 * This endpoint is called by Resend's servers — no auth middleware.
 */
export const handleResendWebhook = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    // Verify webhook signature when secret is configured.
    if (RESEND_WEBHOOK_SECRET) {
      if (!webhookService.verifyWebhookSignature(req)) {
        logger.warn('Webhook signature verification failed');
        sendSuccess(res, { verified: false }, 'Invalid webhook signature', 401);
        return;
      }
    }

    const event = req.body;

    if (!event || !event.type) {
      throw new AppError(400, 'INVALID_PAYLOAD', 'Invalid webhook payload');
    }

    await webhookService.processWebhookEvent(event);

    sendSuccess(res, { received: true }, 'Webhook processed');
  }
);

/**
 * POST /api/webhooks/resend/test
 * Test endpoint to manually trigger webhook processing.
 * Only available in non-production environments.
 */
export const testWebhook = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    if (env.NODE_ENV === 'production') {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Test endpoint not available in production'
      );
    }

    const { type, emailId } = req.body;

    if (!type) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Event type is required');
    }

    const testEvent = {
      type,
      created_at: new Date().toISOString(),
      data: {
        email_id: emailId || 'test-email-id',
        from: 'test@example.com',
        to: ['recipient@example.com'],
        subject: 'Test Email',
        text: 'This is a test email body',
      },
    };

    await webhookService.processWebhookEvent(testEvent);

    sendSuccess(res, { received: true, test: true }, 'Test webhook processed');
  }
);
