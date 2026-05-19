import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as interviewService from './interview.service';

export const getAllInterviews = catchAsync(
  async (req: Request, res: Response) => {
    const {
      candidateId,
      jobId,
      applicationId,
      status,
      interviewerId,
      page,
      limit,
    } = req.query as Record<string, string | undefined>;

    const result = await interviewService.getAllInterviews({
      candidateId,
      jobId,
      applicationId,
      status,
      interviewerId,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });

    sendSuccess(res, result.interviews, 'Interviews retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);

export const getInterviewById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const interview = await interviewService.getInterviewById(id);
    sendSuccess(res, interview, 'Interview retrieved', 200);
  }
);

export const createInterview = catchAsync(
  async (req: Request, res: Response) => {
    const body = req.body;
    const organizerId = req.user!._id;
    const interview = await interviewService.createInterview({
      ...body,
      organizerId,
    });
    sendSuccess(res, interview, 'Interview scheduled', 201);
  }
);

export const updateInterview = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;
    const interview = await interviewService.updateInterview(id, body);
    sendSuccess(res, interview, 'Interview updated', 200);
  }
);

export const cancelInterview = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const interview = await interviewService.cancelInterview(id);
    sendSuccess(res, interview, 'Interview cancelled', 200);
  }
);

export const submitFeedback = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const interviewerId = req.user!._id;
    const { rating, notes, recommendation } = req.body;
    const interview = await interviewService.submitFeedback(id, {
      interviewerId,
      rating,
      notes,
      recommendation,
    });
    sendSuccess(res, interview, 'Feedback submitted', 201);
  }
);
