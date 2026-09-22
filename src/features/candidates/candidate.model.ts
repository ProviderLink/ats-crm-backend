import mongoose, { Document, model, Schema } from 'mongoose';
import type { ICandidate } from './candidate.types';

export interface ICandidateDocument
  extends
    Omit<
      ICandidate,
      | '_id'
      | 'createdBy'
      | 'updatedBy'
      | 'tags'
      | 'appliedJobId'
      | 'permanentlyIneligibleBy'
      | 'permanentlyIneligibleReason'
    >,
    Document {
  tags: mongoose.Types.ObjectId[];
  createdBy: mongoose.Types.ObjectId | null;
  updatedBy: mongoose.Types.ObjectId | null;
  appliedJobId: mongoose.Types.ObjectId | null;
  permanentlyIneligibleBy: mongoose.Types.ObjectId | null;
  permanentlyIneligibleReason: mongoose.Types.ObjectId | null;
  toSafeObject(): ICandidate;
}

const experienceSchema = new Schema(
  {
    company: { type: String },
    title: { type: String },
    duration: { type: String },
    description: { type: String },
  },
  { _id: false }
);

const educationSchema = new Schema(
  {
    institution: { type: String },
    degree: { type: String },
    field: { type: String },
    year: { type: String },
  },
  { _id: false }
);

const parsedDataSchema = new Schema(
  {
    summary: { type: String, default: '' },
    skills: { type: [String], default: [] },
    languages: { type: [String], default: [] },
    certifications: { type: [String], default: [] },
    experience: { type: [experienceSchema], default: [] },
    education: { type: [educationSchema], default: [] },
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

const crmProfileSchema = new Schema(
  {
    workloadLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    satisfactionScore: { type: Number, min: 1, max: 5, default: null },
    burnoutRiskFlag: { type: Boolean, default: false },
    replacementRiskFlag: { type: Boolean, default: false },
    lastVaCheckin: { type: Date, default: null },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const candidateSchema = new Schema(
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

    resumeUrl: { type: String, required: true },
    resumeOriginalName: { type: String, required: true },
    resumeRawText: { type: String, default: '' },

    videoIntroUrl: { type: String, default: null },
    videoIntroSource: {
      type: String,
      enum: ['cloudinary', 'external'],
      default: null,
    },

    // Optional work samples — a link, an uploaded file, or both. Never required.
    portfolioUrl: { type: String, default: null },
    portfolioFileUrl: { type: String, default: null },
    portfolioFileName: { type: String, default: null },

    parsedData: { type: parsedDataSchema, default: null },
    aiValidation: { type: aiValidationSchema, default: null },
    aiScore: { type: aiScoreSchema, default: null },
    appliedJobId: { type: Schema.Types.ObjectId, default: null },

    yearsOfExperience: { type: Number, default: 0 },
    englishProficiency: {
      type: String,
      enum: ['basic', 'conversational', 'professional', 'fluent', 'native'],
      default: null,
    },
    currentSalaryPHP: { type: Number, default: null },
    currentSalaryUSD: { type: Number, default: null },
    reasonForLeaving: { type: String, default: null, maxlength: 500 },
    cityOfResidence: { type: String, default: null, maxlength: 100 },
    source: {
      type: String,
      enum: ['applied', 'internal_upload'],
      required: true,
    },
    tags: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Tag' }],
      default: [],
    },

    inTalentPool: { type: Boolean, default: false },
    talentPoolAddedAt: { type: Date, default: null },
    talentPoolNotes: { type: String, default: null },

    status: {
      type: String,
      enum: ['pending', 'approved', 'hired'],
      default: 'pending',
    },

    eligibilityStatus: {
      type: String,
      enum: ['eligible', 'permanently_ineligible'],
      default: 'eligible',
    },
    permanentlyIneligibleAt: { type: Date, default: null },
    permanentlyIneligibleBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    permanentlyIneligibleReason: {
      type: Schema.Types.ObjectId,
      ref: 'DispositionReason',
      default: null,
    },

    phoneNormalized: { type: String, default: null },
    legalHold: { type: Boolean, default: false },

    crmProfile: { type: crmProfileSchema, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

candidateSchema.index({ status: 1 });
candidateSchema.index({ inTalentPool: 1 });
candidateSchema.index({ eligibilityStatus: 1 });
candidateSchema.index({ phoneNormalized: 1 }, { sparse: true });
candidateSchema.index({ tags: 1 });
candidateSchema.index({ createdAt: -1 });
candidateSchema.index({ firstName: 'text', lastName: 'text', email: 'text' });

candidateSchema.methods.toSafeObject = function (): ICandidate {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['createdBy'] = raw['createdBy'] ? String(raw['createdBy']) : null;
  raw['updatedBy'] = raw['updatedBy'] ? String(raw['updatedBy']) : null;
  raw['tags'] = Array.isArray(raw['tags'])
    ? (raw['tags'] as mongoose.Types.ObjectId[]).map(String)
    : [];
  raw['permanentlyIneligibleBy'] = raw['permanentlyIneligibleBy']
    ? String(raw['permanentlyIneligibleBy'])
    : null;
  raw['permanentlyIneligibleReason'] = raw['permanentlyIneligibleReason']
    ? String(raw['permanentlyIneligibleReason'])
    : null;
  raw['appliedJobId'] = raw['appliedJobId']
    ? String(raw['appliedJobId'])
    : null;
  // Guard against legacy documents with null/missing status
  if (!raw['status']) raw['status'] = 'pending';
  if (!raw['eligibilityStatus']) raw['eligibilityStatus'] = 'eligible';
  if (!raw['legalHold']) raw['legalHold'] = false;
  return raw as unknown as ICandidate;
};

/**
 * Normalize a phone number for dedup matching.
 * Strips non-digits and keeps last 10 digits as the canonical form.
 * Returns null for unparseable inputs.
 */
export function normalizePhone(
  phone: string | null | undefined
): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  // Use last 10 digits as canonical form (handles country codes varying)
  return digits.slice(-10);
}

// Pre-save hook: normalize phone number on save
// Uses isNew || isModified to catch both new documents and phone updates.
candidateSchema.pre('save', function (next) {
  if (this.isNew || this.isModified('phone')) {
    this.phoneNormalized = normalizePhone(this.phone);
  }
  next();
});

export default model<ICandidateDocument>('Candidate', candidateSchema);
