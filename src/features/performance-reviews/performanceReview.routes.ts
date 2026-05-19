import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import { requireAppAccess, requireRoles } from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import {
  completeReview,
  generateReview,
  getAllReviews,
  getReviewById,
  regenerateSection,
  updateReview,
} from './performanceReview.controller';

const router = Router();

const generateReviewSchema = z.object({
  candidateId: z.string(),
  clientId: z.string(),
  jobId: z.string(),
  reviewType: z.enum([
    '30_day',
    '60_day',
    '90_day',
    'annual',
    'client_satisfaction',
    'corrective_coaching',
  ]),
  reviewPeriodStart: z.string().datetime(),
  reviewPeriodEnd: z.string().datetime(),
  roleType: z.string().min(1),
  clientExpectations: z.string().optional(),
  managerNotes: z.string().optional(),
});

const updateReviewSchema = z.object({
  aiGenerated: z
    .object({
      roleSummary: z.string().optional(),
      coreResponsibilities: z.string().optional(),
      strengths: z.string().optional(),
      areasForImprovement: z.string().optional(),
      goals: z.array(z.string()).optional(),
      finalRecommendation: z.string().optional(),
    })
    .optional(),
  categories: z
    .array(
      z.object({
        _id: z.string(),
        categoryName: z.string(),
        categoryDescription: z.string().optional(),
        reviewQuestions: z.array(z.string()).optional(),
        suggestedKpis: z.array(z.string()).optional(),
        managerCommentPrompt: z.string().optional(),
        rating: z.number().min(1).max(5).nullable().optional(),
        managerComments: z.string().optional(),
        sortOrder: z.number().optional(),
      })
    )
    .optional(),
  overallRating: z.number().min(1).max(5).nullable().optional(),
  clientSatisfactionScore: z.number().min(1).max(5).nullable().optional(),
  managerRatingInputs: z.record(z.unknown()).nullable().optional(),
  finalRecommendation: z.string().nullable().optional(),
  reviewedByUserId: z.string().nullable().optional(),
});

const regenerateSectionSchema = z.object({
  section: z.enum(['categories', 'goals', 'summary']),
});

router.use(authenticate);
router.use(requireAppAccess('crm'));

router.get('/', requireRoles('admin', 'account_manager', 'va'), getAllReviews);
router.post(
  '/',
  requireRoles('admin', 'account_manager'),
  validate(generateReviewSchema),
  generateReview
);
router.get('/:id', requireRoles('admin', 'account_manager', 'va'), getReviewById);
// /:id/complete must be registered before /:id to prevent Express matching 'complete' as :id
router.patch('/:id/complete', requireRoles('admin', 'account_manager'), completeReview);
router.patch(
  '/:id',
  requireRoles('admin', 'account_manager'),
  validate(updateReviewSchema),
  updateReview
);
router.post(
  '/:id/regenerate',
  requireRoles('admin', 'account_manager'),
  validate(regenerateSectionSchema),
  regenerateSection
);

export default router;
