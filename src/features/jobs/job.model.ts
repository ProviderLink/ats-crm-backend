import mongoose, { Document, Schema } from 'mongoose';
import { IJob } from './job.types';

export interface IJobDocument
  extends
    Omit<
      IJob,
      '_id' | 'clientId' | 'tags' | 'createdBy' | 'updatedBy' | 'pipeline'
    >,
    Document {
  clientId: mongoose.Types.ObjectId;
  tags: mongoose.Types.ObjectId[];
  createdBy: mongoose.Types.ObjectId | null;
  updatedBy: mongoose.Types.ObjectId | null;
  pipeline: {
    templateId: mongoose.Types.ObjectId | null;
    stages: Array<{
      _id: mongoose.Types.ObjectId;
      name: string;
      color: string;
      order: number;
      isActive: boolean;
      icon: string;
    }>;
  } | null;
  toSafeObject(): IJob;
}

const salaryRangeSchema = new Schema(
  {
    min: { type: Number },
    max: { type: Number },
    currency: { type: String, default: 'USD' },
    period: {
      type: String,
      enum: ['hourly', 'daily', 'weekly', 'bi_weekly', 'monthly', 'yearly'],
    },
  },
  { _id: false }
);

const stageSchema = new Schema({
  name: { type: String, required: true },
  color: { type: String, default: '#3b82f6' },
  order: { type: Number, required: true },
  isActive: { type: Boolean, default: true },
  icon: { type: String, default: 'ClipboardList' },
});

const pipelineSchema = new Schema(
  {
    templateId: {
      type: Schema.Types.ObjectId,
      ref: 'PipelineTemplate',
      default: null,
    },
    stages: { type: [stageSchema], default: [] },
  },
  { _id: false }
);

const jobSchema = new Schema<IJobDocument>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    status: {
      type: String,
      enum: ['draft', 'open', 'on_hold', 'closed'],
      default: 'draft',
    },
    jobType: {
      type: String,
      enum: ['full_time', 'part_time', 'contract', 'temporary'],
      required: true,
    },
    locationType: {
      type: String,
      enum: ['remote', 'hybrid', 'onsite'],
      required: true,
    },
    location: { type: String, default: '' },
    experienceLevel: {
      type: String,
      enum: ['entry', 'mid', 'senior', 'lead'],
      required: true,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    openings: { type: Number, default: 1, min: 1 },
    requirements: { type: [String], default: [] },
    responsibilities: { type: [String], default: [] },
    skills: { type: [String], default: [] },
    tags: { type: [Schema.Types.ObjectId], ref: 'Tag', default: [] },
    benefits: { type: [String], default: [] },
    salaryRange: { type: salaryRangeSchema, default: null },
    pipeline: { type: pipelineSchema, default: null },
    applicationDeadline: { type: Date, default: null },
    startDate: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

jobSchema.index({ clientId: 1 });
jobSchema.index({ status: 1 });
jobSchema.index({ clientId: 1, status: 1 });
jobSchema.index({ title: 'text' });

jobSchema.methods.toSafeObject = function (): IJob {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['clientId'] = String(raw['clientId']);
  raw['createdBy'] = raw['createdBy'] ? String(raw['createdBy']) : null;
  raw['updatedBy'] = raw['updatedBy'] ? String(raw['updatedBy']) : null;
  const tags = raw['tags'] as unknown[];
  raw['tags'] = Array.isArray(tags) ? tags.map(t => String(t)) : [];
  const pipeline = raw['pipeline'] as Record<string, unknown> | null;
  if (pipeline) {
    pipeline['templateId'] = pipeline['templateId']
      ? String(pipeline['templateId'])
      : null;
    const stages = pipeline['stages'] as Array<Record<string, unknown>>;
    if (Array.isArray(stages)) {
      pipeline['stages'] = stages.map(stage => ({
        ...stage,
        _id: String(stage['_id']),
      }));
    }
  }
  return raw as unknown as IJob;
};

export default mongoose.model<IJobDocument>('Job', jobSchema);
