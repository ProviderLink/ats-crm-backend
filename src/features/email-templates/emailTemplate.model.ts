import mongoose, { Document, model, Schema } from 'mongoose';
import type { IEmailTemplate } from './emailTemplate.types';
import { SYSTEM_VARIABLES } from './emailTemplate.types';

export interface IEmailTemplateDocument
  extends Omit<IEmailTemplate, '_id' | 'createdBy' | 'updatedBy'>, Document {
  createdBy: mongoose.Types.ObjectId | null;
  updatedBy: mongoose.Types.ObjectId | null;
  toSafeObject(): IEmailTemplate;
}

const emailTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    subject: { type: String, required: true },
    bodyHtml: { type: String, required: true },
    bodyText: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: [
        'interview',
        'offer',
        'rejection',
        'follow_up',
        'eod_reminder',
        'survey_reminder',
        'general',
      ],
    },
    variables: {
      type: [String],
      enum: SYSTEM_VARIABLES,
      default: [],
    },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

emailTemplateSchema.index({ type: 1 });
emailTemplateSchema.index({ isActive: 1 });

emailTemplateSchema.methods.toSafeObject = function (): IEmailTemplate {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['createdBy'] = raw['createdBy'] ? String(raw['createdBy']) : null;
  raw['updatedBy'] = raw['updatedBy'] ? String(raw['updatedBy']) : null;
  return raw as unknown as IEmailTemplate;
};

export default model<IEmailTemplateDocument>(
  'EmailTemplate',
  emailTemplateSchema
);
