import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as surveyReminderService from './surveyReminder.service';

export const getAllSurveyReminders = catchAsync(
  async (req: Request, res: Response) => {
    const { relatedType, relatedId, status, assignedTo, page, limit } =
      req.query as Record<string, string | undefined>;
    const result = await surveyReminderService.getAllSurveyReminders({
      relatedType,
      relatedId,
      status,
      assignedTo,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    sendSuccess(
      res,
      result.surveyReminders,
      'Survey reminders retrieved',
      200,
      {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      }
    );
  }
);

export const getSurveyReminderById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const surveyReminder =
      await surveyReminderService.getSurveyReminderById(id);
    sendSuccess(res, surveyReminder, 'Survey reminder retrieved', 200);
  }
);

export const createSurveyReminder = catchAsync(
  async (req: Request, res: Response) => {
    const surveyReminder = await surveyReminderService.createSurveyReminder(
      req.body,
      req.user!._id
    );
    sendSuccess(res, surveyReminder, 'Survey reminder created', 201);
  }
);

export const updateSurveyReminder = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const surveyReminder = await surveyReminderService.updateSurveyReminder(
      id,
      req.body,
      req.user!._id
    );
    sendSuccess(res, surveyReminder, 'Survey reminder updated', 200);
  }
);
