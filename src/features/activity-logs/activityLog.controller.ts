import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as activityLogService from './activityLog.service';

/**
 * Parse an optional numeric query param.
 *
 * A valueless param (`?page=`) arrives as `''`, which is NOT `undefined`, so
 * the previous `Number(page)` produced `0` and the service's `page = 1`
 * default never applied — `skip` became negative and Mongo rejected the query.
 * Anything non-numeric (`NaN`) would poison the query the same way. Returning
 * `undefined` for absent/blank values restores the intended defaults.
 */
function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const getAllLogs = catchAsync(async (req: Request, res: Response) => {
  const { resourceType, resourceId, action, performedBy, page, limit } =
    req.query as Record<string, string | undefined>;

  const result = await activityLogService.getAllLogs({
    resourceType,
    resourceId,
    action,
    performedBy,
    page: parseOptionalInt(page),
    limit: parseOptionalInt(limit),
  });

  sendSuccess(res, result.logs, 'Activity logs retrieved', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

export const getResourceLogs = catchAsync(
  async (req: Request, res: Response) => {
    const { resourceType, resourceId } = req.params;
    const { page, limit } = req.query as Record<string, string | undefined>;

    const result = await activityLogService.getResourceLogs(
      resourceType,
      resourceId,
      parseOptionalInt(page),
      parseOptionalInt(limit)
    );

    sendSuccess(res, result.logs, 'Resource activity logs retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);
