import mongoose, { Document, model, Schema } from 'mongoose';
import type { IActivityLog } from './activityLog.types';

export interface IActivityLogDocument
  extends
    Omit<IActivityLog, '_id' | 'resourceId' | 'relatedId' | 'performedBy'>,
    Document {
  resourceId: mongoose.Types.ObjectId;
  relatedId: mongoose.Types.ObjectId | null;
  performedBy: mongoose.Types.ObjectId | null;
  toSafeObject(): IActivityLog;
}

const activityLogSchema = new Schema(
  {
    action: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: { type: Schema.Types.ObjectId, required: true },
    relatedType: { type: String, default: null },
    relatedId: { type: Schema.Types.ObjectId, default: null },
    description: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// Indexes.
//
// NOTE: `{ resourceType, resourceId }` is deliberately NOT declared here. It
// is a strict left-prefix of the compound below, so it can never win the
// planner's choice for any query this collection serves — and a redundant
// prefix index still costs write throughput and memory. Do not re-add it.
//
// `type_1` (an index on the pre-`fa6af42` field name) was dropped by
// `scripts/cleanup-activity-indexes.ts`; `action` replaced it.
activityLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
activityLogSchema.index({ performedBy: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });
activityLogSchema.index({ createdAt: -1 });

activityLogSchema.methods.toSafeObject = function (): IActivityLog {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['resourceId'] = String(raw['resourceId']);
  raw['relatedId'] = raw['relatedId'] ? String(raw['relatedId']) : null;
  raw['performedBy'] = raw['performedBy'] ? String(raw['performedBy']) : null;
  return raw as unknown as IActivityLog;
};

export default model<IActivityLogDocument>('ActivityLog', activityLogSchema);
