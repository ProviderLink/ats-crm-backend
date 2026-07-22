import mongoose, { Document, Schema, model } from 'mongoose';
import type { IScorecard } from './scorecard.types';

export interface IScorecardDocument
  extends Omit<IScorecard, '_id' | 'vaId' | 'assignmentId'>, Document {
  vaId: mongoose.Types.ObjectId;
  assignmentId: mongoose.Types.ObjectId;
  toSafeObject(): IScorecard;
}

const scorecardSchema = new Schema(
  {
    vaId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },
    assignmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Assignment',
      required: true,
    },
    weekStart: { type: Date, required: true },
    weekEnd: { type: Date, required: true },
    totalHours: { type: Number, default: 0 },
    totalTasksCompleted: { type: Number, default: 0 },
    avgTasksPerDay: { type: Number, default: 0 },
    eodComplianceRate: { type: Number, default: 0 },
    onTimeSubmissionRate: { type: Number, default: 0 },
    productivityScore: { type: Number, default: 0 },
    categoryDistribution: { type: Schema.Types.Mixed, default: {} },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

scorecardSchema.index({ vaId: 1, weekStart: 1 });
scorecardSchema.index({ assignmentId: 1 });
scorecardSchema.index({ generatedAt: -1 });
scorecardSchema.index(
  { vaId: 1, assignmentId: 1, weekStart: 1 },
  { unique: true }
);

scorecardSchema.methods.toSafeObject = function (): IScorecard {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['vaId'] = String(raw['vaId']);
  raw['assignmentId'] = String(raw['assignmentId']);
  return raw as unknown as IScorecard;
};

export default model<IScorecardDocument>('Scorecard', scorecardSchema);
