import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import { requireRoles } from '../../shared/middleware/authorize';
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

router.get(
  '/',
  requireRoles(
    'admin',
    'hiring_manager',
    'recruiter',
    'coordinator',
    'interviewer'
  ),
  getAllApplications
);

router.get(
  '/:id',
  requireRoles(
    'admin',
    'hiring_manager',
    'recruiter',
    'coordinator',
    'interviewer'
  ),
  getApplicationById
);

router.patch(
  '/:id/approve',
  requireRoles('admin', 'hiring_manager', 'recruiter', 'coordinator'),
  approveApplication
);

router.patch(
  '/:id/reject',
  requireRoles('admin', 'hiring_manager', 'recruiter', 'coordinator'),
  validate(rejectSchema),
  rejectApplication
);

router.patch(
  '/:id/stage',
  requireRoles('admin', 'hiring_manager', 'recruiter', 'coordinator'),
  validate(moveStageSchema),
  moveStage
);

router.patch(
  '/:id/hire',
  requireRoles('admin', 'hiring_manager'),
  hireApplication
);

router.patch(
  '/:id/notes',
  requireRoles('admin', 'hiring_manager', 'recruiter', 'coordinator'),
  validate(notesSchema),
  updateNotes
);

export default router;
