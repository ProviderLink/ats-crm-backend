import mongoose, { Document, model, Schema } from 'mongoose';
import type { IPipelineTemplate } from './pipelineTemplate.types';

export interface IPipelineTemplateDocument
  extends
    Omit<IPipelineTemplate, '_id' | 'createdBy' | 'updatedBy' | 'stages'>,
    Document {
  createdBy: mongoose.Types.ObjectId | null;
  updatedBy: mongoose.Types.ObjectId | null;
  stages: mongoose.Types.DocumentArray<{
    _id: mongoose.Types.ObjectId;
    name: string;
    color: string;
    order: number;
    isActive: boolean;
    icon: string;
  }>;
  toSafeObject(): IPipelineTemplate;
}

const stageSchema = new Schema({
  name: { type: String, required: true, trim: true },
  color: { type: String, default: '#3b82f6' },
  order: { type: Number, required: true },
  isActive: { type: Boolean, default: true },
  icon: { type: String, default: 'ClipboardList' },
});

const pipelineTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    stages: { type: [stageSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

pipelineTemplateSchema.index({ isActive: 1 });
pipelineTemplateSchema.index({ isDefault: 1 });

pipelineTemplateSchema.methods.toSafeObject = function (): IPipelineTemplate {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['createdBy'] = raw['createdBy'] ? String(raw['createdBy']) : null;
  raw['updatedBy'] = raw['updatedBy'] ? String(raw['updatedBy']) : null;
  const stages = raw['stages'] as Record<string, unknown>[];
  raw['stages'] = stages.map(stage => ({
    ...stage,
    _id: String(stage['_id']),
  }));
  return raw as unknown as IPipelineTemplate;
};

export default model<IPipelineTemplateDocument>(
  'PipelineTemplate',
  pipelineTemplateSchema
);
