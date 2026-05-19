import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requireRoles,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import * as workEntryController from './workEntry.controller';

const createWorkEntrySchema = z.object({
  assignmentId: z.string(),
  entryDate: z.string().datetime(),
  entryTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:MM format'),
  taskCategory: z.string().min(1).max(100),
  taskDescription: z.string().min(1),
  timeSpent: z.number().int().min(1).max(480),
  status: z.enum(['completed', 'in_progress', 'pending']).optional(),
  notes: z.string().optional().nullable(),
});

const updateWorkEntrySchema = createWorkEntrySchema
  .omit({ assignmentId: true })
  .partial();

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('crm'));

router.get(
  '/',
  requireRoles('admin', 'account_manager', 'client', 'va'),
  workEntryController.getAllWorkEntries
);

router.post(
  '/',
  requireRoles('admin', 'account_manager', 'va'),
  validate(createWorkEntrySchema),
  workEntryController.createWorkEntry
);

router.get(
  '/:id',
  requireRoles('admin', 'account_manager', 'client', 'va'),
  workEntryController.getWorkEntryById
);

router.patch(
  '/:id',
  requireRoles('admin', 'account_manager', 'va'),
  validate(updateWorkEntrySchema),
  workEntryController.updateWorkEntry
);

router.delete(
  '/:id',
  requireRoles('admin', 'account_manager'),
  workEntryController.deleteWorkEntry
);

export default router;
