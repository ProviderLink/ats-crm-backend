import mongoose, { Document, Schema, model } from 'mongoose';
import type { ISurveyReminder } from './surveyReminder.types';

export interface ISurveyReminderDocument
  extends Omit<ISurveyReminder, '_id' | 'relatedId' | 'assignedTo'>, Document {
  relatedId: mongoose.Types.ObjectId;
  assignedTo: mongoose.Types.ObjectId;
  toSafeObject(): ISurveyReminder;
}

const surveyReminderSchema = new Schema(
  {
    relatedType: { type: String, required: true },
    relatedId: { type: Schema.Types.ObjectId, required: true },
    surveyType: { type: String, required: true },
    dueDate: { type: Date, required: true },
    completedDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ['pending', 'sent', 'completed', 'skipped'],
      default: 'pending',
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

surveyReminderSchema.index({ relatedType: 1, relatedId: 1 });
surveyReminderSchema.index({ status: 1 });
surveyReminderSchema.index({ dueDate: 1 });
surveyReminderSchema.index({ assignedTo: 1 });
surveyReminderSchema.index({ status: 1, dueDate: 1 });

surveyReminderSchema.methods.toSafeObject = function (): ISurveyReminder {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['relatedId'] = String(raw['relatedId']);
  raw['assignedTo'] = String(raw['assignedTo']);
  return raw as unknown as ISurveyReminder;
};

export default model<ISurveyReminderDocument>(
  'SurveyReminder',
  surveyReminderSchema
);
