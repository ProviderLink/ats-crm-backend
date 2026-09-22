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
  approveApplication,
  deleteApplication,
  disposeApplication,
  getAllApplications,
  getApplicationById,
  hireApplication,
  moveStage,
  rejectApplication,
  updateNotes,
} from './application.controller';

const createInterviewSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(['zoom', 'google_meet', 'phone_call', 'in_person']),
  interviewType: z
    .enum([
      'initial_screening',
      'group_interview',
      'technical_interview',
      'panel_interview',
      'final_interview',
      'hr_interview',
      'culture_fit',
      'other',
    ])
    .optional(),
  jobId: z.string().optional(),
  round: z.number().int().min(1),
  scheduledAt: z.string().datetime(),
  duration: z.number().int().min(15).max(480),
  timezone: z.string().min(1),
  interviewerIds: z.array(z.string()).min(1),
  meetingDetails: z
    .object({
      link: z.string().url().optional().nullable(),
      phoneNumber: z.string().optional().nullable(),
      address: z.string().optional().nullable(),
    })
    .optional(),
});

const updateInterviewSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  scheduledAt: z.string().datetime().optional(),
  duration: z.number().int().min(15).max(480).optional(),
  timezone: z.string().min(1).optional(),
  interviewerIds: z.array(z.string()).min(1).optional(),
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']).optional(),
  meetingDetails: z
    .object({
      link: z.string().url().optional().nullable(),
      phoneNumber: z.string().optional().nullable(),
      address: z.string().optional().nullable(),
    })
    .optional(),
});

const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  notes: z.string(),
  recommendation: z.enum(['strong_yes', 'yes', 'neutral', 'no', 'strong_no']),
});

const disposeSchema = z.object({
  dispositionReasonId: z.string().min(1),
  destination: z.enum(['candidate_pool', 'permanently_ineligible']),
  internalNotes: z.string().optional(),
});

const moveStageSchema = z.object({
  stageId: z.string().min(1),
});

const rejectSchema = z.object({
  reason: z.string().optional(),
  rejectionReasonId: z.string().min(1).optional(),
  destination: z.enum(['candidate_pool', 'permanently_ineligible']).optional(),
  internalNotes: z.string().optional(),
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
  '/:id/dispose',
  requirePermission('candidates', 'write'),
  validate(disposeSchema),
  disposeApplication
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

router.delete(
  '/:id',
  requirePermission('candidates', 'manage'),
  deleteApplication
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
  validate(createInterviewSchema),
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
