import { Request, Response } from 'express';
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from '../../config/cloudinary';
import {
  runCandidacyValidation,
  runCandidateScoring,
  runResumeParsing,
} from '../../jobs';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { extractResumeText } from '../../shared/utils/extract-resume-text';
import logger from '../../shared/utils/logger';
import { sendSuccess } from '../../shared/utils/response';
import * as applicationService from '../applications/application.service';
import { getJobById } from '../jobs/job.service';
import * as candidateService from './candidate.service';

export const getAllCandidates = catchAsync(
  async (req: Request, res: Response) => {
    const {
      status,
      inTalentPool: inTalentPoolStr,
      search,
      tags: tagsStr,
      page,
      limit,
    } = req.query as Record<string, string | undefined>;

    const inTalentPool =
      inTalentPoolStr !== undefined ? inTalentPoolStr === 'true' : undefined;

    const tags =
      tagsStr !== undefined
        ? tagsStr
            .split(',')
            .map(t => t.trim())
            .filter(Boolean)
        : undefined;

    const result = await candidateService.getAllCandidates({
      status,
      inTalentPool,
      search,
      tags,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });

    sendSuccess(res, result.candidates, 'Candidates retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);

export const getCandidateById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const candidate = await candidateService.getCandidateById(id, false);
    sendSuccess(res, candidate, 'Candidate retrieved', 200);
  }
);

export const createCandidate = catchAsync(
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Resume file is required');
    }
    const body = req.body;
    const createdBy = req.user!._id;

    // Extract raw text from uploaded PDF/DOCX for AI parsing
    const resumeRawText = await extractResumeText(
      req.file.buffer,
      req.file.mimetype
    );

    const { url } = await uploadToCloudinary(req.file, 'resumes');
    const candidate = await candidateService.createCandidate(
      {
        ...body,
        resumeUrl: url,
        resumeOriginalName: req.file.originalname,
        resumeRawText,
        source: 'internal_upload',
      },
      createdBy
    );
    sendSuccess(res, candidate, 'Candidate created', 201);
  }
);

export const updateCandidate = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;
    const updatedBy = req.user!._id;
    const candidate = await candidateService.updateCandidate(
      id,
      body,
      updatedBy
    );
    sendSuccess(res, candidate, 'Candidate updated', 200);
  }
);

export const deleteCandidate = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await candidateService.deleteCandidate(id);
    sendSuccess(res, { deleted: true }, 'Candidate deleted', 200);
  }
);

export const uploadAvatar = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError(400, 'VALIDATION_ERROR', 'No file provided');
  }
  const { id } = req.params;
  const updatedBy = req.user!._id;
  const candidate = await candidateService.getCandidateById(id);
  const { url } = await uploadToCloudinary(req.file, 'avatars');
  if (candidate.avatar) {
    const match = candidate.avatar.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
    const publicId = match ? match[1] : null;
    if (publicId) {
      deleteFromCloudinary(publicId, 'image');
    }
  }
  const updatedCandidate = await candidateService.updateCandidate(
    id,
    { avatar: url },
    updatedBy
  );
  sendSuccess(res, updatedCandidate, 'Avatar uploaded', 200);
});

export const updateTalentPool = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { action, notes } = req.body;
    const candidate = await candidateService.updateTalentPool(
      id,
      action,
      notes
    );
    sendSuccess(
      res,
      candidate,
      action === 'add' ? 'Added to talent pool' : 'Removed from talent pool',
      200
    );
  }
);

export const assignJob = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { jobId } = req.body;
  const updatedBy = req.user!._id;

  // Verify candidate exists
  const candidate = await candidateService.getCandidateById(id);
  if (!candidate) {
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');
  }

  // Get job to determine clientId
  const job = await getJobById(jobId);
  if (!job) {
    throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
  }

  // Create Application — the link between candidate and job.
  // Phase: 'pending' means approved but not yet placed in a pipeline stage.
  const application = await applicationService.createApplication({
    candidateId: id,
    jobId,
    clientId: job.clientId,
    source: 'assigned',
    createdBy: updatedBy,
  });

  // Trigger AI candidate scoring against this job (background)
  runCandidateScoring(id, jobId);

  sendSuccess(
    res,
    { candidateId: id, jobId, applicationId: application._id, assigned: true },
    'Candidate assigned to job',
    201
  );
});

export const approveCandidate = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const bodyJobId: string | undefined = req.body.jobId;
    const updatedBy = req.user!._id;

    // Verify candidate exists
    const candidate = await candidateService.getCandidateById(id);
    if (!candidate) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');
    }

    // Only pending candidates can be approved
    if (candidate.status !== 'pending') {
      throw new AppError(
        400,
        'CANDIDATE_ALREADY_REVIEWED',
        'This candidate has already been reviewed'
      );
    }

    // Determine jobId — prefer body param, fall back to the candidate's appliedJobId
    // (set when candidate applied via public job page)
    const jobId = bodyJobId || candidate.appliedJobId;
    if (!jobId) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'No job specified — this candidate did not apply via a job posting'
      );
    }

    // Get job to determine clientId
    const job = await getJobById(jobId);
    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
    }

    // Change candidate status to approved
    await candidateService.updateCandidateStatus(id, 'approved');

    // Create Application — the link between candidate and job.
    // Phase: 'pending' means approved but not yet placed in a pipeline stage.
    const application = await applicationService.createApplication({
      candidateId: id,
      jobId,
      clientId: job.clientId,
      source: 'direct_apply',
      createdBy: updatedBy,
    });

    // Trigger TYPE-2 AI candidate scoring against this job (background)
    runCandidateScoring(id, jobId);

    logger.info(
      `Candidate ${id} approved for job ${jobId}, application: ${application._id}`
    );

    sendSuccess(
      res,
      {
        candidateId: id,
        jobId,
        applicationId: application._id,
        approved: true,
      },
      'Candidate approved',
      200
    );
  }
);

export const rejectCandidate = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    // Verify candidate exists
    const candidate = await candidateService.getCandidateById(id);
    if (!candidate) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');
    }

    // Only pending (not-yet-reviewed) candidates can be rejected.
    // Once approved, rejections happen per-application via /applications/:id/reject.
    if (candidate.status !== 'pending') {
      throw new AppError(
        400,
        'CANDIDATE_ALREADY_REVIEWED',
        'Use the application reject endpoint for candidates that have been approved'
      );
    }

    // Permanently delete the candidate and all data (per BUSINESS_LOGIC.md)
    await candidateService.deleteCandidate(id);

    logger.info(`Pending candidate ${id} permanently rejected and deleted`);

    sendSuccess(
      res,
      { deleted: true },
      'Candidate rejected and permanently deleted',
      200
    );
  }
);

export const publicUploadAndParse = catchAsync(
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Resume file is required');
    }

    const body = req.body;

    logger.info(
      `Public upload-and-parse: ${body.firstName} ${body.lastName} (${body.email})`
    );

    // Extract raw text from the uploaded PDF/DOCX
    const resumeRawText = await extractResumeText(
      req.file.buffer,
      req.file.mimetype
    );

    // Upload resume to Cloudinary
    const { url: resumeUrl } = await uploadToCloudinary(req.file, 'resumes');

    // Create candidate (source: 'applied', no createdBy for public)
    const candidate = await candidateService.createCandidate(
      {
        ...body,
        resumeUrl,
        resumeOriginalName: req.file.originalname,
        resumeRawText,
        source: 'applied' as const,
      },
      null // public apply has no authenticated user
    );

    // Await AI resume parsing synchronously (not fire-and-forget)
    if (candidate.resumeRawText && candidate.resumeRawText.trim() !== '') {
      try {
        await runResumeParsing(candidate._id.toString());
      } catch (err) {
        logger.error('AI parsing failed during public upload', {
          candidateId: candidate._id,
          error: (err as Error).message,
        });
        // Don't fail the request — return candidate without parsedData
      }
    }

    // Trigger TYPE 1 AI candidacy validation — fire-and-forget (result stored on Candidate.aiValidation)
    runCandidacyValidation(candidate._id.toString()).catch(err => {
      logger.error('AI candidacy validation failed during public upload', {
        candidateId: candidate._id,
        error: (err as Error).message,
      });
    });

    // Re-fetch to get the parsedData that was saved by the AI job
    const updatedCandidate = await candidateService.getCandidateById(
      candidate._id.toString(),
      false
    );

    logger.info(
      `Public upload-and-parse complete: ${updatedCandidate._id}, parsedData=${!!updatedCandidate.parsedData}`
    );

    sendSuccess(res, updatedCandidate, 'Resume uploaded and parsed', 201);
  }
);
