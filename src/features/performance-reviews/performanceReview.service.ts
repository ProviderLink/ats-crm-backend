import { AppError } from '../../shared/utils/AppError';
import { getAiProvider, parseJsonResponse } from '../../shared/utils/ai/index';
import { emitToCrm } from '../../sockets';
import { createLog } from '../activity-logs/activityLog.service';
import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
import Job from '../jobs/job.model';
import PerformanceReview from './performanceReview.model';
import type {
  GenerateReviewInput,
  IPerformanceReview,
  UpdateReviewInput,
} from './performanceReview.types';

export const getAllReviews = async (filters: {
  candidateId?: string;
  vaId?: string;
  clientId?: string;
  /** Extra Mongo condition, e.g. an account manager's own assignments. */
  scope?: Record<string, unknown>;
  reviewType?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{
  reviews: IPerformanceReview[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const {
    candidateId,
    vaId,
    clientId,
    scope,
    reviewType,
    status,
    page = 1,
    limit = 20,
  } = filters;
  const query: Record<string, unknown> = {};
  if (scope) query['$and'] = [scope];

  const effectiveCandidateId = candidateId ?? vaId;
  if (effectiveCandidateId !== undefined)
    query['candidateId'] = effectiveCandidateId;
  if (clientId !== undefined) query['clientId'] = clientId;
  if (reviewType !== undefined) query['reviewType'] = reviewType;
  if (status !== undefined) query['status'] = status;

  const skip = (page - 1) * limit;
  const [reviews, total] = await Promise.all([
    PerformanceReview.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    PerformanceReview.countDocuments(query),
  ]);

  const candidateIds = [
    ...new Set(reviews.map(r => String(r.candidateId)).filter(Boolean)),
  ];
  const clientIds = [
    ...new Set(reviews.map(r => String(r.clientId)).filter(Boolean)),
  ];

  const [candidateDocs, clientDocs] = await Promise.all([
    candidateIds.length > 0
      ? Candidate.find({ _id: { $in: candidateIds } }).select(
          'firstName lastName'
        )
      : [],
    clientIds.length > 0
      ? Client.find({ _id: { $in: clientIds } }).select('companyName')
      : [],
  ]);

  const candidateNameMap: Record<string, string> = Object.fromEntries(
    candidateDocs.map(c => [
      String(c._id),
      `${(c as any).firstName ?? ''} ${(c as any).lastName ?? ''}`.trim(),
    ])
  );
  const clientNameMap: Record<string, string> = Object.fromEntries(
    clientDocs.map(c => [String(c._id), String((c as any).companyName ?? '')])
  );

  return {
    reviews: reviews.map(r => ({
      ...r.toSafeObject(),
      candidateName: candidateNameMap[String(r.candidateId)] ?? '',
      clientName: clientNameMap[String(r.clientId)] ?? '',
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getReviewById = async (
  id: string
): Promise<IPerformanceReview> => {
  const review = await PerformanceReview.findById(id);
  if (!review) {
    throw new AppError(
      404,
      'PERFORMANCE_REVIEW_NOT_FOUND',
      'Performance review not found'
    );
  }
  return review.toSafeObject();
};

export const generateReview = async (
  input: GenerateReviewInput
): Promise<IPerformanceReview> => {
  const [candidate, client, job] = await Promise.all([
    Candidate.findById(input.candidateId),
    Client.findById(input.clientId),
    input.jobId ? Job.findById(input.jobId) : Promise.resolve(null),
  ]);

  const jobTitle = job?.title ?? 'Virtual Assistant';
  const jobDescription =
    job?.description ?? input.jobDescription ?? 'Not provided';

  const prompt = `
You are an expert HR performance review generator.
Generate a comprehensive performance review template
and respond with ONLY a JSON object, no markdown,
no explanation.

Employee: ${candidate?.firstName} ${candidate?.lastName}
Client: ${client?.companyName}
Job Title: ${jobTitle}
Job Description: ${jobDescription}
Role Type: ${input.roleType}
Review Type: ${input.reviewType}
Review Period: ${input.reviewPeriodStart} to ${input.reviewPeriodEnd}
Client Expectations: ${input.clientExpectations ?? 'Not provided'}
Manager Notes: ${input.managerNotes ?? 'Not provided'}

Respond with exactly this JSON structure:
{
  "roleSummary": "string",
  "coreResponsibilities": ["responsibility1", "responsibility2", "responsibility3"],
  "strengths": "string",
  "areasForImprovement": "string",
  "goals": ["goal1", "goal2", "goal3"],
  "finalRecommendation": "string",
  "categories": [
    {
      "categoryName": "string",
      "categoryDescription": "string",
      "reviewQuestions": ["q1", "q2"],
      "suggestedKpis": ["kpi1", "kpi2"],
      "managerCommentPrompt": "string",
      "sortOrder": 1
    }
  ]
}

Generate 6-8 relevant performance categories for this role.
`;

  const provider = await getAiProvider();
  const text = await provider.generate(prompt, { maxTokens: 2000 });
  const result = parseJsonResponse<{
    roleSummary: string;
    coreResponsibilities: string[];
    strengths: string;
    areasForImprovement: string;
    goals: string[];
    finalRecommendation: string;
    categories: Array<{
      categoryName: string;
      categoryDescription: string;
      reviewQuestions: string[];
      suggestedKpis: string[];
      managerCommentPrompt: string;
      sortOrder: number;
    }>;
  }>(text);

  if (!result) {
    throw new AppError(
      500,
      'AI_API_ERROR',
      'Failed to generate performance review'
    );
  }

  const review = await PerformanceReview.create({
    candidateId: input.candidateId,
    clientId: input.clientId,
    jobId: input.jobId ?? null,
    reviewType: input.reviewType,
    reviewPeriodStart: new Date(input.reviewPeriodStart),
    reviewPeriodEnd: new Date(input.reviewPeriodEnd),
    status: 'ai_generated',
    aiGenerated: {
      roleSummary: result.roleSummary,
      coreResponsibilities: Array.isArray(result.coreResponsibilities)
        ? result.coreResponsibilities
        : [result.coreResponsibilities].filter(Boolean),
      strengths: result.strengths,
      areasForImprovement: result.areasForImprovement,
      goals: result.goals,
      finalRecommendation: result.finalRecommendation,
      generatedAt: new Date(),
    },
    categories: result.categories.map((c, index) => ({
      ...c,
      rating: null,
      managerComments: '',
      sortOrder: c.sortOrder ?? index + 1,
    })),
    generatedByUserId: input.generatedByUserId,
  });

  createLog({
    action: 'review_generated',
    resourceType: 'performance_review',
    resourceId: review._id.toString(),
    relatedType: 'candidate',
    relatedId: input.candidateId,
    performedBy: input.generatedByUserId,
  });

  const reviewData = review.toSafeObject();
  emitToCrm('assignments', 'performanceReview:created', reviewData);
  return reviewData;
};

export const updateReview = async (
  id: string,
  input: UpdateReviewInput,
  updatedBy: string
): Promise<IPerformanceReview> => {
  const review = await PerformanceReview.findById(id);
  if (!review) {
    throw new AppError(
      404,
      'PERFORMANCE_REVIEW_NOT_FOUND',
      'Performance review not found'
    );
  }

  if (review.status === 'completed') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Cannot update a completed review'
    );
  }

  if (input.status !== undefined && input.status !== review.status) {
    if (input.status === 'completed') {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Use the /complete endpoint to mark a review as completed'
      );
    }
    review.status = input.status;
  }

  if (input.finalManagerSummary !== undefined) {
    review.finalManagerSummary = input.finalManagerSummary;
  }

  if (input.aiGenerated !== undefined) {
    review.aiGenerated = {
      ...(review.aiGenerated ?? {
        roleSummary: '',
        coreResponsibilities: [],
        strengths: '',
        areasForImprovement: '',
        goals: [],
        finalRecommendation: '',
        generatedAt: new Date(),
      }),
      ...input.aiGenerated,
    };
    review.markModified('aiGenerated');
  }

  if (input.categories !== undefined) {
    review.categories = input.categories as unknown as typeof review.categories;
    review.markModified('categories');
  }

  if (input.overallRating !== undefined) {
    review.overallRating = input.overallRating;
  }

  if (input.clientSatisfactionScore !== undefined) {
    review.clientSatisfactionScore = input.clientSatisfactionScore;
  }

  if (input.managerRatingInputs !== undefined) {
    review.managerRatingInputs = input.managerRatingInputs;
    review.markModified('managerRatingInputs');
  }

  if (input.finalRecommendation !== undefined) {
    review.finalRecommendation = input.finalRecommendation;
  }

  if (input.reviewedByUserId !== undefined) {
    review.reviewedByUserId =
      input.reviewedByUserId as unknown as typeof review.reviewedByUserId;
  }

  await review.save();
  const result = review.toSafeObject();
  emitToCrm('assignments', 'performanceReview:updated', result);
  return result;
};

export const completeReview = async (
  id: string,
  completedBy: string
): Promise<IPerformanceReview> => {
  const review = await PerformanceReview.findById(id);
  if (!review) {
    throw new AppError(
      404,
      'PERFORMANCE_REVIEW_NOT_FOUND',
      'Performance review not found'
    );
  }

  if (review.status === 'completed') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Review is already completed');
  }

  review.status = 'completed';
  review.reviewedByUserId =
    completedBy as unknown as typeof review.reviewedByUserId;
  await review.save();

  createLog({
    action: 'review_completed',
    resourceType: 'performance_review',
    resourceId: id,
    performedBy: completedBy,
  });

  const result = review.toSafeObject();
  emitToCrm('assignments', 'performanceReview:updated', result);
  return result;
};

export const deleteReview = async (
  id: string,
  deletedBy?: string | null
): Promise<void> => {
  const review = await PerformanceReview.findById(id);
  if (!review) {
    throw new AppError(
      404,
      'PERFORMANCE_REVIEW_NOT_FOUND',
      'Performance review not found'
    );
  }

  await PerformanceReview.findByIdAndDelete(id);

  createLog({
    action: 'review_deleted',
    resourceType: 'performance_review',
    resourceId: id,
    performedBy: deletedBy ?? null,
  });

  emitToCrm('assignments', 'performanceReview:deleted', { reviewId: id });
};

export const regenerateSection = async (
  id: string,
  section: 'categories' | 'goals' | 'summary'
): Promise<IPerformanceReview> => {
  const review = await PerformanceReview.findById(id);
  if (!review) {
    throw new AppError(
      404,
      'PERFORMANCE_REVIEW_NOT_FOUND',
      'Performance review not found'
    );
  }

  if (review.status === 'completed') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Cannot regenerate sections of a completed review'
    );
  }

  let prompt: string;

  if (section === 'categories') {
    prompt = `
You are an expert HR performance review generator.
Regenerate the performance categories for an existing review.
Respond with ONLY a JSON object, no markdown, no explanation.

Respond with exactly this JSON structure:
{
  "categories": [
    {
      "categoryName": "string",
      "categoryDescription": "string",
      "reviewQuestions": ["q1", "q2"],
      "suggestedKpis": ["kpi1", "kpi2"],
      "managerCommentPrompt": "string",
      "sortOrder": 1
    }
  ]
}

Generate 6-8 relevant performance categories.
`;
  } else if (section === 'goals') {
    prompt = `
You are an expert HR performance review generator.
Regenerate the performance goals for an existing review.
Respond with ONLY a JSON object, no markdown, no explanation.

Respond with exactly this JSON structure:
{
  "goals": ["goal1", "goal2", "goal3"]
}

Generate 3-5 actionable performance goals.
`;
  } else {
    prompt = `
You are an expert HR performance review generator.
Regenerate an improved role summary and core responsibilities for an existing review.
Respond with ONLY a JSON object, no markdown, no explanation.

Respond with exactly this JSON structure:
{
  "roleSummary": "string",
  "coreResponsibilities": "string"
}
`;
  }

  const provider = await getAiProvider();
  const text = await provider.generate(prompt, { maxTokens: 1500 });

  if (section === 'categories') {
    const result = parseJsonResponse<{
      categories: Array<{
        categoryName: string;
        categoryDescription: string;
        reviewQuestions: string[];
        suggestedKpis: string[];
        managerCommentPrompt: string;
        sortOrder: number;
      }>;
    }>(text);

    if (!result) {
      throw new AppError(
        500,
        'AI_API_ERROR',
        'Failed to regenerate categories'
      );
    }

    review.categories = result.categories.map((c, index) => ({
      ...c,
      rating: null,
      managerComments: '',
      sortOrder: c.sortOrder ?? index + 1,
    })) as unknown as typeof review.categories;
    review.markModified('categories');
  } else if (section === 'goals') {
    const result = parseJsonResponse<{ goals: string[] }>(text);

    if (!result) {
      throw new AppError(500, 'AI_API_ERROR', 'Failed to regenerate goals');
    }

    review.aiGenerated = {
      ...(review.aiGenerated ?? {
        roleSummary: '',
        coreResponsibilities: [],
        strengths: '',
        areasForImprovement: '',
        goals: [],
        finalRecommendation: '',
        generatedAt: new Date(),
      }),
      goals: result.goals,
    };
    review.markModified('aiGenerated');
  } else {
    const result = parseJsonResponse<{
      roleSummary: string;
      coreResponsibilities: string;
    }>(text);

    if (!result) {
      throw new AppError(500, 'AI_API_ERROR', 'Failed to regenerate summary');
    }

    review.aiGenerated = {
      ...(review.aiGenerated ?? {
        roleSummary: '',
        coreResponsibilities: [],
        strengths: '',
        areasForImprovement: '',
        goals: [],
        finalRecommendation: '',
        generatedAt: new Date(),
      }),
      roleSummary: result.roleSummary,
      coreResponsibilities: Array.isArray(result.coreResponsibilities)
        ? result.coreResponsibilities
        : [result.coreResponsibilities],
    };
    review.markModified('aiGenerated');
  }

  await review.save();
  return review.toSafeObject();
};
