import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import {
  createInterviewScorecard,
  getInterviewScorecard,
  listInterviewScorecards,
} from './interview-scorecard.controller';

// ── Schemas ────────────────────────────────────────────────────────────────
// rate fields are integers 1–5
const ratingField = z.number().int().min(1).max(5);

const EXPERIENCE_SELECTIONS = [
  'relevant_job_experience',
  'understanding_of_position',
  'applicable_software_experience',
  'work_setting_bpo_call_center',
  'work_setting_healthcare_provider',
  'work_setting_insurance_company',
  'work_setting_other_us_client',
  'work_setting_other',
] as const;

const FINAL_RECOMMENDATIONS = [
  'strongly_recommend',
  'recommend',
  'recommend_with_concerns',
  'hold_for_another_position',
  'do_not_recommend',
] as const;

// Create: deliberately does NOT accept server-computed score fields
// (communicationRating, *Weighted, overallScore) — the service recomputes
// them and overwrites any client-supplied values.
const createScorecardSchema = z.object({
  candidateId: z.string().min(1, 'candidateId is required'),
  jobId: z.string().min(1, 'jobId is required'),
  // Optional in the schema → service defaults to req.user._id
  interviewerId: z.string().min(1).optional(),

  interviewDate: z.string().datetime(),
  interviewType: z.enum(['initial_screening']).default('initial_screening'),

  // Category 1 — Communication
  commEnglishDiction: ratingField,
  commEnglishComprehension: ratingField,
  // NOTE: communicationRating is intentionally NOT accepted from the client.
  // Category 2 — Relevant Experience
  experienceSelections: z.array(z.enum(EXPERIENCE_SELECTIONS)).default([]),
  experienceRating: ratingField,
  // Category 3 — Professionalism
  profPreparedOnTime: z.boolean(),
  profAppearanceDemeanor: z.boolean(),
  profAttitudeReliability: z.boolean(),
  profInterestInPosition: z.boolean(),
  professionalismRating: ratingField,
  // Category 4 — Office & Technology Setup
  techInternetSpeed: z.boolean(),
  techHeadsetNoiseCancelling: z.boolean(),
  techTwoScreens: z.boolean(),
  techBackupInternet: z.boolean(),
  techBackupGenerator: z.boolean(),
  technologyRating: ratingField,
  // Category 5 — Availability & Overall Fit
  availUsHours: z.boolean(),
  availCompensationAcceptable: z.boolean(),
  availStartAvailability: z.boolean(),
  availOverallFit: z.boolean(),
  availabilityRating: ratingField,

  // Interview notes (all optional)
  strengths: z.string().optional().default(''),
  concerns: z.string().optional().default(''),
  generalNotes: z.string().optional().default(''),
  recommendedPosition: z.string().optional().default(''),
  earliestStartDate: z.string().datetime().optional().nullable().default(null),
  compensationExpectation: z.string().optional().default(''),

  // Final recommendation — REQUIRED (blocks save if missing)
  finalRecommendation: z.enum(FINAL_RECOMMENDATIONS),
});

// List: candidateId is REQUIRED per the J4 override. validate() will surface
// a 400 VALIDATION_ERROR with `{ field: 'candidateId', message: '…' }` on miss.
const listScorecardsSchema = z.object({
  candidateId: z.string().min(1, 'candidateId is required'),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ── Router ────────────────────────────────────────────────────────────────
const router = Router();

router.use(authenticate);
router.use(requireAppAccess('ats'));

router.post(
  '/',
  requirePermission('interviewScorecards', 'write'),
  validate(createScorecardSchema),
  createInterviewScorecard
);

router.get(
  '/',
  requirePermission('interviewScorecards', 'read'),
  validate(listScorecardsSchema, 'query'),
  listInterviewScorecards
);

router.get(
  '/:id',
  requirePermission('interviewScorecards', 'read'),
  getInterviewScorecard
);

export default router;
