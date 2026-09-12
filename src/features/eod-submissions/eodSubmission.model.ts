import mongoose, { Document, Schema, model } from 'mongoose';
import type { IEodSubmission, IEodWorkEntry } from './eodSubmission.types';

export interface IEodSubmissionDocument
  extends
    Omit<
      IEodSubmission,
      '_id' | 'assignmentId' | 'candidateId' | 'clientId' | 'date'
    >,
    Document {
  assignmentId: mongoose.Types.ObjectId;
  candidateId: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  date: Date;
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
    /**
     * Company-day start instant (UTC) — the moment `00:00` on `dateKey` in
     * `dateTimezone` occurred. Stored alongside `dateKey` so range queries can
     * use real instants while day-equality uses an exact, indexable string.
     */
    date: { type: Date, required: true },
    /**
     * The company business day as `YYYY-MM-DD`. This is the field reports,
     * the compliance job, dashboards and scorecards compare against, because a
     * date-only string is unambiguous in a way a timestamp is not: VAs submit
     * from every timezone, so "today" must always mean the company's today.
     */
    dateKey: { type: String, required: true },
    /** IANA timezone that defined `dateKey` — kept for audit/traceability. */
    dateTimezone: { type: String, default: null },
    // Shift times are company-local wall clock ("HH:MM"), matching the
    // company schedule the VA is working.
    shiftStart: { type: String, required: true },
    shiftEnd: { type: String, required: true },
    /**
     * Hours between shiftStart and shiftEnd. Computed server-side from the
     * company clock so it cannot be skewed by a VA's device timezone.
     */
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
eodSubmissionSchema.index({ dateKey: -1 });
eodSubmissionSchema.index({ assignmentId: 1, date: -1 });
eodSubmissionSchema.index({ assignmentId: 1, dateKey: -1 });
// One EOD per assignment per company business day.
eodSubmissionSchema.index({ assignmentId: 1, dateKey: 1 }, { unique: true });

eodSubmissionSchema.methods.toSafeObject = function (): IEodSubmission {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['assignmentId'] = String(raw['assignmentId']);
  raw['candidateId'] = String(raw['candidateId']);
  raw['clientId'] = String(raw['clientId']);

  // `date` is exposed to clients as the `YYYY-MM-DD` company business day. The
  // field name is unchanged so every existing consumer keeps working; only the
  // meaning is now explicit and timezone-derived. Falls back to slicing the
  // instant for any legacy row written before `dateKey` existed.
  if (typeof raw['dateKey'] === 'string' && raw['dateKey']) {
    raw['date'] = raw['dateKey'];
  } else if (raw['date'] instanceof Date) {
    raw['date'] = (raw['date'] as Date).toISOString().slice(0, 10);
  }

  return raw as unknown as IEodSubmission;
};

export default model<IEodSubmissionDocument>(
  'EodSubmission',
  eodSubmissionSchema
);
