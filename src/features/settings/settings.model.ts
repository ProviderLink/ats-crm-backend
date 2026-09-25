import { Document, Model, Schema, model } from 'mongoose';
import {
  DEFAULT_FROM_EMAIL,
  DEFAULT_FROM_NAME,
} from '../../shared/utils/emailSenderDefaults';
import { DEFAULT_TIMEZONE, isValidTimeZone } from '../../shared/utils/timezone';
import type { ISettings } from './settings.types';

export interface ISettingsDocument extends Omit<ISettings, '_id'>, Document {
  toSafeObject(): ISettings;
}

interface ISettingsModel extends Model<ISettingsDocument> {
  getSettings(): Promise<ISettingsDocument>;
}

const emailSchema = new Schema(
  {
    fromEmail: { type: String, default: DEFAULT_FROM_EMAIL },
    fromName: { type: String, default: DEFAULT_FROM_NAME },
  },
  { _id: false }
);

const aiSchema = new Schema(
  {
    provider: { type: String, enum: ['claude', 'openai'], default: 'claude' },
    resumeValidation: { type: Boolean, default: true },
    candidateScoring: { type: Boolean, default: true },
    resumeParsing: { type: Boolean, default: true },
  },
  { _id: false }
);

const applicationConfirmationSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    templateId: {
      type: Schema.Types.ObjectId,
      ref: 'EmailTemplate',
      default: null,
    },
  },
  { _id: false }
);

const settingsSchema = new Schema<ISettingsDocument, ISettingsModel>(
  {
    email: { type: emailSchema, default: () => ({}) },
    ai: { type: aiSchema, default: () => ({}) },
    applicationConfirmation: {
      type: applicationConfirmationSchema,
      default: () => ({}),
    },
    companyTimezone: {
      type: String,
      default: DEFAULT_TIMEZONE,
      validate: {
        validator: (v: string) => isValidTimeZone(v),
        message: (props: { value: string }) =>
          `"${props.value}" is not a valid IANA timezone`,
      },
    },
  },
  { timestamps: true }
);

settingsSchema.methods.toSafeObject = function (): ISettings {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  return raw as unknown as ISettings;
};

settingsSchema.statics.getSettings =
  async function (): Promise<ISettingsDocument> {
    const settings = await this.findOneAndUpdate(
      {},
      { $setOnInsert: {} },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return settings!;
  };

export default model<ISettingsDocument, ISettingsModel>(
  'Settings',
  settingsSchema
);
