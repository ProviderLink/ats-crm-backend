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

const workEntrySchema = z.object({
  task: z.string().min(1, 'Task is required'),
  description: z.string().min(1, 'Description is required'),
  quantity: z.number().min(0),
  status: z.enum(['completed', 'in_progress', 'pending']).default('completed'),
  timeSpent: z.number().min(0),
});

const createEodObjectSchema = z.object({
  assignmentId: z.string(),
  date: z.string().date(),
  shiftStart: z.string().regex(timeRegex, 'Time must be in HH:MM format'),
  shiftEnd: z.string().regex(timeRegex, 'Time must be in HH:MM format'),
  hoursWorked: z.number().min(0).max(24),
  summaryOfWork: z.string().optional().nullable(),
  workEntries: z.array(workEntrySchema).optional(),
  pendingTasks: z.string(),
  blockers: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  communicatedWithClient: z.enum(['yes', 'no', 'other']).nullable().optional(),
  clientNote: z.string().optional().nullable(),
});

const createEodSchema = createEodObjectSchema
  .refine(
    data =>
      (data.summaryOfWork && data.summaryOfWork.trim().length > 0) ||
      (data.workEntries && data.workEntries.length > 0),
    {
      message: 'Either summaryOfWork or at least one work entry is required',
      path: ['workEntries'],
    }
  )
  .refine(
    data =>
      data.communicatedWithClient === 'yes' ||
      data.communicatedWithClient === 'no' ||
      data.communicatedWithClient === 'other',
    {
      message: 'Please indicate whether you communicated with the client today',
      path: ['communicatedWithClient'],
    }
  );

const updateEodSchema = createEodObjectSchema
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
