import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as externalMeetingService from './externalMeeting.service';

export const getAllExternalMeetings = catchAsync(
  async (req: Request, res: Response) => {
    const { status, attendeeId, page, limit } = req.query as Record<
      string,
      string | undefined
    >;
    const result = await externalMeetingService.getAllExternalMeetings({
      status,
      attendeeId,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    sendSuccess(res, result.meetings, 'External meetings retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);

export const getExternalMeetingById = catchAsync(
  async (req: Request, res: Response) => {
    const meeting = await externalMeetingService.getExternalMeetingById(
      req.params.id
    );
    sendSuccess(res, meeting, 'External meeting retrieved', 200);
  }
);

export const createExternalMeeting = catchAsync(
  async (req: Request, res: Response) => {
    const meeting = await externalMeetingService.createExternalMeeting({
      ...req.body,
      organizerId: req.user!._id,
    });
    sendSuccess(res, meeting, 'External meeting scheduled', 201);
  }
);

export const updateExternalMeeting = catchAsync(
  async (req: Request, res: Response) => {
    const meeting = await externalMeetingService.updateExternalMeeting(
      req.params.id,
      req.body
    );
    sendSuccess(res, meeting, 'External meeting updated', 200);
  }
);

export const cancelExternalMeeting = catchAsync(
  async (req: Request, res: Response) => {
    const meeting = await externalMeetingService.cancelExternalMeeting(
      req.params.id
    );
    sendSuccess(res, meeting, 'External meeting cancelled', 200);
  }
);
