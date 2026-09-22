import logger from '../../shared/utils/logger';
import ActivityLog from './activityLog.model';
import type { CreateActivityLogInput, IActivityLog } from './activityLog.types';

export const createLog = async (
  input: CreateActivityLogInput
): Promise<void> => {
  try {
    await ActivityLog.create({
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      description: input.description ?? null,
      metadata: input.metadata ?? {},
      performedBy: input.performedBy ?? null,
    });
  } catch (error) {
    logger.error('Activity log creation failed', {
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      error,
    });
  }
};

export const getAllLogs = async (filters: {
  resourceType?: string;
  resourceId?: string;
  action?: string;
  performedBy?: string;
  page?: number;
  limit?: number;
}): Promise<{
  logs: IActivityLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const {
    resourceType,
    resourceId,
    action,
    performedBy,
    page = 1,
    limit = 50,
  } = filters;
  const query: Record<string, unknown> = {};

  if (resourceType !== undefined) query['resourceType'] = resourceType;
  if (resourceId !== undefined) query['resourceId'] = resourceId;
  if (action !== undefined) query['action'] = action;
  if (performedBy !== undefined) query['performedBy'] = performedBy;

  const skip = (page - 1) * limit;
  const [logs, total] = await Promise.all([
    ActivityLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ActivityLog.countDocuments(query),
  ]);

  return {
    logs: logs.map(l => l.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getResourceLogs = async (
  resourceType: string,
  resourceId: string,
  page = 1,
  limit = 50,
  /**
   * Also return entries that POINT AT this entity rather than belonging to it.
   *
   * A rejection is stored against the application with `relatedType: candidate`
   * / `relatedId: <candidateId>`, so a candidate-scoped query alone would miss
   * it and the candidate history panel would never show rejections or hires.
   */
  includeRelated = false
): Promise<{
  logs: IActivityLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const query = includeRelated
    ? {
        $or: [
          { resourceType, resourceId },
          { relatedType: resourceType, relatedId: resourceId },
        ],
      }
    : { resourceType, resourceId };
  const skip = (page - 1) * limit;
  const [logs, total] = await Promise.all([
    ActivityLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ActivityLog.countDocuments(query),
  ]);

  return {
    logs: logs.map(l => l.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};
