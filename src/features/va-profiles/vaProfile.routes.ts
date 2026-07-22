import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requireRoles,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import * as controller from './vaProfile.controller';

const updateVaProfileSchema = z.object({
  workloadLevel: z.enum(['low', 'normal', 'high', 'overloaded']).optional(),
  satisfactionScore: z.number().min(1).max(5).optional().nullable(),
  burnoutRiskFlag: z.boolean().optional(),
  replacementRiskFlag: z.boolean().optional(),
  lastVaCheckin: z.string().datetime().optional().nullable(),
  notes: z.string().optional(),
});

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('crm'));

router.get(
  '/',
  requireRoles('admin', 'account_manager'),
  controller.getAllVaProfiles
);

router.get(
  '/:id',
  requireRoles('admin', 'account_manager', 'va'),
  controller.getVaProfileById
);

router.patch(
  '/:id',
  requireRoles('admin', 'account_manager'),
  validate(updateVaProfileSchema),
  controller.upsertVaProfile
);

export default router;
