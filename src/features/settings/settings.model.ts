import { Document, Model, Schema, model } from 'mongoose';
import type { ISettings } from './settings.types';

export interface ISettingsDocument extends Omit<ISettings, '_id'>, Document {
  toSafeObject(): ISettings;
}

interface ISettingsModel extends Model<ISettingsDocument> {
  getSettings(): Promise<ISettingsDocument>;
}

const emailSchema = new Schema(
  {
    fromEmail: { type: String, default: 'hello@aristagroups.com' },
    fromName: { type: String, default: 'Arista' },
  },
  { _id: false }
);

const aiSchema = new Schema(
  {
    resumeValidation: { type: Boolean, default: true },
    candidateScoring: { type: Boolean, default: true },
  },
  { _id: false }
);

const settingsSchema = new Schema<ISettingsDocument, ISettingsModel>(
  {
    email: { type: emailSchema, default: () => ({}) },
    ai: { type: aiSchema, default: () => ({}) },
    companyTimezone: { type: String, default: 'America/New_York' },
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
