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
    type: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: { type: Schema.Types.ObjectId, required: true },
    relatedType: { type: String, default: null },
    relatedId: { type: Schema.Types.ObjectId, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

activityLogSchema.index({ resourceType: 1, resourceId: 1 });
activityLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
activityLogSchema.index({ performedBy: 1 });
activityLogSchema.index({ type: 1 });
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
