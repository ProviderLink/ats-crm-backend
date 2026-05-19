import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as eodReminderService from './eodReminder.service';

export const getAllEodReminders = catchAsync(
  async (req: Request, res: Response) => {
    const { assignmentId, candidateId, status, page, limit } =
      req.query as Record<string, string | undefined>;
    const result = await eodReminderService.getAllEodReminders({
      assignmentId,
      candidateId,
      status,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    sendSuccess(res, result.eodReminders, 'EOD reminders retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);

export const getEodReminderById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const eodReminder = await eodReminderService.getEodReminderById(id);
    sendSuccess(res, eodReminder, 'EOD reminder retrieved', 200);
  }
);
