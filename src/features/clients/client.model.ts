import mongoose, { Document, model, Schema } from 'mongoose';
import type { IClient } from './client.types';

export const COMPANY_SIZE_ENUM = [
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '500+',
] as const;

export type CompanySize = (typeof COMPANY_SIZE_ENUM)[number];

const COMPANY_SIZE_SET = new Set<string>(COMPANY_SIZE_ENUM);

// Common typos / alternate forms → canonical enum value.
const COMPANY_SIZE_TYPO_MAP: Record<string, CompanySize> = {
  '1-50': '11-50',
  '11-9': '1-10',
  '1-9': '1-10',
  '01-10': '1-10',
  '51-150': '51-200',
  '201-501': '201-500',
  '201-501+': '500+',
  '501+': '500+',
  '500': '500+',
  '500 -10': '500+',
};

/**
 * Normalize a raw companySize value into one of COMPANY_SIZE_ENUM,
 * or undefined if the value cannot be mapped (so it gets unset).
 * - Trims/lowercases for comparison.
 * - Fixes known typos.
 * - Rejects anything outside the enum.
 */
export function normalizeCompanySize(value: unknown): CompanySize | undefined {
  if (value === null || value === undefined) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;

  // Exact match (case-insensitive)
  const lower = raw.toLowerCase();
  for (const valid of COMPANY_SIZE_ENUM) {
    if (lower === valid.toLowerCase()) return valid;
  }

  // Typo table match (case-insensitive)
  const typoKey = Object.keys(COMPANY_SIZE_TYPO_MAP).find(
    k => k.toLowerCase() === lower
  );
  if (typoKey) return COMPANY_SIZE_TYPO_MAP[typoKey];

  return undefined;
}

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

const noteSchema = new Schema(
  {
    method: {
      type: String,
      enum: ['call', 'email', 'meeting', 'message', 'other'],
      required: true,
    },
    content: { type: String, required: true, trim: true },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

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
    notes: { type: [noteSchema], default: [] },
    tags: [{ type: Schema.Types.ObjectId, ref: 'Tag' }],
    crmProfile: { type: crmProfileSchema, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

clientSchema.index({ companyName: 'text' });
clientSchema.index({ status: 1 });

// --- Self-healing middleware for companySize -----------------------------
// Guarantees that no client (frontend, API caller, import script, raw
// mongoose update) can ever persist a value outside COMPANY_SIZE_ENUM.
// Known typos are silently remapped; anything else is unset.

function normalizeCompanySizeOnDoc(doc: { get(name: string): unknown; set(name: string, value: unknown): void; isModified(path: string): boolean; isNew: boolean }): void {
  if (!doc) return;
  if (doc.isModified('companySize') || doc.isNew) {
    const normalized = normalizeCompanySize(doc.get('companySize'));
    if (normalized) {
      doc.set('companySize', normalized);
    } else {
      // Unset bad value — fall back to default '1-10' via re-setting.
      doc.set('companySize', '1-10');
    }
  }
}

clientSchema.pre('save', function (next) {
  normalizeCompanySizeOnDoc(this);
  next();
});

clientSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() as Record<string, unknown> | undefined | null;
  if (!update) return next();

  // Handle both $set / $setOnInsert shapes and flat update shapes.
  const setObj =
    (update.$set as Record<string, unknown> | undefined) ??
    (update as Record<string, unknown>);
  const setOnInsert = update.$setOnInsert as
    | Record<string, unknown>
    | undefined;

  if (setObj && Object.prototype.hasOwnProperty.call(setObj, 'companySize')) {
    const normalized = normalizeCompanySize(setObj.companySize);
    if (normalized) {
      setObj.companySize = normalized;
    } else {
      // Remove the field and fall back to default via $setOnInsert path.
      delete setObj.companySize;
      if (setOnInsert && !setOnInsert.companySize) {
        setOnInsert.companySize = '1-10';
      } else if (!update.$setOnInsert) {
        update.$setOnInsert = { companySize: '1-10' };
      }
    }
    if (!update.$set && setObj !== update) {
      update.$set = setObj;
    }
  }

  if (setOnInsert) {
    update.$setOnInsert = setOnInsert;
  }

  next();
});

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
  const notes = raw['notes'] as Array<Record<string, unknown>>;
  if (Array.isArray(notes)) {
    raw['notes'] = notes.map(n => ({
      ...n,
      _id: String(n['_id']),
      author: n['author'] ? String(n['author']) : null,
    }));
  }
  return raw as unknown as IClient;
};

export default model<IClientDocument>('Client', clientSchema);
