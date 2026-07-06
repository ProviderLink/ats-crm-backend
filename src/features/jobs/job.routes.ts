import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
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
  stageMapping: z.record(z.string(), z.string()).optional(),
});

const applyToJobSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: z.string().email(),
  phone: z.string().min(1),
  resumeUrl: z.string().url(),
  resumeOriginalName: z.string().optional(),
  resumeRawText: z.string().optional(),
  videoIntroUrl: z.string().url().optional().nullable(),
  coverLetter: z.string().optional(),
  candidateId: z.string().optional(),
  parsedData: z
    .object({
      summary: z.string().optional(),
      skills: z.array(z.string()).optional(),
      languages: z.array(z.string()).optional(),
      certifications: z.array(z.string()).optional(),
      experience: z
        .array(
          z.object({
            company: z.string().optional(),
            title: z.string().optional(),
            duration: z.string().optional(),
            description: z.string().optional(),
          })
        )
        .optional(),
      education: z
        .array(
          z.object({
            institution: z.string().optional(),
            degree: z.string().optional(),
            field: z.string().optional(),
            year: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

const router = Router();

// Public routes — must be registered before authenticate middleware
router.get('/', getAllJobs);
router.get('/:id', getJobById);
router.post('/:id/apply', validate(applyToJobSchema), applyToJob);

router.use(authenticate);
router.use(requireAppAccess('ats'));

router.post(
  '/',
  requirePermission('jobs', 'write'),
  validate(createJobSchema),
  createJob
);

router.patch(
  '/:id',
  requirePermission('jobs', 'write'),
  validate(updateJobSchema),
  updateJob
);

router.delete('/:id', requirePermission('jobs', 'manage'), deleteJob);

router.patch(
  '/:id/status',
  requirePermission('jobs', 'write'),
  validate(updateStatusSchema),
  updateJobStatus
);

router.patch(
  '/:id/pipeline',
  requirePermission('jobs', 'write'),
  validate(assignPipelineSchema),
  assignPipeline
);

export default router;
