import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requireRoles,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import * as eodController from './eodSubmission.controller';

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const createEodSchema = z.object({
  assignmentId: z.string(),
  date: z.string().datetime(),
  shiftStart: z.string().regex(timeRegex, 'Time must be in HH:MM format'),
  shiftEnd: z.string().regex(timeRegex, 'Time must be in HH:MM format'),
  hoursWorked: z.number().min(0).max(24),
  summaryOfWork: z.string().min(1),
  pendingTasks: z.string(),
  blockers: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateEodSchema = createEodSchema
  .omit({ assignmentId: true, date: true })
  .partial();

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('crm'));

router.get(
  '/',
  requireRoles('admin', 'account_manager', 'client', 'va'),
  eodController.getAllEodSubmissions
);

router.post(
  '/',
  requireRoles('va'),
  validate(createEodSchema),
  eodController.createEodSubmission
);

router.get(
  '/:id',
  requireRoles('admin', 'account_manager', 'client', 'va'),
  eodController.getEodSubmissionById
);

router.patch(
  '/:id',
  requireRoles('va'),
  validate(updateEodSchema),
  eodController.updateEodSubmission
);

router.delete('/:id', requireRoles('va'), eodController.deleteEodSubmission);

export default router;
