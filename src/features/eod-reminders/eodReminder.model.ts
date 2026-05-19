import mongoose, { Document, Schema, model } from 'mongoose';
import type { IEodReminder } from './eodReminder.types';

export interface IEodReminderDocument
  extends Omit<IEodReminder, '_id' | 'assignmentId' | 'candidateId'>, Document {
  assignmentId: mongoose.Types.ObjectId;
  candidateId: mongoose.Types.ObjectId;
  toSafeObject(): IEodReminder;
}

const eodReminderSchema = new Schema(
  {
    assignmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Assignment',
      required: true,
    },
    candidateId: {
      type: Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true,
    },
    reminderDate: { type: Date, required: true },
    reminderType: { type: String, default: 'missing_eod' },
    status: { type: String, enum: ['sent', 'failed'], required: true },
  },
  { timestamps: true }
);

eodReminderSchema.index({ candidateId: 1 });
eodReminderSchema.index({ assignmentId: 1 });
eodReminderSchema.index({ status: 1 });
eodReminderSchema.index({ reminderDate: -1 });

eodReminderSchema.methods.toSafeObject = function (): IEodReminder {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['assignmentId'] = String(raw['assignmentId']);
  raw['candidateId'] = String(raw['candidateId']);
  return raw as unknown as IEodReminder;
};

export default model<IEodReminderDocument>('EodReminder', eodReminderSchema);
