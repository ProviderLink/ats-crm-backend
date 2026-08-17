import mongoose, { Document, Schema, model } from 'mongoose';
import type { IVaProfile } from './vaProfile.types';

export interface IVaProfileDocument
  extends Omit<IVaProfile, '_id' | 'vaId' | 'noteThread'>, Document {
  vaId: mongoose.Types.ObjectId;
  noteThread: any[];
  toSafeObject(): IVaProfile;
}

const vaNoteSchema = new Schema(
  {
    method: {
      type: String,
      enum: ['call', 'email', 'meeting', 'message', 'other'],
      default: 'other',
    },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true, _id: true }
);

const vaProfileSchema = new Schema(
  {
    vaId: {
      type: Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true,
      unique: true,
    },
    workloadLevel: {
      type: String,
      enum: ['low', 'normal', 'high', 'overloaded'],
      default: 'normal',
    },
    satisfactionScore: { type: Number, min: 1, max: 5, default: null },
    burnoutRiskFlag: { type: Boolean, default: false },
    replacementRiskFlag: { type: Boolean, default: false },
    lastVaCheckin: { type: Date, default: null },
    notes: { type: String, default: '' },
    noteThread: { type: [vaNoteSchema], default: [] },
  },
  { timestamps: true }
);

vaProfileSchema.methods.toSafeObject = function (): IVaProfile {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['vaId'] = String(raw['vaId']);
  if (Array.isArray(raw['noteThread'])) {
    raw['noteThread'] = (raw['noteThread'] as any[]).map(n => ({
      ...n,
      _id: String(n._id),
      author: n.author ? String(n.author) : null,
    }));
  }
  return raw as unknown as IVaProfile;
};

export default model<IVaProfileDocument>('VaProfile', vaProfileSchema);
