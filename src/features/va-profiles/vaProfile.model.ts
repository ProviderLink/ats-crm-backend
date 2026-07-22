import mongoose, { Document, Schema, model } from 'mongoose';
import type { IVaProfile } from './vaProfile.types';

export interface IVaProfileDocument
  extends Omit<IVaProfile, '_id' | 'vaId'>, Document {
  vaId: mongoose.Types.ObjectId;
  toSafeObject(): IVaProfile;
}

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
  },
  { timestamps: true }
);

vaProfileSchema.methods.toSafeObject = function (): IVaProfile {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['vaId'] = String(raw['vaId']);
  return raw as unknown as IVaProfile;
};

export default model<IVaProfileDocument>('VaProfile', vaProfileSchema);
