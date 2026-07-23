import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requireRoles,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import * as assignmentController from './assignment.controller';

const createAssignmentSchema = z.object({
  candidateId: z.string(),
  clientId: z.string(),
  serviceType: z.string().min(1).max(100),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional().nullable(),
  accountManagerId: z.string(),
  status: z.enum(['active', 'on_hold', 'ended']).optional(),
  jobId: z.string().optional(),
  notes: z.string().optional().nullable(),
});

const updateAssignmentSchema = z.object({
  serviceType: z.string().min(1).max(100).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional().nullable(),
  accountManagerId: z.string().optional(),
  status: z.enum(['active', 'on_hold', 'ended']).optional(),
  notes: z.string().optional().nullable(),
});

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('crm'));

router.get(
  '/',
  requireRoles('admin', 'account_manager', 'client', 'va'),
  assignmentController.getAllAssignments
);

router.post(
  '/',
  requireRoles('admin', 'account_manager'),
  validate(createAssignmentSchema),
  assignmentController.createAssignment
);

router.get(
  '/:id',
  requireRoles('admin', 'account_manager', 'client', 'va'),
  assignmentController.getAssignmentById
);

router.patch(
  '/:id',
  requireRoles('admin', 'account_manager'),
  validate(updateAssignmentSchema),
  assignmentController.updateAssignment
);

router.delete(
  '/:id',
  requireRoles('admin', 'account_manager'),
  assignmentController.endAssignment
);

export default router;
