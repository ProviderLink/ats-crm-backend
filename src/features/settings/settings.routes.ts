import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import { getSettings, updateSettings } from './settings.controller';

const router = Router();

const updateSettingsSchema = z.object({
  email: z
    .object({
      fromEmail: z.string().email().optional(),
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
  companyTimezone: z.string().min(1).optional(),
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
