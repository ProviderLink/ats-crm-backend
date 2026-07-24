export type ReviewType =
  | '30_day'
  | '60_day'
  | '90_day'
  | 'annual'
  | 'client_satisfaction'
  | 'corrective_coaching';

export type ReviewStatus =
  | 'draft'
  | 'ai_generated'
  | 'in_review'
  | 'sent_to_client'
  | 'archived'
  | 'completed';

export interface IPerformanceCategory {
  _id: string;
  categoryName: string;
  categoryDescription: string;
  reviewQuestions: string[];
  suggestedKpis: string[];
  managerCommentPrompt: string;
  rating: number | null;
  managerComments: string;
  sortOrder: number;
}

export interface IPerformanceReviewAiGenerated {
  roleSummary: string;
  coreResponsibilities: string[];
  strengths: string;
  areasForImprovement: string;
  goals: string[];
  finalRecommendation: string;
  generatedAt: Date;
}

export interface IPerformanceReview {
  _id: string;
  candidateId: string;
  clientId: string;
  jobId: string | null;
  reviewType: ReviewType;
  reviewPeriodStart: Date;
  reviewPeriodEnd: Date;
  status: ReviewStatus;
  aiGenerated: IPerformanceReviewAiGenerated | null;
  categories: IPerformanceCategory[];
  overallRating: number | null;
  clientSatisfactionScore: number | null;
  managerRatingInputs: Record<string, unknown> | null;
  finalRecommendation: string | null;
  finalManagerSummary: string;
  generatedByUserId: string;
  reviewedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerateReviewInput {
  candidateId: string;
  clientId: string;
  jobId?: string;
  jobDescription?: string;
  reviewType: ReviewType;
  reviewPeriodStart: Date | string;
  reviewPeriodEnd: Date | string;
  roleType: string;
  clientExpectations?: string;
  managerNotes?: string;
  generatedByUserId: string;
}

export interface UpdateReviewInput {
  aiGenerated?: Partial<IPerformanceReviewAiGenerated>;
  categories?: IPerformanceCategory[];
  overallRating?: number | null;
  clientSatisfactionScore?: number | null;
  managerRatingInputs?: Record<string, unknown> | null;
  finalRecommendation?: string | null;
  finalManagerSummary?: string;
  reviewedByUserId?: string | null;
  status?: ReviewStatus;
}

export interface RegenerateSection {
  section: 'categories' | 'goals' | 'summary';
}
