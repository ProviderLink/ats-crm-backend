import mongoose from 'mongoose';
import { AppError } from '../../shared/utils/AppError';
import { createLog } from '../activity-logs/activityLog.service';
import DispositionReason from './dispositionReason.model';
import type {
  CreateDispositionReasonInput,
  IDispositionReason,
  UpdateDispositionReasonInput,
} from './dispositionReason.types';

export const listReasons = async (filters?: {
  isActive?: boolean;
  category?: string;
}): Promise<IDispositionReason[]> => {
  const query: Record<string, unknown> = {};
  if (filters?.isActive !== undefined) query['isActive'] = filters.isActive;
  if (filters?.category) query['category'] = filters.category;
  const reasons = await DispositionReason.find(query).sort({
    category: 1,
    order: 1,
  });
  return reasons.map(r => r.toSafeObject());
};

export const getActiveReasons = async (
  stageName?: string
): Promise<IDispositionReason[]> => {
  const reasons = await DispositionReason.find({ isActive: true }).sort({
    category: 1,
    order: 1,
  });
  const all = reasons.map(r => r.toSafeObject());

  if (!stageName) return all;

  // Filter: reason applies if applicableStages is empty (universal)
  // or contains the stageName
  return all.filter(
    r =>
      r.applicableStages.length === 0 || r.applicableStages.includes(stageName)
  );
};

export const getReasonById = async (
  id: string
): Promise<IDispositionReason> => {
  const reason = await DispositionReason.findById(id);
  if (!reason)
    throw new AppError(
      404,
      'DISPOSITION_REASON_NOT_FOUND',
      'Disposition reason not found'
    );
  return reason.toSafeObject();
};

export const createReason = async (
  input: CreateDispositionReasonInput
): Promise<IDispositionReason> => {
  // Auto-set defaultEligibility for permanently_ineligible_reasons category
  const defaultEligibility =
    input.category === 'permanently_ineligible_reasons'
      ? 'permanently_ineligible'
      : (input.defaultEligibility ?? 'eligible');

  const reason = await DispositionReason.create({
    ...input,
    defaultEligibility,
    createdBy: input.createdBy
      ? new mongoose.Types.ObjectId(input.createdBy)
      : null,
  });

  createLog({
    action: 'created',
    resourceType: 'settings',
    resourceId: reason._id.toString(),
    metadata: { label: input.label, category: input.category },
    performedBy: input.createdBy ?? null,
  });

  return reason.toSafeObject();
};

export const updateReason = async (
  id: string,
  input: UpdateDispositionReasonInput
): Promise<IDispositionReason> => {
  const reason = await DispositionReason.findById(id);
  if (!reason)
    throw new AppError(
      404,
      'DISPOSITION_REASON_NOT_FOUND',
      'Disposition reason not found'
    );

  if (input.label !== undefined) reason.label = input.label;
  if (input.category !== undefined) {
    reason.category = input.category;
    // Auto-set defaultEligibility on category change
    if (input.category === 'permanently_ineligible_reasons') {
      reason.defaultEligibility = 'permanently_ineligible';
    }
  }
  if (input.isActive !== undefined) reason.isActive = input.isActive;
  if (input.order !== undefined) reason.order = input.order;
  if (input.applicableStages !== undefined)
    reason.applicableStages = input.applicableStages;
  if (input.defaultEligibility !== undefined)
    reason.defaultEligibility = input.defaultEligibility;
  if (input.requireInternalNotes !== undefined)
    reason.requireInternalNotes = input.requireInternalNotes;
  if (input.updatedBy !== undefined)
    reason.updatedBy = input.updatedBy
      ? new mongoose.Types.ObjectId(input.updatedBy)
      : null;

  await reason.save();

  createLog({
    action: 'updated',
    resourceType: 'settings',
    resourceId: id,
    metadata: { label: reason.label },
    performedBy: input.updatedBy ?? null,
  });

  return reason.toSafeObject();
};

export const deactivateReason = async (
  id: string,
  performedBy?: string | null
): Promise<IDispositionReason> => {
  const reason = await DispositionReason.findById(id);
  if (!reason)
    throw new AppError(
      404,
      'DISPOSITION_REASON_NOT_FOUND',
      'Disposition reason not found'
    );

  reason.isActive = false;
  reason.updatedBy = performedBy
    ? new mongoose.Types.ObjectId(performedBy)
    : null;
  await reason.save();

  createLog({
    action: 'updated',
    resourceType: 'settings',
    resourceId: id,
    metadata: { deactivated: true, label: reason.label },
    performedBy: performedBy ?? null,
  });

  return reason.toSafeObject();
};

export const reorderReason = async (
  id: string,
  newOrder: number,
  performedBy?: string | null
): Promise<IDispositionReason> => {
  const reason = await DispositionReason.findById(id);
  if (!reason)
    throw new AppError(
      404,
      'DISPOSITION_REASON_NOT_FOUND',
      'Disposition reason not found'
    );

  reason.order = newOrder;
  reason.updatedBy = performedBy
    ? new mongoose.Types.ObjectId(performedBy)
    : null;
  await reason.save();

  return reason.toSafeObject();
};
