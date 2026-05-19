import mongoose, { Document, model, Schema } from 'mongoose';
import type { IEmail } from './email.types';

export interface IEmailDocument
  extends Omit<IEmail, '_id' | 'templateId' | 'sentBy' | 'context'>, Document {
  context: {
    type: string;
    candidateId: mongoose.Types.ObjectId | null;
    applicationId: mongoose.Types.ObjectId | null;
    jobId: mongoose.Types.ObjectId | null;
    interviewId: mongoose.Types.ObjectId | null;
  };
  templateId: mongoose.Types.ObjectId | null;
  sentBy: mongoose.Types.ObjectId | null;
  toSafeObject(): IEmail;
}

const attachmentSchema = new Schema(
  {
    filename: { type: String },
    url: { type: String },
    contentType: { type: String },
    size: { type: Number },
  },
  { _id: false }
);

const contextSchema = new Schema(
  {
    type: { type: String, default: 'general' },
    candidateId: {
      type: Schema.Types.ObjectId,
      ref: 'Candidate',
      default: null,
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      default: null,
    },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    interviewId: {
      type: Schema.Types.ObjectId,
      ref: 'Interview',
      default: null,
    },
  },
  { _id: false }
);

const emailSchema = new Schema(
  {
    direction: {
      type: String,
      enum: ['outbound', 'inbound'],
      required: true,
    },
    from: { type: String, required: true },
    to: { type: [String], required: true },
    cc: { type: [String], default: [] },
    bcc: { type: [String], default: [] },
    subject: { type: String, required: true },
    bodyHtml: { type: String, default: '' },
    bodyText: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'failed', 'received'],
      default: 'pending',
    },
    threadId: { type: String, default: null },
    inReplyTo: { type: String, default: null },
    templateId: {
      type: Schema.Types.ObjectId,
      ref: 'EmailTemplate',
      default: null,
    },
    context: { type: contextSchema, default: () => ({}) },
    resendId: { type: String, default: null },
    deliveredAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    attachments: { type: [attachmentSchema], default: [] },
    sentBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    sentAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

emailSchema.index({ 'context.candidateId': 1 });
emailSchema.index({ 'context.applicationId': 1 });
emailSchema.index({ 'context.jobId': 1 });
emailSchema.index({ threadId: 1 });
emailSchema.index({ status: 1 });
emailSchema.index({ createdAt: -1 });

emailSchema.methods.toSafeObject = function (): IEmail {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['templateId'] = raw['templateId'] ? String(raw['templateId']) : null;
  raw['sentBy'] = raw['sentBy'] ? String(raw['sentBy']) : null;
  const context = raw['context'] as Record<string, unknown> | undefined;
  if (context) {
    context['candidateId'] = context['candidateId']
      ? String(context['candidateId'])
      : null;
    context['applicationId'] = context['applicationId']
      ? String(context['applicationId'])
      : null;
    context['jobId'] = context['jobId'] ? String(context['jobId']) : null;
    context['interviewId'] = context['interviewId']
      ? String(context['interviewId'])
      : null;
  }
  return raw as unknown as IEmail;
};

export default model<IEmailDocument>('Email', emailSchema);
