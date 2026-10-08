import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import {
  cancelInterview,
  createInterviewForApplication,
  getInterviewById,
  getInterviewsForApplication,
  submitFeedback,
  updateInterview,
} from '../interviews/interview.controller';
import {
  createNestedInterviewSchema,
  feedbackSchema,
  updateInterviewSchema,
} from '../interviews/interview.schemas';
import {
  approveApplication,
  getAllApplications,
  getApplicationById,
  hireApplication,
  moveStage,
  moveToTalentPool,
  rejectApplication,
  updateNotes,
} from './application.controller';

const moveStageSchema = z.object({
  stageId: z.string().min(1),
});

const rejectSchema = z.object({
  reason: z.string().optional(),
  rejectionReasonId: z.string().min(1).optional(),
  destination: z.enum(['candidate_pool', 'permanently_ineligible']).optional(),
  internalNotes: z.string().optional(),
});

const moveToTalentPoolSchema = z.object({
  notes: z.string().max(2000).optional(),
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
  '/:id/move-to-talent-pool',
  requirePermission('candidates', 'write'),
  validate(moveToTalentPoolSchema),
  moveToTalentPool
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

// ── Nested interview routes (under /applications/:applicationId/interviews) ──

router.get(
  '/:applicationId/interviews',
  requirePermission('interviews', 'read'),
  getInterviewsForApplication
);

router.post(
  '/:applicationId/interviews',
  requirePermission('interviews', 'write'),
  validate(createNestedInterviewSchema),
  createInterviewForApplication
);

router.get(
  '/:applicationId/interviews/:id',
  requirePermission('interviews', 'read'),
  getInterviewById
);

router.patch(
  '/:applicationId/interviews/:id',
  requirePermission('interviews', 'write'),
  validate(updateInterviewSchema),
  updateInterview
);

router.delete(
  '/:applicationId/interviews/:id',
  requirePermission('interviews', 'write'),
  cancelInterview
);

router.post(
  '/:applicationId/interviews/:id/feedback',
  requirePermission('interviews', 'write'),
  validate(feedbackSchema),
  submitFeedback
);

export default router;
