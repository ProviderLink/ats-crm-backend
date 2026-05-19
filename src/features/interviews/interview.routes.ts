import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import { requireRoles } from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import {
  cancelInterview,
  createInterview,
  getAllInterviews,
  getInterviewById,
  submitFeedback,
  updateInterview,
} from './interview.controller';

const createInterviewSchema = z.object({
  applicationId: z.string(),
  candidateId: z.string(),
  jobId: z.string(),
  clientId: z.string(),
  title: z.string().min(1).max(200),
  type: z.enum(['zoom', 'google_meet', 'phone_call', 'in_person']),
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
  getAllInterviews
);

router.post(
  '/',
  requireRoles('admin', 'hiring_manager', 'recruiter', 'coordinator'),
  validate(createInterviewSchema),
  createInterview
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
  getInterviewById
);

router.patch(
  '/:id',
  requireRoles('admin', 'hiring_manager', 'recruiter', 'coordinator'),
  validate(updateInterviewSchema),
  updateInterview
);

router.delete('/:id', requireRoles('admin', 'hiring_manager'), cancelInterview);

router.post(
  '/:id/feedback',
  requireRoles(
    'admin',
    'hiring_manager',
    'recruiter',
    'coordinator',
    'interviewer'
  ),
  validate(feedbackSchema),
  submitFeedback
);

export default router;
