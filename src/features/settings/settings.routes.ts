import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import authenticate from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/authorize';
import { isValidTimeZone } from '../../shared/utils/timezone';
import { validate } from '../../shared/validators/common.validator';
import { getSettings, updateSettings } from './settings.controller';

const router = Router();

const updateSettingsSchema = z.object({
  email: z
    .object({
      // The from ADDRESS is intentionally not user-editable. Resend only sends
      // from addresses on a verified domain, and the inbound webhook can only
      // receive replies for COMPANY_EMAIL — allowing an arbitrary address here
      // silently broke candidate reply threading. Reject it loudly if sent.
      fromEmail: z
        .string()
        .email()
        .refine(v => v.toLowerCase() === env.COMPANY_EMAIL.toLowerCase(), {
          message: `The sender address is fixed to ${env.COMPANY_EMAIL}`,
        })
        .optional(),
      fromName: z.string().min(1).max(100).optional(),
    })
    .optional(),
  ai: z
    .object({
      provider: z.enum(['claude', 'openai']).optional(),
      resumeValidation: z.boolean().optional(),
      candidateScoring: z.boolean().optional(),
      resumeParsing: z.boolean().optional(),
    })
    .optional(),
  companyTimezone: z
    .string()
    .min(1)
    .refine(isValidTimeZone, {
      message: 'Must be a valid IANA timezone (e.g. America/Chicago)',
    })
    .optional(),
  applicationConfirmation: z
    .object({
      enabled: z.boolean().optional(),
      templateId: z.string().nullable().optional(),
    })
    .optional(),
});

router.use(authenticate);

router.get('/', requirePermission('settings', 'read'), getSettings);
router.patch(
  '/',
  requirePermission('settings', 'write'),
  validate(updateSettingsSchema),
  updateSettings
);

export default router;
