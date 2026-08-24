// ── Shared constants ─────────────────────────────────────────────────────
export const EXPERIENCE_SELECTIONS = [
  'relevant_job_experience',
  'understanding_of_position',
  'applicable_software_experience',
  'work_setting_bpo_call_center',
  'work_setting_healthcare_provider',
  'work_setting_insurance_company',
  'work_setting_other_us_client',
  'work_setting_other',
] as const;
export type ExperienceSelection = (typeof EXPERIENCE_SELECTIONS)[number];

export const FINAL_RECOMMENDATIONS = [
  'strongly_recommend',
  'recommend',
  'recommend_with_concerns',
  'hold_for_another_position',
  'do_not_recommend',
] as const;
export type FinalRecommendation = (typeof FINAL_RECOMMENDATIONS)[number];

export const INTERVIEW_TYPES = ['initial_screening'] as const;
export type InterviewScorecardType = (typeof INTERVIEW_TYPES)[number];

// ── Weights (single source of truth for server-computed weighted scores) ──
export const CATEGORY_WEIGHTS = {
  communication: 30,
  experience: 25,
  professionalism: 15,
  technology: 20,
  availability: 10,
} as const;

// ── Scorecard entity (matches the Mongoose document) ──────────────────────
export interface IInterviewScorecard {
  _id: string;
  candidateId: string;
  jobId: string;
  interviewerId: string;

  interviewDate: Date;
  interviewType: InterviewScorecardType;

  // Category 1 — Communication (weight 30)
  commEnglishDiction: number;
  commEnglishComprehension: number;
  communicationRating: number;

  // Category 2 — Relevant Experience (weight 25)
  experienceSelections: ExperienceSelection[];
  experienceRating: number;

  // Category 3 — Professionalism (weight 15)
  profPreparedOnTime: boolean;
  profAppearanceDemeanor: boolean;
  profAttitudeReliability: boolean;
  profInterestInPosition: boolean;
  professionalismRating: number;

  // Category 4 — Office & Technology Setup (weight 20)
  techInternetSpeed: boolean;
  techHeadsetNoiseCancelling: boolean;
  techTwoScreens: boolean;
  techBackupInternet: boolean;
  techBackupGenerator: boolean;
  technologyRating: number;

  // Category 5 — Availability & Overall Fit (weight 10)
  availUsHours: boolean;
  availCompensationAcceptable: boolean;
  availStartAvailability: boolean;
  availOverallFit: boolean;
  availabilityRating: number;

  // Server-computed weighted scores
  communicationWeighted: number;
  experienceWeighted: number;
  professionalismWeighted: number;
  technologyWeighted: number;
  availabilityWeighted: number;
  overallScore: number;

  // Interview notes
  strengths: string;
  concerns: string;
  generalNotes: string;
  recommendedPosition: string;
  earliestStartDate: Date | null;
  compensationExpectation: string;

  // Final recommendation (REQUIRED)
  finalRecommendation: FinalRecommendation;

  // Standard
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Input shape accepted from the client (recomputed fields deliberately excluded) ──
export interface CreateInterviewScorecardInput {
  candidateId: string;
  jobId: string;
  interviewerId: string;
  interviewDate: Date | string;
  // Deliberately NO: communicationRating, communicationWeighted,
  // experienceWeighted, professionalismWeighted, technologyWeighted,
  // availabilityWeighted, overallScore. The service computes these.
  commEnglishDiction: number;
  commEnglishComprehension: number;
  experienceSelections: ExperienceSelection[];
  experienceRating: number;
  profPreparedOnTime: boolean;
  profAppearanceDemeanor: boolean;
  profAttitudeReliability: boolean;
  profInterestInPosition: boolean;
  professionalismRating: number;
  techInternetSpeed: boolean;
  techHeadsetNoiseCancelling: boolean;
  techTwoScreens: boolean;
  techBackupInternet: boolean;
  techBackupGenerator: boolean;
  technologyRating: number;
  availUsHours: boolean;
  availCompensationAcceptable: boolean;
  availStartAvailability: boolean;
  availOverallFit: boolean;
  availabilityRating: number;
  strengths?: string;
  concerns?: string;
  generalNotes?: string;
  recommendedPosition?: string;
  earliestStartDate?: Date | string | null;
  compensationExpectation?: string;
  finalRecommendation: FinalRecommendation;
}
