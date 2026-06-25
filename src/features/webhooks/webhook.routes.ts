import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../shared/validators/common.validator';
import { handleResendWebhook, testWebhook } from './webhook.controller';

const router: Router = Router();

// POST /api/webhooks/resend - Handle Resend webhook events (no auth — called by Resend)
router.post('/resend', handleResendWebhook);

// POST /api/webhooks/resend/test - Test webhook (development only)
const testSchema = z.object({
  type: z.enum([
    'email.sent',
    'email.delivered',
    'email.delivery_delayed',
    'email.complained',
    'email.bounced',
    'email.opened',
    'email.clicked',
    'email.received',
  ]),
  emailId: z.string().optional(),
});
router.post('/resend/test', validate(testSchema), testWebhook);

export default router;
