import mongoose, { Document, model, Schema } from 'mongoose';
import type { ITag } from './tag.types';

export interface ITagDocument
  extends Omit<ITag, '_id' | 'createdBy'>, Document {
  createdBy: mongoose.Types.ObjectId | null;
  toSafeObject(): ITag;
}

const tagSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    color: { type: String, required: true, default: '#3b82f6' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

tagSchema.methods.toSafeObject = function (): ITag {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['createdBy'] = raw['createdBy'] ? String(raw['createdBy']) : null;
  return raw as unknown as ITag;
};

export default model<ITagDocument>('Tag', tagSchema);
