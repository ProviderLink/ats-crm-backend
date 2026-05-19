import mongoose, { Document, Schema, model } from 'mongoose';
import type { IWorkEntry } from './workEntry.types';

export interface IWorkEntryDocument
  extends
    Omit<IWorkEntry, '_id' | 'assignmentId' | 'candidateId' | 'clientId'>,
    Document {
  assignmentId: mongoose.Types.ObjectId;
  candidateId: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  toSafeObject(): IWorkEntry;
}

const workEntrySchema = new Schema(
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
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    entryDate: { type: Date, required: true },
    entryTime: { type: String, required: true },
    taskCategory: { type: String, required: true },
    taskDescription: { type: String, required: true },
    timeSpent: { type: Number, required: true },
    status: {
      type: String,
      enum: ['completed', 'in_progress', 'pending'],
      default: 'completed',
    },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

workEntrySchema.index({ assignmentId: 1 });
workEntrySchema.index({ candidateId: 1 });
workEntrySchema.index({ clientId: 1 });
workEntrySchema.index({ entryDate: -1 });
workEntrySchema.index({ assignmentId: 1, entryDate: -1 });

workEntrySchema.methods.toSafeObject = function (): IWorkEntry {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['assignmentId'] = String(raw['assignmentId']);
  raw['candidateId'] = String(raw['candidateId']);
  raw['clientId'] = String(raw['clientId']);
  return raw as unknown as IWorkEntry;
};

export default model<IWorkEntryDocument>('WorkEntry', workEntrySchema);
