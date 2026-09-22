import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
  requireRoles,
} from '../../shared/middleware/authorize';
import { uploadAvatar, uploadResume } from '../../shared/middleware/upload';
import { validate } from '../../shared/validators/common.validator';
import {
  approveCandidate,
  assignJob,
  createCandidate,
  deleteCandidate,
  getAllCandidates,
  getCandidateById,
  publicParse,
  publicUploadAndParse,
  rejectCandidate,
  updateCandidate,
  updateEligibility,
  updateLegalHold,
  updateTalentPool,
  uploadAvatar as uploadAvatarController,
} from './candidate.controller';

const createCandidateSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: z.string().email(),
  phone: z.string().min(1),
  videoIntroUrl: z.string().url().optional().nullable(),
  videoIntroSource: z.enum(['cloudinary', 'external']).optional().nullable(),
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
        yearsOfExperience: z.number().min(0).optional(),
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
  tags: z.array(z.string()).optional(),
});

const updateCandidateSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  phone: z.string().min(1).optional(),
  videoIntroUrl: z.string().url().optional().nullable(),
  videoIntroSource: z.enum(['cloudinary', 'external']).optional().nullable(),
  yearsOfExperience: z.number().min(0).optional(),
  tags: z.array(z.string()).optional(),
  parsedData: z
    .object({
      summary: z.string().optional(),
      yearsOfExperience: z.number().min(0).optional(),
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
    .nullable(),
  englishProficiency: z
    .enum(['basic', 'conversational', 'professional', 'fluent', 'native'])
    .optional()
    .nullable(),
  currentSalaryPHP: z.number().min(0).optional().nullable(),
  currentSalaryUSD: z.number().min(0).optional().nullable(),
  reasonForLeaving: z.string().max(500).optional().nullable(),
  cityOfResidence: z.string().max(100).optional().nullable(),
});

const talentPoolSchema = z.object({
  action: z.enum(['add', 'remove']),
  notes: z.string().optional(),
});

const rejectCandidateSchema = z
  .object({
    rejectionReasonId: z.string().min(1),
    destination: z
      .enum(['candidate_pool', 'permanently_ineligible'])
      .optional(),
    internalNotes: z.string().optional(),
  })
  .strict();

const assignJobSchema = z.object({
  jobId: z.string().optional(),
  startStageId: z.string().optional(),
});

const router = Router();

// ── PUBLIC ROUTES (no authentication required) ──

/**
 * @route   POST /api/v1/ats/candidates/public/parse
 * @desc    Parse resume and return structured JSON (NO Cloudinary upload, NO DB save)
 * @access  Public
 */
router.post('/public/parse', uploadResume, publicParse);

/**
 * @route   POST /api/v1/ats/candidates/public/upload-and-parse
 * @desc    Stateless — extract text, AI parse, and return
 *          { resumeOriginalName, resumeRawText, parsedData }.
 *          NO Cloudinary upload and NO candidate is created/saved here
 *          (the resume is uploaded and the candidate persisted only on final
 *          submit via POST /jobs/:id/apply).
 * @access  Public
 */
const publicApplySchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: z.string().email(),
  phone: z.string().min(1),
  videoIntroUrl: z.string().url().optional().nullable(),
  videoIntroSource: z.enum(['cloudinary', 'external']).optional().nullable(),
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
});

router.post(
  '/public/upload-and-parse',
  uploadResume,
  validate(publicApplySchema, 'body'),
  publicUploadAndParse
);

// ── AUTHENTICATED ROUTES ──

router.use(authenticate);
router.use(requireAppAccess('ats'));

router.get('/', requirePermission('candidates', 'read'), getAllCandidates);

router.post(
  '/',
  requirePermission('candidates', 'write'),
  uploadResume,
  validate(createCandidateSchema, 'body'),
  createCandidate
);

// Specific routes must be registered before /:id to avoid param capture
router.post(
  '/:id/approve',
  requirePermission('candidates', 'write'),
  validate(assignJobSchema),
  approveCandidate
);

router.get('/:id', requirePermission('candidates', 'read'), getCandidateById);

router.patch(
  '/:id',
  requirePermission('candidates', 'write'),
  validate(updateCandidateSchema),
  updateCandidate
);

router.delete(
  '/:id',
  requirePermission('candidates', 'manage'),
  deleteCandidate
);

router.post(
  '/:id/avatar',
  requirePermission('candidates', 'write'),
  uploadAvatar,
  uploadAvatarController
);

router.patch(
  '/:id/talent-pool',
  requirePermission('candidates', 'write'),
  validate(talentPoolSchema),
  updateTalentPool
);

router.patch(
  '/:id/reject',
  requirePermission('candidates', 'write'),
  validate(rejectCandidateSchema, 'body'),
  rejectCandidate
);

const eligibilitySchema = z.object({
  eligibilityStatus: z.enum(['eligible', 'permanently_ineligible']),
  reason: z.string().optional(),
});

router.patch(
  '/:id/eligibility',
  requireRoles('admin'),
  validate(eligibilitySchema, 'body'),
  updateEligibility
);

const legalHoldSchema = z.object({
  legalHold: z.boolean(),
});

router.patch(
  '/:id/legal-hold',
  requireRoles('admin'),
  validate(legalHoldSchema, 'body'),
  updateLegalHold
);

router.post(
  '/:id/assign-job',
  requirePermission('candidates', 'write'),
  validate(assignJobSchema),
  assignJob
);

export default router;
