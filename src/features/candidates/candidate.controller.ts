import { Request, Response } from 'express';
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from '../../config/cloudinary';
import { runResumeParsing } from '../../jobs';
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

  // Create application
  const application = await applicationService.createApplication({
    candidateId: id,
    jobId,
    clientId: job.clientId,
    source: 'assigned',
    createdBy: updatedBy,
  });

  sendSuccess(
    res,
    { candidateId: id, jobId, applicationId: application._id, assigned: true },
    'Candidate assigned to job',
    201
  );
});

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
