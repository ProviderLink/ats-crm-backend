import logger from '../../shared/utils/logger';
import User from '../users/user.model';
import ActivityLog from './activityLog.model';
import type { CreateActivityLogInput, IActivityLog } from './activityLog.types';

/** Hard ceiling for `limit`. Mirrors `paginationSchema` in
 * `shared/validators/common.validator.ts` so the two cannot drift apart. */
export const MAX_PAGE_LIMIT = 100;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;

/**
 * Coerce raw pagination input into safe positive integers.
 *
 * Express exposes a valueless query param as `''` and junk as e.g. `'abc'`;
 * both `Number()`-coerce to `NaN`. `NaN` then flows into `(page - 1) * limit`
 * and `limit`, producing a rejected Mongo query rather than a clean default —
 * `page = 1` destructuring defaults only apply to `undefined`, never `NaN`.
 * Falling back here also makes direct service callers safe, not just the HTTP
 * layer.
 */
export function normalisePagination(
  page?: number,
  limit?: number
): { page: number; limit: number } {
  const rawPage = typeof page === 'number' ? page : NaN;
  const rawLimit = typeof limit === 'number' ? limit : NaN;

  return {
    page:
      Number.isFinite(rawPage) && rawPage >= 1
        ? Math.floor(rawPage)
        : DEFAULT_PAGE,
    limit:
      Number.isFinite(rawLimit) && rawLimit >= 1
        ? Math.min(Math.floor(rawLimit), MAX_PAGE_LIMIT)
        : DEFAULT_LIMIT,
  };
}

/**
 * Attach the performer's display name and avatar to each entry.
 *
 * Callers only write `performedBy` (an ObjectId) and nothing populates it, so
 * the UI had no way to show who did something. Resolve the ids in one batch
 * query and decorate the results — the same name-map approach used by
 * `workEntry.service.ts` and `assignment.service.ts`. `performedBy` is
 * legitimately `null` for AI and cron jobs, which are left unattributed.
 */
async function withPerformers(logs: IActivityLog[]): Promise<IActivityLog[]> {
  const performerIds = [
    ...new Set(
      logs
        .map(l => l.performedBy)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ];
  if (performerIds.length === 0) return logs;

  // Enrichment is cosmetic — a failure here must never take down the feed.
  let users;
  try {
    users = await User.find({ _id: { $in: performerIds } }).select(
      'firstName lastName avatar'
    );
  } catch (error) {
    logger.error('Activity log performer lookup failed', {
      performerCount: performerIds.length,
      error,
    });
    return logs;
  }

  const nameMap: Record<string, string> = {};
  const avatarMap: Record<string, string | null> = {};
  for (const user of users) {
    const id = String(user._id);
    nameMap[id] = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    avatarMap[id] = user.avatar ?? null;
  }

  return logs.map(log => ({
    ...log,
    // Fall back to the raw id when the user no longer exists so attribution is
    // never silently blanked for deleted accounts.
    performerName: log.performedBy
      ? (nameMap[log.performedBy] ?? log.performedBy)
      : null,
    performerAvatar: log.performedBy
      ? (avatarMap[log.performedBy] ?? null)
      : null,
  }));
}

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
    page: rawPage,
    limit: rawLimit,
  } = filters;
  const { page, limit } = normalisePagination(rawPage, rawLimit);
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
    logs: await withPerformers(logs.map(l => l.toSafeObject())),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getResourceLogs = async (
  resourceType: string,
  resourceId: string,
  page?: number,
  limit?: number
): Promise<{
  logs: IActivityLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { page: safePage, limit: safeLimit } = normalisePagination(page, limit);
  const query = { resourceType, resourceId };
  const skip = (safePage - 1) * safeLimit;
  const [logs, total] = await Promise.all([
    ActivityLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
    ActivityLog.countDocuments(query),
  ]);

  return {
    logs: await withPerformers(logs.map(l => l.toSafeObject())),
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
  };
};
