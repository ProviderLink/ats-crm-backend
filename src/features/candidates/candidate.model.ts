import mongoose, { Document, model, Schema } from 'mongoose';
import type { ICandidate } from './candidate.types';

export interface ICandidateDocument
  extends
    Omit<ICandidate, '_id' | 'createdBy' | 'updatedBy' | 'tags'>,
    Document {
  tags: mongoose.Types.ObjectId[];
  createdBy: mongoose.Types.ObjectId | null;
  updatedBy: mongoose.Types.ObjectId | null;
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
    phone: { type: String, required: true },
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

    parsedData: { type: parsedDataSchema, default: null },
    aiScore: { type: aiScoreSchema, default: null },

    yearsOfExperience: { type: Number, default: 0 },
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
      enum: ['pending', 'active', 'idle', 'hired'],
      default: 'pending',
    },

    crmProfile: { type: crmProfileSchema, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

candidateSchema.index({ status: 1 });
candidateSchema.index({ inTalentPool: 1 });
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
  return raw as unknown as ICandidate;
};

export default model<ICandidateDocument>('Candidate', candidateSchema);
