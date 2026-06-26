import { Request, Response } from 'express';
import { runCandidacyValidation } from '../../jobs';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import logger from '../../shared/utils/logger';
import { sendSuccess } from '../../shared/utils/response';
import * as candidateService from '../candidates/candidate.service';
import * as jobService from './job.service';

export const getAllJobs = catchAsync(async (req: Request, res: Response) => {
  const { clientId, status, search, page, limit } = req.query as Record<
    string,
    string | undefined
  >;
  const result = await jobService.getAllJobs({
    clientId,
    status,
    search,
    page: page !== undefined ? Number(page) : undefined,
    limit: limit !== undefined ? Number(limit) : undefined,
  });
  sendSuccess(res, result.jobs, 'Jobs retrieved', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

export const getJobById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const job = await jobService.getJobById(id);
  sendSuccess(res, job, 'Job retrieved', 200);
});

export const createJob = catchAsync(async (req: Request, res: Response) => {
  const body = req.body;
  const createdBy = req.user!._id;
  const job = await jobService.createJob(body, createdBy);
  sendSuccess(res, job, 'Job created', 201);
});

export const updateJob = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body;
  const updatedBy = req.user!._id;
  const job = await jobService.updateJob(id, body, updatedBy);
  sendSuccess(res, job, 'Job updated', 200);
});

export const deleteJob = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  await jobService.deleteJob(id);
  sendSuccess(res, { deleted: true }, 'Job deleted', 200);
});

export const updateJobStatus = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const updatedBy = req.user!._id;
    const job = await jobService.updateJobStatus(id, status, updatedBy);
    sendSuccess(res, job, 'Job status updated', 200);
  }
);

export const assignPipeline = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;
    const updatedBy = req.user!._id;
    const job = await jobService.assignPipeline(id, body, updatedBy);
    sendSuccess(res, job, 'Pipeline assigned', 200);
  }
);

export const applyToJob = catchAsync(async (req: Request, res: Response) => {
  const { id: jobId } = req.params;
  const body = req.body;

  // Validate job exists and is open
  const job = await jobService.getJobById(jobId);
  if (job.status !== 'open') {
    throw new AppError(
      400,
      'JOB_CLOSED',
      'This job is not accepting applications'
    );
  }

  let candidateId = body.candidateId;

  // If candidateId is provided, update the existing candidate with reviewed data
  if (candidateId) {
    if (body.parsedData) {
      await candidateService.updateCandidate(
        candidateId,
        { parsedData: body.parsedData },
        null // public apply, no auth user
      );
    }
  } else {
    // Fallback: create a candidate if not already created via publicUploadAndParse
    const candidate = await candidateService.createCandidate(
      {
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        resumeUrl: body.resumeUrl,
        resumeOriginalName: body.resumeOriginalName || 'resume.pdf',
        resumeRawText: body.resumeRawText || '',
        videoIntroUrl: body.videoIntroUrl ?? null,
        source: 'applied',
      },
      null
    );
    candidateId = candidate._id;
  }

  // Store the job they applied to on the candidate — used later when
  // the recruiter approves (no need to pick a job).
  await candidateService.updateCandidate(
    candidateId,
    { appliedJobId: jobId } as any,
    null
  );

  // Trigger TYPE-1 candidacy validation (real / fake / garbage check)
  runCandidacyValidation(candidateId);

  // No Application is created here — applications are created only when
  // a recruiter approves the candidate (see candidate.controller.ts approveCandidate).
  // The candidate stays as status: "pending" until reviewed.

  logger.info(
    `Application received for job ${jobId}, candidate: ${candidateId}`
  );

  sendSuccess(
    res,
    { candidateId, jobId, received: true },
    'Application received',
    201
  );
});
