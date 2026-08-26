import AppError from '../../shared/utils/AppError';
import { emitToAts } from '../../sockets';
// activityLog.types.ts is not in the allowed-edit list, so we reuse the
// generic 'created' action and carry the scorecard-specific verb in the
// description + metadata (see "Anything that didn't go as planned" in the
// completion report).
import mongoose from 'mongoose';
import { createLog } from '../activity-logs/activityLog.service';
import Candidate from '../candidates/candidate.model';
import Job from '../jobs/job.model';
import InterviewScorecard from './interview-scorecard.model';
import type {
  CreateInterviewScorecardInput,
  IInterviewScorecard,
  UpdateInterviewScorecardInput,
} from './interview-scorecard.types';
import { CATEGORY_WEIGHTS } from './interview-scorecard.types';

/**
 * Recompute all server-derived score fields from raw interviewer inputs.
 * Pure function — shared between save path and any future read-time audit.
 * Trust NOTHING from the client; the recomputed `communicationRating`
 * always overrides any client-supplied value (see J12 in plan).
 */
export function computeScores(input: {
  commEnglishDiction: number;
  commEnglishComprehension: number;
  experienceRating: number;
  professionalismRating: number;
  technologyRating: number;
  availabilityRating: number;
}) {
  const communicationRating = Math.round(
    (input.commEnglishDiction + input.commEnglishComprehension) / 2
  );

  const communicationWeighted = round1(
    (communicationRating / 5) * CATEGORY_WEIGHTS.communication
  );
  const experienceWeighted = round1(
    (input.experienceRating / 5) * CATEGORY_WEIGHTS.experience
  );
  const professionalismWeighted = round1(
    (input.professionalismRating / 5) * CATEGORY_WEIGHTS.professionalism
  );
  const technologyWeighted = round1(
    (input.technologyRating / 5) * CATEGORY_WEIGHTS.technology
  );
  const availabilityWeighted = round1(
    (input.availabilityRating / 5) * CATEGORY_WEIGHTS.availability
  );

  const overallScore = round1(
    communicationWeighted +
      experienceWeighted +
      professionalismWeighted +
      technologyWeighted +
      availabilityWeighted
  );

  return {
    communicationRating,
    communicationWeighted,
    experienceWeighted,
    professionalismWeighted,
    technologyWeighted,
    availabilityWeighted,
    overallScore,
  };
}

/** Round to 1 decimal place - matches the spec's overallScore requirement. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const createScorecard = async (
  input: CreateInterviewScorecardInput,
  createdBy: string
): Promise<IInterviewScorecard> => {
  // Validate candidate + job exist (fail fast, fail meaningfully)
  const [candidate, job] = await Promise.all([
    Candidate.findById(input.candidateId),
    Job.findById(input.jobId),
  ]);
  if (!candidate) {
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');
  }
  if (!job) {
    throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
  }

  // Recompute server-derived fields — IGNORE any client value for them.
  const computed = computeScores({
    commEnglishDiction: input.commEnglishDiction,
    commEnglishComprehension: input.commEnglishComprehension,
    experienceRating: input.experienceRating,
    professionalismRating: input.professionalismRating,
    technologyRating: input.technologyRating,
    availabilityRating: input.availabilityRating,
  });

  const doc = await InterviewScorecard.create({
    candidateId: input.candidateId,
    jobId: input.jobId,
    interviewerId: input.interviewerId,
    interviewDate: new Date(input.interviewDate),
    interviewType: 'initial_screening',
    // raw category 1 inputs
    commEnglishDiction: input.commEnglishDiction,
    commEnglishComprehension: input.commEnglishComprehension,
    // recomputed communicationRating
    communicationRating: computed.communicationRating,
    // category 2
    experienceSelections: input.experienceSelections ?? [],
    experienceRating: input.experienceRating,
    // category 3
    profPreparedOnTime: input.profPreparedOnTime,
    profAppearanceDemeanor: input.profAppearanceDemeanor,
    profAttitudeReliability: input.profAttitudeReliability,
    profInterestInPosition: input.profInterestInPosition,
    professionalismRating: input.professionalismRating,
    // category 4
    techInternetSpeed: input.techInternetSpeed,
    techHeadsetNoiseCancelling: input.techHeadsetNoiseCancelling,
    techTwoScreens: input.techTwoScreens,
    techBackupInternet: input.techBackupInternet,
    techBackupGenerator: input.techBackupGenerator,
    technologyRating: input.technologyRating,
    // category 5
    availUsHours: input.availUsHours,
    availCompensationAcceptable: input.availCompensationAcceptable,
    availStartAvailability: input.availStartAvailability,
    availOverallFit: input.availOverallFit,
    availabilityRating: input.availabilityRating,
    // weighted + overall (recomputed, ignored if supplied)
    communicationWeighted: computed.communicationWeighted,
    experienceWeighted: computed.experienceWeighted,
    professionalismWeighted: computed.professionalismWeighted,
    technologyWeighted: computed.technologyWeighted,
    availabilityWeighted: computed.availabilityWeighted,
    overallScore: computed.overallScore,
    // notes
    strengths: input.strengths ?? '',
    concerns: input.concerns ?? '',
    generalNotes: input.generalNotes ?? '',
    recommendedPosition: input.recommendedPosition ?? '',
    earliestStartDate: input.earliestStartDate
      ? new Date(input.earliestStartDate)
      : null,
    compensationExpectation: input.compensationExpectation ?? '',
    // required
    finalRecommendation: input.finalRecommendation,
    createdBy,
  });

  const safe = doc.toSafeObject();

  // Activity log + realtime — matches interview.service.ts pattern.
  // (createLog swallows/loggs errors internally, so we don't need a
  // try/catch here; logging is best-effort and never blocks a save.)
  await createLog({
    action: 'created',
    resourceType: 'candidate',
    resourceId: input.candidateId,
    relatedType: 'interview_scorecard',
    relatedId: safe._id,
    description: `Interview scorecard created for ${candidate.firstName} ${candidate.lastName} — overall ${computed.overallScore}/100`,
    metadata: {
      scorecardId: safe._id,
      jobId: input.jobId,
      overallScore: computed.overallScore,
      finalRecommendation: input.finalRecommendation,
    },
    performedBy: createdBy,
  });

  emitToAts(
    // broadcast to the candidate's room so any open candidate views refresh
    `candidate:${input.candidateId}`,
    'interview-scorecard:created',
    safe
  );

  return safe;
};

export const getScorecardById = async (
  id: string
): Promise<IInterviewScorecard> => {
  const doc = await InterviewScorecard.findById(id);
  if (!doc) {
    throw new AppError(
      404,
      'INTERVIEW_SCORECARD_NOT_FOUND',
      'Interview scorecard not found'
    );
  }
  return doc.toSafeObject();
};

export const getScorecardsByCandidate = async (
  candidateId: string,
  opts: { page?: number; limit?: number } = {}
): Promise<{
  scorecards: IInterviewScorecard[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  const skip = (page - 1) * limit;
  const [scorecards, total] = await Promise.all([
    InterviewScorecard.find({ candidateId })
      .sort({ interviewDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    InterviewScorecard.countDocuments({ candidateId }),
  ]);

  return {
    scorecards: scorecards.map(s => s.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const updateScorecard = async (
  id: string,
  input: UpdateInterviewScorecardInput,
  performedBy: string
): Promise<IInterviewScorecard> => {
  const doc = await InterviewScorecard.findById(id);
  if (!doc) {
    throw new AppError(
      404,
      'INTERVIEW_SCORECARD_NOT_FOUND',
      'Interview scorecard not found'
    );
  }

  // Recompute server-derived fields — IGNORE any client value for them.
  const computed = computeScores({
    commEnglishDiction: input.commEnglishDiction,
    commEnglishComprehension: input.commEnglishComprehension,
    experienceRating: input.experienceRating,
    professionalismRating: input.professionalismRating,
    technologyRating: input.technologyRating,
    availabilityRating: input.availabilityRating,
  });

  doc.interviewDate = new Date(input.interviewDate);
  if (input.interviewerId) {
    doc.interviewerId =
      input.interviewerId as unknown as mongoose.Types.ObjectId;
  }
  doc.interviewType = 'initial_screening';

  // raw category 1 inputs + recomputed rating
  doc.commEnglishDiction = input.commEnglishDiction;
  doc.commEnglishComprehension = input.commEnglishComprehension;
  doc.communicationRating = computed.communicationRating;
  // category 2
  doc.experienceSelections = input.experienceSelections ?? [];
  doc.experienceRating = input.experienceRating;
  // category 3
  doc.profPreparedOnTime = input.profPreparedOnTime;
  doc.profAppearanceDemeanor = input.profAppearanceDemeanor;
  doc.profAttitudeReliability = input.profAttitudeReliability;
  doc.profInterestInPosition = input.profInterestInPosition;
  doc.professionalismRating = input.professionalismRating;
  // category 4
  doc.techInternetSpeed = input.techInternetSpeed;
  doc.techHeadsetNoiseCancelling = input.techHeadsetNoiseCancelling;
  doc.techTwoScreens = input.techTwoScreens;
  doc.techBackupInternet = input.techBackupInternet;
  doc.techBackupGenerator = input.techBackupGenerator;
  doc.technologyRating = input.technologyRating;
  // category 5
  doc.availUsHours = input.availUsHours;
  doc.availCompensationAcceptable = input.availCompensationAcceptable;
  doc.availStartAvailability = input.availStartAvailability;
  doc.availOverallFit = input.availOverallFit;
  doc.availabilityRating = input.availabilityRating;
  // weighted + overall (recomputed, ignored if supplied)
  doc.communicationWeighted = computed.communicationWeighted;
  doc.experienceWeighted = computed.experienceWeighted;
  doc.professionalismWeighted = computed.professionalismWeighted;
  doc.technologyWeighted = computed.technologyWeighted;
  doc.availabilityWeighted = computed.availabilityWeighted;
  doc.overallScore = computed.overallScore;
  // notes
  doc.strengths = input.strengths ?? '';
  doc.concerns = input.concerns ?? '';
  doc.generalNotes = input.generalNotes ?? '';
  doc.recommendedPosition = input.recommendedPosition ?? '';
  doc.earliestStartDate = input.earliestStartDate
    ? new Date(input.earliestStartDate)
    : null;
  doc.compensationExpectation = input.compensationExpectation ?? '';
  // required
  doc.finalRecommendation = input.finalRecommendation;

  await doc.save();
  const safe = doc.toSafeObject();

  await createLog({
    action: 'updated',
    resourceType: 'candidate',
    resourceId: safe.candidateId,
    relatedType: 'interview_scorecard',
    relatedId: safe._id,
    description: `Interview scorecard updated — overall ${computed.overallScore}/100`,
    metadata: {
      scorecardId: safe._id,
      jobId: safe.jobId,
      overallScore: computed.overallScore,
      finalRecommendation: input.finalRecommendation,
    },
    performedBy,
  });

  emitToAts(
    `candidate:${safe.candidateId}`,
    'interview-scorecard:updated',
    safe
  );

  return safe;
};
