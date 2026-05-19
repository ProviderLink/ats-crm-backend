import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import { requireRoles } from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import { PIPELINE_STAGE_ICONS } from '../pipeline-templates/pipelineTemplate.types';
import {
  applyToJob,
  assignPipeline,
  createJob,
  deleteJob,
  getAllJobs,
  getJobById,
  updateJob,
  updateJobStatus,
} from './job.controller';

const salaryRangeSchema = z.object({
  min: z.number().min(0),
  max: z.number().min(0),
  currency: z.string().default('USD'),
  period: z.enum([
    'hourly',
    'daily',
    'weekly',
    'bi_weekly',
    'monthly',
    'yearly',
  ]),
});

const stageSchema = z.object({
  name: z.string().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .default('#3b82f6'),
  order: z.number().int().min(1),
  isActive: z.boolean().optional().default(true),
  icon: z.enum(PIPELINE_STAGE_ICONS).optional().default('ClipboardList'),
});

const createJobSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  clientId: z.string(),
  jobType: z.enum(['full_time', 'part_time', 'contract', 'temporary']),
  locationType: z.enum(['remote', 'hybrid', 'onsite']),
  location: z.string().optional(),
  experienceLevel: z.enum(['entry', 'mid', 'senior', 'lead']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  openings: z.number().int().min(1).optional(),
  requirements: z.array(z.string()).optional(),
  responsibilities: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  salaryRange: salaryRangeSchema.optional().nullable(),
  applicationDeadline: z.string().datetime().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  benefits: z.array(z.string()).optional(),
});

const updateJobSchema = createJobSchema.omit({ clientId: true }).partial();

const updateStatusSchema = z.object({
  status: z.enum(['draft', 'open', 'on_hold', 'closed']),
});

const assignPipelineSchema = z.object({
  templateId: z.string(),
});

const applyToJobSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: z.string().email(),
  phone: z.string().min(1),
  resumeUrl: z.string().url(),
  videoIntroUrl: z.string().url().optional().nullable(),
  coverLetter: z.string().optional(),
});

const router = Router();

// Public route — must be registered before authenticate middleware
router.post('/:id/apply', validate(applyToJobSchema), applyToJob);

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
  getAllJobs
);

router.post(
  '/',
  requireRoles('admin', 'hiring_manager'),
  validate(createJobSchema),
  createJob
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
  getJobById
);

router.patch(
  '/:id',
  requireRoles('admin', 'hiring_manager'),
  validate(updateJobSchema),
  updateJob
);

router.delete('/:id', requireRoles('admin'), deleteJob);

router.patch(
  '/:id/status',
  requireRoles('admin', 'hiring_manager'),
  validate(updateStatusSchema),
  updateJobStatus
);

router.patch(
  '/:id/pipeline',
  requireRoles('admin', 'hiring_manager'),
  validate(assignPipelineSchema),
  assignPipeline
);

export default router;
