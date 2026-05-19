import mongoose, { Document, Schema, model } from 'mongoose';
import type { IEodSubmission } from './eodSubmission.types';

export interface IEodSubmissionDocument
  extends
    Omit<IEodSubmission, '_id' | 'assignmentId' | 'candidateId' | 'clientId'>,
    Document {
  assignmentId: mongoose.Types.ObjectId;
  candidateId: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  toSafeObject(): IEodSubmission;
}

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
    summaryOfWork: { type: String, required: true },
    pendingTasks: { type: String, required: true },
    blockers: { type: String, default: null },
    notes: { type: String, default: null },
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
  return raw as unknown as IEodSubmission;
};

export default model<IEodSubmissionDocument>(
  'EodSubmission',
  eodSubmissionSchema
);
