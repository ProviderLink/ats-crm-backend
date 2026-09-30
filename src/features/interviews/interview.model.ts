import mongoose, { Document, model, Schema } from 'mongoose';
import type { IInterview } from './interview.types';
import { INTERVIEW_MEETING_TYPES } from './interview.types';

export interface IInterviewDocument
  extends
    Omit<
      IInterview,
      | '_id'
      | 'applicationId'
      | 'candidateId'
      | 'jobId'
      | 'clientId'
      | 'organizerId'
      | 'interviewerIds'
      | 'feedbacks'
    >,
    Document {
  applicationId: mongoose.Types.ObjectId;
  candidateId: mongoose.Types.ObjectId;
  jobId: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  organizerId: mongoose.Types.ObjectId;
  interviewerIds: mongoose.Types.ObjectId[];
  feedbacks: Array<{
    _id: mongoose.Types.ObjectId;
    interviewerId: mongoose.Types.ObjectId;
    rating: number;
    notes: string;
    recommendation: string;
    submittedAt: Date;
  }>;
  toSafeObject(): IInterview;
}

const meetingDetailsSchema = new Schema(
  {
    link: { type: String, default: null },
    meetingId: { type: String, default: null },
    password: { type: String, default: null },
    phoneNumber: { type: String, default: null },
    address: { type: String, default: null },
  },
  { _id: false }
);

const feedbackSchema = new Schema({
  interviewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  notes: { type: String, default: '' },
  recommendation: {
    type: String,
    enum: ['strong_yes', 'yes', 'neutral', 'no', 'strong_no'],
    required: true,
  },
  submittedAt: { type: Date, default: Date.now },
});

const interviewSchema = new Schema(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
    },
    candidateId: {
      type: Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true,
    },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    title: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['zoom', 'google_meet', 'phone_call', 'in_person'],
      required: true,
    },
    /**
     * Legacy field — interviews are no longer staged, so nothing writes or
     * reads this. The path is kept (with a default) so historic documents still
     * validate; removing it would require migrating existing rows first.
     */
    interviewType: {
      type: String,
      enum: INTERVIEW_MEETING_TYPES,
      default: 'initial_screening',
    },
    /**
     * Legacy field. Interviews are no longer numbered, but historic documents
     * still carry a value, so the path is kept (optional, not `required`) to
     * avoid a schema churn that would need a data migration. Nothing reads it.
     */
    round: { type: Number, min: 1, default: 1 },
    status: {
      type: String,
      enum: ['scheduled', 'completed', 'cancelled', 'no_show'],
      default: 'scheduled',
    },
    scheduledAt: { type: Date, required: true },
    /**
     * Server-owned. A fixed default is applied on create and the value is part
     * of the record (emails render it), but the client can no longer set it.
     */
    duration: { type: Number, required: true },
    /**
     * Always the company timezone from Settings — written server-side on
     * create. Stored rather than derived so the wall clock an interview was
     * booked under stays readable even if the setting later changes.
     */
    timezone: { type: String, required: true },
    meetingDetails: { type: meetingDetailsSchema, default: null },
    interviewerIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    feedbacks: { type: [feedbackSchema], default: [] },
    organizerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reminderSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

interviewSchema.index({ candidateId: 1 });
interviewSchema.index({ applicationId: 1 });
interviewSchema.index({ jobId: 1 });
interviewSchema.index({ status: 1 });
interviewSchema.index({ interviewerIds: 1 });
interviewSchema.index({ scheduledAt: -1 });

interviewSchema.methods.toSafeObject = function (): IInterview {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['applicationId'] = String(raw['applicationId']);
  raw['candidateId'] = String(raw['candidateId']);
  raw['jobId'] = String(raw['jobId']);
  raw['clientId'] = String(raw['clientId']);
  raw['organizerId'] = String(raw['organizerId']);
  raw['interviewerIds'] = Array.isArray(raw['interviewerIds'])
    ? (raw['interviewerIds'] as mongoose.Types.ObjectId[]).map(String)
    : [];
  raw['feedbacks'] = Array.isArray(raw['feedbacks'])
    ? (raw['feedbacks'] as Array<Record<string, unknown>>).map(f => ({
        ...f,
        _id: String(f['_id']),
        interviewerId: String(f['interviewerId']),
      }))
    : [];
  return raw as unknown as IInterview;
};

export default model<IInterviewDocument>('Interview', interviewSchema);
