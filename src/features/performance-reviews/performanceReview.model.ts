import mongoose, { Document, model, Schema } from 'mongoose';
import type {
  IPerformanceCategory,
  IPerformanceReview,
  IPerformanceReviewAiGenerated,
} from './performanceReview.types';

export interface IPerformanceReviewDocument
  extends
    Omit<
      IPerformanceReview,
      | '_id'
      | 'candidateId'
      | 'clientId'
      | 'jobId'
      | 'generatedByUserId'
      | 'reviewedByUserId'
      | 'categories'
      | 'aiGenerated'
    >,
    Document {
  candidateId: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  jobId: mongoose.Types.ObjectId | null;
  generatedByUserId: mongoose.Types.ObjectId;
  reviewedByUserId: mongoose.Types.ObjectId | null;
  aiGenerated: IPerformanceReviewAiGenerated | null;
  categories: Array<
    Omit<IPerformanceCategory, '_id'> & { _id: mongoose.Types.ObjectId }
  >;
  toSafeObject(): IPerformanceReview;
}

const aiGeneratedSchema = new Schema(
  {
    roleSummary: { type: String, default: '' },
    coreResponsibilities: { type: [String], default: [] },
    strengths: { type: String, default: '' },
    areasForImprovement: { type: String, default: '' },
    goals: { type: [String], default: [] },
    finalRecommendation: { type: String, default: '' },
    generatedAt: { type: Date },
  },
  { _id: false }
);

const categorySchema = new Schema({
  categoryName: { type: String, required: true },
  categoryDescription: { type: String, default: '' },
  reviewQuestions: { type: [String], default: [] },
  suggestedKpis: { type: [String], default: [] },
  managerCommentPrompt: { type: String, default: '' },
  rating: { type: Number, min: 1, max: 5, default: null },
  managerComments: { type: String, default: '' },
  sortOrder: { type: Number, default: 0 },
});

const performanceReviewSchema = new Schema(
  {
    candidateId: {
      type: Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true,
    },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    reviewType: {
      type: String,
      enum: [
        '30_day',
        '60_day',
        '90_day',
        'annual',
        'client_satisfaction',
        'corrective_coaching',
      ],
      required: true,
    },
    reviewPeriodStart: { type: Date, required: true },
    reviewPeriodEnd: { type: Date, required: true },
    status: {
      type: String,
      enum: [
        'draft',
        'ai_generated',
        'in_review',
        'sent_to_client',
        'archived',
        'completed',
      ],
      default: 'draft',
    },
    aiGenerated: { type: aiGeneratedSchema, default: null },
    categories: { type: [categorySchema], default: [] },
    overallRating: { type: Number, min: 1, max: 5, default: null },
    clientSatisfactionScore: { type: Number, min: 1, max: 5, default: null },
    managerRatingInputs: { type: Schema.Types.Mixed, default: null },
    finalRecommendation: { type: String, default: null },
    finalManagerSummary: { type: String, default: '' },
    generatedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reviewedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

performanceReviewSchema.index({ candidateId: 1 });
performanceReviewSchema.index({ clientId: 1 });
performanceReviewSchema.index({ status: 1 });
performanceReviewSchema.index({ reviewType: 1 });
performanceReviewSchema.index({ candidateId: 1, reviewType: 1 });
performanceReviewSchema.index({ createdAt: -1 });

performanceReviewSchema.methods.toSafeObject = function (): IPerformanceReview {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['candidateId'] = String(raw['candidateId']);
  raw['clientId'] = String(raw['clientId']);
  raw['jobId'] = raw['jobId'] ? String(raw['jobId']) : null;
  raw['generatedByUserId'] = String(raw['generatedByUserId']);
  raw['reviewedByUserId'] = raw['reviewedByUserId']
    ? String(raw['reviewedByUserId'])
    : null;

  if (Array.isArray(raw['categories'])) {
    raw['categories'] = (
      raw['categories'] as Array<Record<string, unknown>>
    ).map(cat => ({
      ...cat,
      _id: String(cat['_id']),
    }));
  }

  return raw as unknown as IPerformanceReview;
};

export default model<IPerformanceReviewDocument>(
  'PerformanceReview',
  performanceReviewSchema
);
