import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import {
  approveApplication,
  getAllApplications,
  getApplicationById,
  hireApplication,
  moveStage,
  rejectApplication,
  updateNotes,
} from './application.controller';

const rejectSchema = z.object({
  rejectionReason: z.string().optional(),
});

const moveStageSchema = z.object({
  stageId: z.string().min(1),
});

const notesSchema = z.object({
  notes: z.string(),
});

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('ats'));

router.get('/', requirePermission('candidates', 'read'), getAllApplications);

router.get('/:id', requirePermission('candidates', 'read'), getApplicationById);

router.patch(
  '/:id/approve',
  requirePermission('candidates', 'write'),
  approveApplication
);

router.patch(
  '/:id/reject',
  requirePermission('candidates', 'write'),
  validate(rejectSchema),
  rejectApplication
);

router.patch(
  '/:id/stage',
  requirePermission('candidates', 'write'),
  validate(moveStageSchema),
  moveStage
);

router.patch(
  '/:id/hire',
  requirePermission('candidates', 'write'),
  hireApplication
);

router.patch(
  '/:id/notes',
  requirePermission('candidates', 'write'),
  validate(notesSchema),
  updateNotes
);

export default router;
