import mongoose, { Document, model, Schema } from 'mongoose';
import type { IDispositionReason } from './dispositionReason.types';

export interface IDispositionReasonDocument
  extends
    Omit<IDispositionReason, '_id' | 'createdBy' | 'updatedBy'>,
    Document {
  createdBy: mongoose.Types.ObjectId | null;
  updatedBy: mongoose.Types.ObjectId | null;
  toSafeObject(): IDispositionReason;
}

const dispositionReasonSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: [
        'experience_and_qualifications',
        'interview_performance',
        'availability_and_employment',
        'recruiter_or_client_selection',
        'candidate_actions',
        'permanently_ineligible_reasons',
        'other',
      ],
      required: true,
    },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    applicableStages: { type: [String], default: [] },
    defaultEligibility: {
      type: String,
      enum: ['eligible', 'permanently_ineligible'],
      default: 'eligible',
    },
    requireInternalNotes: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

dispositionReasonSchema.index({ isActive: 1 });
dispositionReasonSchema.index({ category: 1, order: 1 });

dispositionReasonSchema.methods.toSafeObject = function (): IDispositionReason {
  const raw = this.toObject({
    versionKey: false,
  }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['createdBy'] = raw['createdBy'] ? String(raw['createdBy']) : null;
  raw['updatedBy'] = raw['updatedBy'] ? String(raw['updatedBy']) : null;
  return raw as unknown as IDispositionReason;
};

export default model<IDispositionReasonDocument>(
  'DispositionReason',
  dispositionReasonSchema
);
