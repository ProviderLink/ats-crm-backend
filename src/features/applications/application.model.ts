import mongoose, { Document, model, Schema } from 'mongoose';
import type { IApplication } from './application.types';

export interface IApplicationDocument
  extends
    Omit<
      IApplication,
      | '_id'
      | 'candidateId'
      | 'jobId'
      | 'clientId'
      | 'approvedBy'
      | 'rejectedBy'
      | 'hiredBy'
      | 'closedBy'
      | 'createdBy'
      | 'updatedBy'
      | 'interviewIds'
      | 'currentStage'
      | 'lastStage'
      | 'dispositionReasonId'
    >,
    Document {
  candidateId: mongoose.Types.ObjectId;
  jobId: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  approvedBy: mongoose.Types.ObjectId | null;
  rejectedBy: mongoose.Types.ObjectId | null;
  hiredBy: mongoose.Types.ObjectId | null;
  closedBy: mongoose.Types.ObjectId | null;
  createdBy: mongoose.Types.ObjectId | null;
  updatedBy: mongoose.Types.ObjectId | null;
  interviewIds: mongoose.Types.ObjectId[];
  dispositionReasonId: mongoose.Types.ObjectId | null;
  currentStage: {
    stageId: mongoose.Types.ObjectId;
    stageName: string;
    assignedAt: Date;
    assignedBy: mongoose.Types.ObjectId;
  } | null;
  lastStage: {
    stageId: mongoose.Types.ObjectId;
    stageName: string;
    assignedAt: Date;
    assignedBy: mongoose.Types.ObjectId;
  } | null;
  toSafeObject(): IApplication;
}

const currentStageSchema = new Schema(
  {
    stageId: { type: Schema.Types.ObjectId },
    stageName: { type: String },
    assignedAt: { type: Date },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const aiValidationSchema = new Schema(
  {
    isValid: { type: Boolean },
    score: { type: Number, min: 0, max: 100 },
    reason: { type: String },
    completedAt: { type: Date },
  },
  { _id: false }
);

const aiScoreSchema = new Schema(
  {
    score: { type: Number, min: 0, max: 100 },
    recommendation: {
      type: String,
      enum: ['poor_fit', 'moderate_fit', 'good_fit', 'strong_fit'],
    },
    summary: { type: String },
    strengths: { type: [String] },
    concerns: { type: [String] },
  },
  { _id: false }
);

const applicationSchema = new Schema(
  {
    candidateId: {
      type: Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true,
    },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },

    phase: {
      type: String,
      enum: ['pending', 'approved', 'hired', 'rejected'],
      default: 'pending',
    },

    currentStage: { type: currentStageSchema, default: null },

    source: {
      type: String,
      enum: ['direct_apply', 'internal_upload', 'assigned'],
      required: true,
    },

    aiValidation: { type: aiValidationSchema, default: null },
    aiScore: { type: aiScoreSchema, default: null },

    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, default: null },

    // ── Disposition fields (new unified dispose workflow) ──
    lastStage: { type: currentStageSchema, default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    dispositionDate: { type: Date, default: null },
    dispositionReasonId: {
      type: Schema.Types.ObjectId,
      ref: 'DispositionReason',
      default: null,
    },
    dispositionDestination: {
      type: String,
      enum: ['candidate_pool', 'permanently_ineligible'],
      default: null,
    },
    internalNotes: { type: String, default: null },
    isBlocked: { type: Boolean, default: false },

    interviewIds: [{ type: Schema.Types.ObjectId, ref: 'Interview' }],
    notes: { type: String, default: null },

    hiredAt: { type: Date, default: null },
    hiredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    appliedAt: { type: Date, default: Date.now },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

applicationSchema.index({ candidateId: 1, jobId: 1 }, { unique: true });
applicationSchema.index({ jobId: 1 });
applicationSchema.index({ clientId: 1 });
applicationSchema.index({ phase: 1 });
applicationSchema.index({ jobId: 1, phase: 1 });
applicationSchema.index({ candidateId: 1, phase: 1 });
applicationSchema.index({ createdAt: -1 });
applicationSchema.index({ isBlocked: 1 });
applicationSchema.index({ dispositionReasonId: 1 });
applicationSchema.index({ closedAt: -1 });

applicationSchema.methods.toSafeObject = function (): IApplication {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['candidateId'] = String(raw['candidateId']);
  raw['jobId'] = String(raw['jobId']);
  raw['clientId'] = String(raw['clientId']);
  raw['approvedBy'] = raw['approvedBy'] ? String(raw['approvedBy']) : null;
  raw['rejectedBy'] = raw['rejectedBy'] ? String(raw['rejectedBy']) : null;
  raw['hiredBy'] = raw['hiredBy'] ? String(raw['hiredBy']) : null;
  raw['closedBy'] = raw['closedBy'] ? String(raw['closedBy']) : null;
  raw['createdBy'] = raw['createdBy'] ? String(raw['createdBy']) : null;
  raw['updatedBy'] = raw['updatedBy'] ? String(raw['updatedBy']) : null;
  raw['dispositionReasonId'] = raw['dispositionReasonId']
    ? String(raw['dispositionReasonId'])
    : null;
  raw['interviewIds'] = Array.isArray(raw['interviewIds'])
    ? (raw['interviewIds'] as mongoose.Types.ObjectId[]).map(String)
    : [];
  if (raw['currentStage']) {
    const stage = raw['currentStage'] as Record<string, unknown>;
    stage['stageId'] = String(stage['stageId']);
    stage['assignedBy'] = stage['assignedBy']
      ? String(stage['assignedBy'])
      : null;
  }
  if (raw['lastStage']) {
    const stage = raw['lastStage'] as Record<string, unknown>;
    stage['stageId'] = String(stage['stageId']);
    stage['assignedBy'] = stage['assignedBy']
      ? String(stage['assignedBy'])
      : null;
  }
  return raw as unknown as IApplication;
};

export default model<IApplicationDocument>('Application', applicationSchema);
