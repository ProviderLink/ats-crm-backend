import mongoose, { Document, model, Schema } from 'mongoose';
import type { IClient } from './client.types';

export interface IClientDocument
  extends Omit<IClient, '_id' | 'tags' | 'createdBy' | 'updatedBy'>, Document {
  tags: mongoose.Types.ObjectId[];
  createdBy: mongoose.Types.ObjectId | null;
  updatedBy: mongoose.Types.ObjectId | null;
  toSafeObject(): IClient;
}

const addressSchema = new Schema(
  {
    street: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: '' },
    postalCode: { type: String, default: '' },
  },
  { _id: false }
);

const contactSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, default: '' },
  position: { type: String, default: '' },
  isPrimary: { type: Boolean, default: false },
});

const crmProfileSchema = new Schema(
  {
    healthStatus: {
      type: String,
      enum: ['green', 'yellow', 'red'],
      default: 'green',
    },
    baaSign: { type: Boolean, default: false },
    baaSignedDate: { type: Date, default: null },
    emrSystem: { type: String, default: '' },
    onboardingComplete: { type: Boolean, default: false },
    sopReceived: { type: Boolean, default: false },
    satisfactionScore: { type: Number, min: 1, max: 5, default: null },
    openIssuesCount: { type: Number, default: 0 },
    lastClientCheckin: { type: Date, default: null },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const clientSchema = new Schema(
  {
    companyName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: '' },
    website: { type: String, default: '' },
    logo: { type: String, default: '' },
    industry: { type: String, default: '' },
    companySize: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-500', '500+'],
      default: '1-10',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended'],
      default: 'active',
    },
    description: { type: String, default: '' },
    address: { type: addressSchema, default: () => ({}) },
    contacts: { type: [contactSchema], default: [] },
    tags: [{ type: Schema.Types.ObjectId, ref: 'Tag' }],
    crmProfile: { type: crmProfileSchema, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

clientSchema.index({ companyName: 'text' });
clientSchema.index({ status: 1 });

clientSchema.methods.toSafeObject = function (): IClient {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['createdBy'] = raw['createdBy'] ? String(raw['createdBy']) : null;
  raw['updatedBy'] = raw['updatedBy'] ? String(raw['updatedBy']) : null;
  const tags = raw['tags'] as unknown[];
  raw['tags'] = Array.isArray(tags) ? tags.map(t => String(t)) : [];
  const contacts = raw['contacts'] as Array<Record<string, unknown>>;
  if (Array.isArray(contacts)) {
    raw['contacts'] = contacts.map(c => ({ ...c, _id: String(c['_id']) }));
  }
  return raw as unknown as IClient;
};

export default model<IClientDocument>('Client', clientSchema);
