import mongoose, { Document, Schema, model } from 'mongoose';
import type { IEodSubmission, IEodWorkEntry } from './eodSubmission.types';

export interface IEodSubmissionDocument
  extends
    Omit<IEodSubmission, '_id' | 'assignmentId' | 'candidateId' | 'clientId'>,
    Document {
  assignmentId: mongoose.Types.ObjectId;
  candidateId: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  workEntries: IEodWorkEntry[];
  toSafeObject(): IEodSubmission;
}

const eodWorkEntrySchema = new Schema(
  {
    task: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ['completed', 'in_progress', 'pending'],
      default: 'completed',
    },
    timeSpent: { type: Number, required: true }, // minutes
  },
  { _id: false }
);

const eodSubmissionSchema = new Schema(
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
    date: { type: Date, required: true },
    shiftStart: { type: String, required: true },
    shiftEnd: { type: String, required: true },
    hoursWorked: { type: Number, required: true },
    // Legacy free-text summary. Preserved for historical records; new
    // submissions use the structured `workEntries` array instead. Kept as a
    // plain (not required) field so new documents can omit it.
    summaryOfWork: { type: String, default: null },
    workEntries: { type: [eodWorkEntrySchema], default: [] },
    pendingTasks: { type: String, required: true },
    blockers: { type: String, default: null },
    notes: { type: String, default: null },
    // Q2: Did you communicate with the client today? Null for historical records.
    communicatedWithClient: {
      type: String,
      enum: ['yes', 'no', 'other'],
      default: null,
    },
    // Q3: Additional notes/updates the VA wants the client to know.
    clientNote: { type: String, default: null },
  },
  { timestamps: true }
);

eodSubmissionSchema.index({ assignmentId: 1 });
eodSubmissionSchema.index({ candidateId: 1 });
eodSubmissionSchema.index({ clientId: 1 });
eodSubmissionSchema.index({ date: -1 });
eodSubmissionSchema.index({ assignmentId: 1, date: -1 });
eodSubmissionSchema.index({ assignmentId: 1, date: 1 }, { unique: true });

eodSubmissionSchema.methods.toSafeObject = function (): IEodSubmission {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['assignmentId'] = String(raw['assignmentId']);
  raw['candidateId'] = String(raw['candidateId']);
  raw['clientId'] = String(raw['clientId']);
  if (raw['date'] instanceof Date) {
    raw['date'] = (raw['date'] as Date).toISOString().slice(0, 10);
  }
  return raw as unknown as IEodSubmission;
};

export default model<IEodSubmissionDocument>(
  'EodSubmission',
  eodSubmissionSchema
);
