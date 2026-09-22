import { Request, Response } from 'express';
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from '../../config/cloudinary';
import { runCandidateScoring } from '../../jobs';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { extractResumeText } from '../../shared/utils/extract-resume-text';
import logger from '../../shared/utils/logger';
import { parseResumeTextWithAI } from '../../shared/utils/parseResumeWithAI';
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
      includeIneligible: includeIneligibleStr,
    } = req.query as Record<string, string | undefined>;

    const inTalentPool =
      inTalentPoolStr !== undefined ? inTalentPoolStr === 'true' : undefined;

    const includeIneligible =
      includeIneligibleStr !== undefined
        ? includeIneligibleStr === 'true'
        : undefined;

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
      includeIneligible,
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

    // Permanently ineligible candidates — admin-only access
    if (
      candidate.eligibilityStatus === 'permanently_ineligible' &&
      !req.user!.roles.includes('admin')
    ) {
      throw new AppError(
        403,
        'CANDIDATE_PERMANENTLY_INELIGIBLE',
        'This candidate is permanently ineligible'
      );
    }

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
    const deletedBy = req.user!._id;
    const isAdmin = req.user!.roles.includes('admin');
    await candidateService.deleteCandidate(id, deletedBy, isAdmin);
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
    const performedBy = req.user!._id;
    const candidate = await candidateService.updateTalentPool(
      id,
      action,
      notes,
      performedBy
    );
    sendSuccess(
      res,
      candidate,
      action === 'add' ? 'Added to talent pool' : 'Removed from talent pool',
      200
    );
  }
);

export const rejectCandidate = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { rejectionReasonId, destination, internalNotes } = req.body;
    const performedBy = req.user!._id;
    const candidate = await candidateService.rejectCandidate(
      id,
      { rejectionReasonId, destination, internalNotes },
      performedBy
    );
    sendSuccess(res, candidate, 'Candidate rejected', 200);
  }
);

export const assignJob = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { jobId, startStageId } = req.body;
  const updatedBy = req.user!._id;

  // Verify candidate exists
  const candidate = await candidateService.getCandidateById(id);
  if (!candidate) {
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');
  }

  // Permanently ineligible candidates cannot be assigned to jobs
  if (candidate.eligibilityStatus === 'permanently_ineligible') {
    throw new AppError(
      403,
      'CANDIDATE_PERMANENTLY_INELIGIBLE',
      'This candidate is permanently ineligible and cannot be assigned to a job'
    );
  }

  // Get job to determine clientId
  const job = await getJobById(jobId);
  if (!job) {
    throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
  }

  // Validate startStageId if provided
  if (startStageId && job.pipeline?.stages) {
    const stage = job.pipeline.stages.find(
      (s: any) => s._id.toString() === startStageId
    );
    if (!stage) {
      throw new AppError(
        400,
        'INVALID_STAGE',
        'The specified starting stage does not belong to this job pipeline'
      );
    }
  }

  // Create Application — the link between candidate and job.
  const application = await applicationService.createApplication({
    candidateId: id,
    jobId,
    clientId: job.clientId,
    source: 'assigned',
    createdBy: updatedBy,
  });

  // If a startStageId is provided, move to that stage (application is
  // already approved to the first stage by createApplication for 'assigned'
  // source). Otherwise, the first-stage assignment is left as-is.
  if (startStageId && job.pipeline?.stages) {
    const stage = job.pipeline.stages.find(
      (s: any) => s._id.toString() === startStageId
    );
    if (stage) {
      await applicationService.moveStage(application._id.toString(), {
        stageId: startStageId,
        movedBy: updatedBy.toString(),
      });
    }
  }

  // Trigger AI candidate scoring against this job (background)
  runCandidateScoring(id, jobId);

  // Assigning a pooled candidate to a job moves them out of the talent pool
  // and into the pipeline, so they are not listed in two places at once.
  const current = await candidateService.getCandidateById(id);
  if (current?.inTalentPool) {
    await candidateService.updateTalentPool(id, 'remove', undefined, updatedBy);
  }

  sendSuccess(
    res,
    { candidateId: id, jobId, applicationId: application._id, assigned: true },
    'Candidate assigned to job',
    201
  );
});

/**
 * Change the job on an existing application.
 *
 * `jobId` is part of the unique `(candidateId, jobId)` index and is re-read by
 * every stage operation, so it is never mutated in place. A job change is a
 * composite action: close the current application, then create one for the
 * target job. Both halves are done here so the UI cannot apply only one.
 */
export const changeJob = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { applicationId, targetJobId, startStageId } = req.body;
  const updatedBy = req.user!._id;

  const candidate = await candidateService.getCandidateById(id);
  if (!candidate) {
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');
  }
  if (candidate.eligibilityStatus === 'permanently_ineligible') {
    throw new AppError(
      403,
      'CANDIDATE_PERMANENTLY_INELIGIBLE',
      'This candidate is permanently ineligible and cannot be assigned to a job'
    );
  }

  const currentApplication =
    await applicationService.getApplicationById(applicationId);
  if (String(currentApplication.candidateId) !== id) {
    throw new AppError(
      400,
      'APPLICATION_CANDIDATE_MISMATCH',
      'This application does not belong to the given candidate'
    );
  }
  if (
    currentApplication.phase !== 'pending' &&
    currentApplication.phase !== 'approved'
  ) {
    throw new AppError(
      400,
      'APPLICATION_INVALID_PHASE',
      'Only a pending or approved application can be moved to another job'
    );
  }

  if (String(currentApplication.jobId) === targetJobId) {
    throw new AppError(
      400,
      'APPLICATION_SAME_JOB',
      'The candidate is already on this job'
    );
  }

  const targetJob = await getJobById(targetJobId);
  if (!targetJob) {
    throw new AppError(404, 'JOB_NOT_FOUND', 'Target job not found');
  }
  if (targetJob.status !== 'open') {
    throw new AppError(
      400,
      'JOB_CLOSED',
      'The target job is not open for assignments'
    );
  }

  // Refuse when they already hold an application for the target job, rather
  // than letting the unique index throw a raw duplicate-key error.
  const existing = await applicationService.findApplication(id, targetJobId);
  if (existing) {
    throw new AppError(
      409,
      'CANDIDATE_ALREADY_APPLIED',
      'Candidate already has an application for this job'
    );
  }

  // Validate the target pipeline up front, before anything is mutated.
  // createApplication rejects an 'assigned' application when the job has no
  // pipeline, and doing that after closing the current application would leave
  // the candidate in no pipeline at all — invisible in every tab.
  if (!targetJob.pipeline || targetJob.pipeline.stages.length === 0) {
    throw new AppError(
      422,
      'APPLICATION_NO_PIPELINE',
      'The target job must have a pipeline before a candidate can be moved to it'
    );
  }

  if (startStageId) {
    const stage = targetJob.pipeline.stages.find(
      (s: { _id: { toString(): string } }) => s._id.toString() === startStageId
    );
    if (!stage) {
      throw new AppError(
        400,
        'INVALID_STAGE',
        'The specified starting stage does not belong to this job pipeline'
      );
    }
  }

  // Create the new application FIRST. Every remaining failure mode is a
  // validation error that has already been ruled out above, so if this throws
  // nothing has changed yet and the candidate keeps their current job.
  const application = await applicationService.createApplication({
    candidateId: id,
    jobId: targetJobId,
    clientId: targetJob.clientId,
    source: 'assigned',
    createdBy: updatedBy,
  });

  // Then close the current application — a move, not a rejection, so no
  // destination is applied to the candidate. If this fails (a DB write error,
  // since the phase is already validated) roll the new application back,
  // otherwise the candidate would sit on two live pipelines.
  try {
    await applicationService.rejectApplication(currentApplication._id, {
      rejectedBy: updatedBy,
      reason: `Moved to ${targetJob.title}`,
    });
  } catch (err) {
    await applicationService.removeApplicationById(application._id.toString());
    throw err;
  }

  if (startStageId) {
    await applicationService.moveStage(application._id.toString(), {
      stageId: startStageId,
      movedBy: updatedBy.toString(),
    });
  }

  runCandidateScoring(id, targetJobId);

  // The candidate now belongs to the new job.
  await candidateService.updateAppliedJob(id, targetJobId, updatedBy);

  const current = await candidateService.getCandidateById(id);
  if (current?.inTalentPool) {
    await candidateService.updateTalentPool(id, 'remove', undefined, updatedBy);
  }

  sendSuccess(
    res,
    {
      candidateId: id,
      applicationId: application._id,
      closedApplicationId: currentApplication._id,
      jobId: targetJobId,
      changed: true,
    },
    'Candidate moved to the new job',
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

    // Permanently ineligible candidates cannot be approved into the pipeline
    if (candidate.eligibilityStatus === 'permanently_ineligible') {
      throw new AppError(
        403,
        'CANDIDATE_PERMANENTLY_INELIGIBLE',
        'This candidate is permanently ineligible and cannot be approved into the pipeline'
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
    await candidateService.updateCandidateStatus(id, 'approved', updatedBy);

    // Create Application — the link between candidate and job.
    const application = await applicationService.createApplication({
      candidateId: id,
      jobId,
      clientId: job.clientId,
      source: 'direct_apply',
      createdBy: updatedBy,
    });

    // Immediately approve the application so the candidate lands in the
    // pipeline at the job's first stage (In Pipeline tab) rather than
    // staying in a 'pending' limbo state with no stage assigned.
    if (job.pipeline && job.pipeline.stages.length > 0) {
      await applicationService.approveApplication(application._id.toString(), {
        approvedBy: updatedBy.toString(),
      });
    }

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

export const updateEligibility = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { eligibilityStatus, reason } = req.body;
    const performedBy = req.user!._id;

    const candidate = await candidateService.updateCandidateEligibility(
      id,
      eligibilityStatus,
      reason,
      performedBy
    );
    sendSuccess(res, candidate, 'Candidate eligibility updated');
  }
);

export const restoreCandidate = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { jobId } = req.body;
    const performedBy = req.user!._id;

    const job = await getJobById(jobId);
    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
    }

    const candidate = await candidateService.restoreCandidate(
      id,
      jobId,
      performedBy
    );
    sendSuccess(res, candidate, 'Candidate restored to review', 200);
  }
);

export const updateLegalHold = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { legalHold } = req.body;
    const performedBy = req.user!._id;
    const candidate = await candidateService.updateCandidateLegalHold(
      id,
      legalHold,
      performedBy
    );
    sendSuccess(res, candidate, 'Candidate legal hold updated');
  }
);

export const publicParse = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Resume file is required');
  }

  logger.info(`Public parse resume: ${req.file.originalname}`);

  // Extract raw text from the uploaded PDF/DOCX (NO Cloudinary upload, NO DB save)
  const resumeRawText = await extractResumeText(
    req.file.buffer,
    req.file.mimetype
  );

  // Run AI parsing on the extracted text (stateless — no candidate saved)
  const parsedData = await parseResumeTextWithAI(resumeRawText);

  logger.info(
    `Public parse complete: skills=${parsedData?.skills?.length ?? 0}, experience=${parsedData?.experience?.length ?? 0}`
  );

  sendSuccess(res, parsedData, 'Resume parsed successfully');
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

    // Extract raw text from the uploaded PDF/DOCX (image-based PDFs are
    // rejected here — thrown as FILE_IMAGE_BASED_PDF).
    const resumeRawText = await extractResumeText(
      req.file.buffer,
      req.file.mimetype
    );

    // Parse with AI — stateless: NO candidate is created or saved here, and
    // NO Cloudinary upload happens here. The resume is uploaded to Cloudinary
    // only on final submit (POST /jobs/:id/apply) so abandoned applications
    // don't leave orphan files consuming storage.
    const parsedData = await parseResumeTextWithAI(resumeRawText);

    logger.info(
      `Public upload-and-parse complete: skills=${parsedData?.skills?.length ?? 0}, experience=${parsedData?.experience?.length ?? 0}`
    );

    sendSuccess(
      res,
      {
        resumeOriginalName: req.file.originalname,
        resumeRawText,
        parsedData,
      },
      'Resume parsed successfully',
      201
    );
  }
);
