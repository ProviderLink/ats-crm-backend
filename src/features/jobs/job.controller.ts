import { Request, Response } from 'express';
import { uploadToCloudinary } from '../../config/cloudinary';
import { runCandidacyValidation, runResumeParsing } from '../../jobs';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { extractResumeText } from '../../shared/utils/extract-resume-text';
import logger from '../../shared/utils/logger';
import { sendSuccess } from '../../shared/utils/response';
import { createLog } from '../activity-logs/activityLog.service';
import * as candidateService from '../candidates/candidate.service';
import EmailTemplate from '../email-templates/emailTemplate.model';
import * as emailService from '../emails/email.service';
import * as settingsService from '../settings/settings.service';
import * as jobService from './job.service';
import { toPublicJob } from './job.public';
import { generateJobDraft } from './jobDraft.service';
import { standardizeJobContent } from './jobStandardize.service';

export const getAllJobs = catchAsync(async (req: Request, res: Response) => {
  const { clientId, status, search, page, limit } = req.query as Record<
    string,
    string | undefined
  >;
  // Anonymous visitors (the careers portal) only ever see open jobs, trimmed
  // to the public fields. Signed-in callers get the full list as before.
  const isAnonymous = !req.user;
  const result = await jobService.getAllJobs({
    clientId: isAnonymous ? undefined : clientId,
    status: isAnonymous ? 'open' : status,
    search,
    page: page !== undefined ? Number(page) : undefined,
    limit: limit !== undefined ? Number(limit) : undefined,
  });
  sendSuccess(
    res,
    isAnonymous ? result.jobs.map(toPublicJob) : result.jobs,
    'Jobs retrieved',
    200,
    {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    }
  );
});

export const getJobById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const job = await jobService.getJobById(id);
  if (!req.user) {
    // Drafts are never public; closed jobs stay viewable so shared links work.
    if (job.status === 'draft') {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
    }
    sendSuccess(res, toPublicJob(job), 'Job retrieved', 200);
    return;
  }
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
  const deletedBy = req.user!._id;
  await jobService.deleteJob(id, deletedBy);
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

export const generateDraft = catchAsync(async (req: Request, res: Response) => {
  const { notes } = req.body as { notes: string };
  const draft = await generateJobDraft({ notes });
  sendSuccess(res, draft, 'Job draft generated', 200);
});

export const standardizeContent = catchAsync(
  async (req: Request, res: Response) => {
    const result = await standardizeJobContent(req.body);
    sendSuccess(res, result, 'Job content standardized', 200);
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

  if (!req.file) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Resume file is required');
  }

  // A returning applicant who is already approved, hired or in a pipeline keeps
  // their record exactly as it is: nothing is uploaded or overwritten.
  const existingApplicant = await candidateService.findExistingApplicant(
    body.email,
    body.phone
  );
  const refreshProfile =
    !existingApplicant ||
    (await candidateService.canApplicantUpdateProfile(existingApplicant));

  // Resolve the resume at final submit: upload the file to Cloudinary here
  // (instead of during the stateless parse step) so abandoned applications
  // don't leave orphan files consuming storage.
  let resumeUrl = '';
  let resumeRawText: string | undefined = body.resumeRawText;
  let resumeOriginalName: string = body.resumeOriginalName || 'resume.pdf';

  if (refreshProfile) {
    resumeOriginalName = req.file.originalname || resumeOriginalName;
    resumeRawText =
      body.resumeRawText && body.resumeRawText.trim() !== ''
        ? body.resumeRawText
        : await extractResumeText(req.file.buffer, req.file.mimetype);
    const { url } = await uploadToCloudinary(req.file, 'resumes');
    resumeUrl = url;
  }

  // Optional work samples — a link, a file, or neither. Never required, since
  // only some roles (e.g. design) have a portfolio to show.
  let portfolioFileUrl: string | null = null;
  let portfolioFileName: string | null = null;
  if (refreshProfile && req.portfolioFile) {
    const uploaded = await uploadToCloudinary(req.portfolioFile, 'portfolios');
    portfolioFileUrl = uploaded.url;
    portfolioFileName = req.portfolioFile.originalname;
  }

  // Always find-or-create by email/phone. A client-supplied `candidateId` is
  // deliberately NOT honoured: this route is public, so accepting it would let
  // anyone modify an arbitrary existing candidate.
  let candidateId: string;

  // Find-or-create candidate via email+phone dedup (handles reapplicants).
  // appliedJobId is set atomically during creation so it's never missing.
  const { candidate, isExisting } =
    await candidateService.findOrCreateCandidate(
      {
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        resumeUrl,
        resumeOriginalName,
        resumeRawText,
        videoIntroUrl: body.videoIntroUrl ?? null,
        portfolioUrl: body.portfolioUrl ?? null,
        portfolioFileUrl,
        portfolioFileName,
        yearsOfExperience: body.yearsOfExperience ?? 0,
        englishProficiency: body.englishProficiency ?? null,
        currentSalaryPHP: body.currentSalaryPHP ?? null,
        currentSalaryUSD: body.currentSalaryUSD ?? null,
        reasonForLeaving: body.reasonForLeaving ?? null,
        cityOfResidence: body.cityOfResidence ?? null,
        parsedData: body.parsedData ?? null,
        source: 'applied',
        appliedJobId: jobId,
      },
      null
    );
  candidateId = candidate._id;

  // If this is a permanently ineligible candidate reapplying, log + flag
  if (candidate.eligibilityStatus === 'permanently_ineligible') {
    logger.warn(
      `Permanently ineligible candidate ${candidateId} reapplied for job ${jobId}`
    );
    createLog({
      action: 'ineligible_reapply_blocked',
      resourceType: 'candidate',
      resourceId: candidateId,
      metadata: { jobId },
      performedBy: null,
    });

    sendSuccess(
      res,
      { candidateId, jobId, received: true, blocked: true },
      'Application received',
      201
    );
    return;
  }

  // Trigger AI resume parsing for the newly created candidate (background)
  // only when parsedData wasn't already supplied from the stateless parse.
  if (
    refreshProfile &&
    !body.parsedData &&
    candidate.resumeRawText &&
    candidate.resumeRawText.trim() !== ''
  ) {
    runResumeParsing(candidateId).catch(err => {
      logger.error('AI resume parsing failed during job apply', {
        candidateId,
        error: (err as Error).message,
      });
    });
  }

  if (refreshProfile) {
    // Ensure appliedJobId is set for re-applies too.
    await candidateService.updateCandidate(
      candidateId,
      { appliedJobId: jobId } as any,
      null
    );

    // Trigger TYPE-1 candidacy validation (real / fake / garbage check)
    runCandidacyValidation(candidateId);
  }

  // Send application confirmation email if enabled in settings (fire-and-forget)
  settingsService
    .getSettings()
    .then(async settings => {
      const { enabled, templateId } = settings.applicationConfirmation;
      if (!enabled || !templateId) return;

      const template = await EmailTemplate.findById(templateId);
      if (!template || !template.isActive) return;

      const candidate = await candidateService.getCandidateById(candidateId);
      if (!candidate.email) return;

      emailService
        .sendEmail({
          to: [candidate.email],
          subject: template.subject,
          bodyHtml: template.bodyHtml,
          bodyText: template.bodyText,
          templateId: templateId,
          context: {
            type: 'application_confirmation',
            candidateId,
            jobId,
            applicationId: null,
            interviewId: null,
          },
          variables: {
            candidateName:
              `${candidate.firstName} ${candidate.lastName}`.trim(),
            candidateEmail: candidate.email,
            jobTitle: job.title,
            companyName: settings.email.fromName,
          },
        })
        .catch(err => {
          logger.error('Application confirmation email failed', {
            candidateId,
            error: (err as Error).message,
          });
        });
    })
    .catch(err => {
      logger.error('Failed to load settings for confirmation email', {
        error: (err as Error).message,
      });
    });

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
