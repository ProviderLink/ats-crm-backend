import mongoose, { Document, model, Schema } from 'mongoose';
import type { IUser, SafeUser } from './user.types';

export interface IUserDocument
  extends
    Omit<IUser, '_id' | 'clientRef' | 'candidateRef' | 'createdBy'>,
    Document {
  clientRef: mongoose.Types.ObjectId | null;
  candidateRef: mongoose.Types.ObjectId | null;
  createdBy: mongoose.Types.ObjectId | null;
  toSafeObject(): SafeUser;
}

const USER_ROLES = [
  'admin',
  'hiring_manager',
  'recruiter',
  'coordinator',
  'interviewer',
  'account_manager',
  'client',
  'va',
] as const;

const APP_ACCESS_VALUES = ['ats', 'crm'] as const;

const resourcePermSchema = new Schema(
  {
    read: Boolean,
    write: Boolean,
    manage: Boolean,
    schedule: Boolean,
    approve: Boolean,
  },
  { _id: false }
);

const permissionsSchema = new Schema(
  {
    candidates: { type: resourcePermSchema },
    jobs: { type: resourcePermSchema },
    interviews: { type: resourcePermSchema },
    // NEW (Interview Scorecard feature): additive permission resource.
    // Mirrors the existing resource-perm shape; no other change in this file.
    interviewScorecards: { type: resourcePermSchema },
    clients: { type: resourcePermSchema },
    emails: { type: resourcePermSchema },
    tags: { type: resourcePermSchema },
    settings: { type: resourcePermSchema },
    dashboard: { type: resourcePermSchema },
    team: { type: resourcePermSchema },
    pipelineTemplates: { type: resourcePermSchema },
    emailTemplates: { type: resourcePermSchema },
    activityLogs: { type: resourcePermSchema },
    assignments: { type: resourcePermSchema },
    reports: { type: resourcePermSchema },
    eod: { type: resourcePermSchema },
    performanceReview: { type: resourcePermSchema },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, default: '' },
    avatar: { type: String, default: null },
    roles: {
      type: [{ type: String, enum: USER_ROLES }],
      default: [],
    },
    appAccess: {
      type: [{ type: String, enum: APP_ACCESS_VALUES }],
      default: [],
    },
    permissions: { type: permissionsSchema, default: {} },
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    passwordHash: { type: String, required: true },
    refreshTokenAts: { type: String, default: null },
    refreshTokenCrm: { type: String, default: null },
    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
    inviteToken: { type: String, default: null },
    inviteTokenExpires: { type: Date, default: null },
    isInviteAccepted: { type: Boolean, default: false },
    deactivatedAt: { type: Date, default: null },
    lastLoginAts: { type: Date, default: null },
    lastLoginCrm: { type: Date, default: null },
    clientRef: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    candidateRef: {
      type: Schema.Types.ObjectId,
      ref: 'Candidate',
      default: null,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

userSchema.index({ roles: 1 });
userSchema.index({ isActive: 1 });

userSchema.methods.toSafeObject = function (): SafeUser {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  delete raw['passwordHash'];
  delete raw['refreshTokenAts'];
  delete raw['refreshTokenCrm'];
  delete raw['passwordResetToken'];
  delete raw['inviteToken'];
  raw['_id'] = String(raw['_id']);
  raw['clientRef'] = raw['clientRef'] ? String(raw['clientRef']) : null;
  raw['candidateRef'] = raw['candidateRef']
    ? String(raw['candidateRef'])
    : null;
  raw['createdBy'] = raw['createdBy'] ? String(raw['createdBy']) : null;
  return raw as unknown as SafeUser;
};

export default model<IUserDocument>('User', userSchema);
