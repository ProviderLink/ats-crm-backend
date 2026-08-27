import { Request, Response } from 'express';
import { AppError } from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import Application from '../applications/application.model';
import Job from '../jobs/job.model';
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
    const updatedBy = req.user!._id;
    const interview = await interviewService.updateInterview(
      id,
      body,
      updatedBy
    );
    sendSuccess(res, interview, 'Interview updated', 200);
  }
);

export const cancelInterview = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const cancelledBy = req.user!._id;
    const interview = await interviewService.cancelInterview(id, cancelledBy);
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

// ── Nested handlers (under /applications/:applicationId/interviews) ──

export const getInterviewsForApplication = catchAsync(
  async (req: Request, res: Response) => {
    const { applicationId } = req.params;
    const { status, interviewerId, page, limit } = req.query as Record<
      string,
      string | undefined
    >;

    const result = await interviewService.getAllInterviews({
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

export const createInterviewForApplication = catchAsync(
  async (req: Request, res: Response) => {
    const { applicationId } = req.params;
    const organizerId = req.user!._id;

    // Derive candidateId, jobId, clientId from the application
    const application = await Application.findById(applicationId);
    if (!application) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
    }

    // Allow scheduling for a different job than the application's own.
    // When a jobId override is supplied, derive the clientId from that job;
    // otherwise fall back to the application's existing job/client.
    const jobId = req.body.jobId ?? application.jobId.toString();
    let clientId = application.clientId.toString();
    if (jobId !== application.jobId.toString()) {
      const job = await Job.findById(jobId);
      if (!job) {
        throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
      }
      clientId = job.clientId.toString();
    }

    const interview = await interviewService.createInterview({
      ...req.body,
      applicationId,
      candidateId: application.candidateId.toString(),
      jobId,
      clientId,
      organizerId,
    });

    sendSuccess(res, interview, 'Interview scheduled', 201);
  }
);
