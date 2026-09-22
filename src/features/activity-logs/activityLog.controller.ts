import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as activityLogService from './activityLog.service';

export const getAllLogs = catchAsync(async (req: Request, res: Response) => {
  const { resourceType, resourceId, action, performedBy, page, limit } =
    req.query as Record<string, string | undefined>;

  const result = await activityLogService.getAllLogs({
    resourceType,
    resourceId,
    action,
    performedBy,
    page: page !== undefined ? Number(page) : undefined,
    limit: limit !== undefined ? Number(limit) : undefined,
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
    const { page, limit, includeRelated } = req.query as Record<
      string,
      string | undefined
    >;

    const result = await activityLogService.getResourceLogs(
      resourceType,
      resourceId,
      page !== undefined ? Number(page) : undefined,
      limit !== undefined ? Number(limit) : undefined,
      includeRelated === 'true'
    );

    sendSuccess(res, result.logs, 'Resource activity logs retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);
