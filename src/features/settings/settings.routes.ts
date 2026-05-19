import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import { requireRoles } from '../../shared/middleware/authorize';
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
      resumeValidation: z.boolean().optional(),
      candidateScoring: z.boolean().optional(),
    })
    .optional(),
  companyTimezone: z.string().min(1).optional(),
});

router.use(authenticate);

router.get('/', requireRoles('admin'), getSettings);
router.patch(
  '/',
  requireRoles('admin'),
  validate(updateSettingsSchema),
  updateSettings
);

export default router;
