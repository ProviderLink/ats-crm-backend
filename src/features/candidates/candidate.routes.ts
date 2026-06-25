import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
import { uploadAvatar, uploadResume } from '../../shared/middleware/upload';
import { validate } from '../../shared/validators/common.validator';
import {
  assignJob,
  createCandidate,
  deleteCandidate,
  getAllCandidates,
  getCandidateById,
  updateCandidate,
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
  yearsOfExperience: z.number().min(0).optional(),
  englishProficiency: z
    .enum(['basic', 'conversational', 'professional', 'fluent', 'native'])
    .optional()
    .nullable(),
  currentSalaryPHP: z.number().min(0).optional().nullable(),
  currentSalaryUSD: z.number().min(0).optional().nullable(),
  reasonForLeaving: z.string().max(500).optional().nullable(),
  cityOfResidence: z.string().max(100).optional().nullable(),
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

const assignJobSchema = z.object({
  jobId: z.string(),
});

const router = Router();

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

router.post(
  '/:id/assign-job',
  requirePermission('candidates', 'write'),
  validate(assignJobSchema),
  assignJob
);

export default router;
