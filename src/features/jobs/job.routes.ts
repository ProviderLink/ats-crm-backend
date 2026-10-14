import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
import optionalAuthenticate from '../../shared/middleware/optionalAuthenticate';
import { uploadResumeWithPortfolio } from '../../shared/middleware/upload';
import {
  httpUrlSchema,
  validate,
} from '../../shared/validators/common.validator';
import { PIPELINE_STAGE_ICONS } from '../pipeline-templates/pipelineTemplate.types';
import {
  applyToJob,
  assignPipeline,
  createJob,
  deleteJob,
  generateDraft,
  getAllJobs,
  getJobById,
  standardizeContent,
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
  pipelineTemplateId: z.string().optional(),
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

const updateJobSchema = createJobSchema
  .omit({ clientId: true, pipelineTemplateId: true })
  .partial();

const updateStatusSchema = z.object({
  status: z.enum(['draft', 'open', 'on_hold', 'closed']),
});

/**
 * Free-form brief supplied by the user. Only used to produce a draft that the
 * client shows in the job form — nothing is persisted by this endpoint.
 */
const generateDraftSchema = z.object({
  notes: z.string().trim().min(10).max(20000),
});

/**
 * Existing list content lifted from the job form. Tidied and returned — never
 * persisted, so an older job can only change if the user saves it afterwards.
 * Limits are deliberately generous because these values already exist on
 * stored records and must not be truncated on the way in.
 */
const standardizeContentSchema = z
  .object({
    requirements: z.array(z.string().max(1000)).max(60).optional().default([]),
    responsibilities: z
      .array(z.string().max(1000))
      .max(60)
      .optional()
      .default([]),
    skills: z.array(z.string().max(1000)).max(60).optional().default([]),
    benefits: z.array(z.string().max(1000)).max(60).optional().default([]),
  })
  .refine(
    v =>
      v.requirements.length > 0 ||
      v.responsibilities.length > 0 ||
      v.skills.length > 0 ||
      v.benefits.length > 0,
    { message: 'Nothing to improve yet' }
  );

const assignPipelineSchema = z.object({
  templateId: z.string(),
  stageMapping: z.record(z.string(), z.string()).optional(),
});

const applyToJobSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: z.string().email(),
  phone: z.string().min(1),
  resumeOriginalName: z.string().optional(),
  resumeRawText: z.string().optional(),
  videoIntroUrl: httpUrlSchema.optional().nullable(),
  portfolioUrl: httpUrlSchema.optional().nullable(),
  yearsOfExperience: z.coerce.number().min(0).optional(),
  englishProficiency: z
    .enum(['basic', 'conversational', 'professional', 'fluent', 'native'])
    .optional()
    .nullable(),
  currentSalaryPHP: z.preprocess(
    v => (v === '' || v === undefined || v === null ? null : Number(v)),
    z.number().min(0).nullable()
  ),
  currentSalaryUSD: z.preprocess(
    v => (v === '' || v === undefined || v === null ? null : Number(v)),
    z.number().min(0).nullable()
  ),
  reasonForLeaving: z.string().max(500).optional().nullable(),
  cityOfResidence: z.string().max(100).optional().nullable(),
  coverLetter: z.string().optional(),
  parsedData: z.preprocess(
    v => {
      if (typeof v === 'string' && v.trim() !== '') {
        try {
          return JSON.parse(v);
        } catch {
          return null;
        }
      }
      return v ?? null;
    },
    z
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
      .optional()
      .nullable()
  ),
});

// Query strings are untrusted: with Express's extended parser `?status[$ne]=x`
// arrives as an object, which would reach Mongo as an operator.
const listJobsQuerySchema = z.object({
  clientId: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(10000).optional(),
});

const router = Router();

// Public routes — must be registered before authenticate middleware.
// Anonymous callers get a trimmed view; a valid token gets the full one.
router.get(
  '/',
  optionalAuthenticate,
  validate(listJobsQuerySchema, 'query'),
  getAllJobs
);
router.get('/:id', optionalAuthenticate, getJobById);
router.post(
  '/:id/apply',
  uploadResumeWithPortfolio,
  validate(applyToJobSchema),
  applyToJob
);

router.use(authenticate);
router.use(requireAppAccess('ats'));

router.post(
  '/',
  requirePermission('jobs', 'write'),
  validate(createJobSchema),
  createJob
);

// Stateless helper: reads the brief, returns a draft, writes nothing.
// Every '/:id' route is a different method or has an extra path segment, so
// this literal path can never be captured as a job id.
router.post(
  '/generate-draft',
  requirePermission('jobs', 'write'),
  validate(generateDraftSchema),
  generateDraft
);

// Stateless helper: tidies the list fields the client already has, returns
// them, and writes nothing. Same literal-path reasoning as '/generate-draft'.
router.post(
  '/standardize',
  requirePermission('jobs', 'write'),
  validate(standardizeContentSchema),
  standardizeContent
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
