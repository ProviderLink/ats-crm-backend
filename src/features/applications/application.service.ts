import mongoose from 'mongoose';
import { runCandidateScoring, runResumeValidation } from '../../jobs';
import { AppError } from '../../shared/utils/AppError';
import Candidate from '../candidates/candidate.model';
import * as candidateService from '../candidates/candidate.service';
import Job from '../jobs/job.model';
import * as userService from '../users/user.service';
import Application from './application.model';
import type {
  ApproveApplicationInput,
  CreateApplicationInput,
  HireApplicationInput,
  IApplication,
  MoveStageInput,
  RejectApplicationInput,
} from './application.types';

export const getAllApplications = async (filters: {
  jobId?: string;
  candidateId?: string;
  clientId?: string;
  phase?: string;
  page?: number;
  limit?: number;
}) => {
  const query: Record<string, unknown> = {};
  if (filters.jobId) query.jobId = filters.jobId;
  if (filters.candidateId) query.candidateId = filters.candidateId;
  if (filters.clientId) query.clientId = filters.clientId;
  if (filters.phase) query.phase = filters.phase;

  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const [applications, total] = await Promise.all([
    Application.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Application.countDocuments(query),
  ]);

  return {
    applications: applications.map(a => a.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getApplicationById = async (id: string): Promise<IApplication> => {
  const application = await Application.findById(id);
  if (!application) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  }
  return application.toSafeObject();
};

export const createApplication = async (
  input: CreateApplicationInput
): Promise<IApplication> => {
  const candidate = await Candidate.findById(input.candidateId);
  if (!candidate) {
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');
  }

  const job = await Job.findById(input.jobId);
  if (!job) {
    throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
  }

  if (input.source === 'direct_apply' && job.status !== 'open') {
    throw new AppError(
      400,
      'JOB_CLOSED',
      'This job is not accepting applications'
    );
  }

  const existing = await Application.findOne({
    candidateId: input.candidateId,
    jobId: input.jobId,
  });
  if (existing) {
    throw new AppError(
      409,
      'CANDIDATE_ALREADY_APPLIED',
      'Candidate has already applied to this job'
    );
  }

  let phase: string;
  let currentStage: {
    stageId: mongoose.Types.ObjectId;
    stageName: string;
    assignedAt: Date;
    assignedBy: mongoose.Types.ObjectId | null;
  } | null;

  if (input.source === 'direct_apply') {
    phase = 'pending';
    currentStage = null;
  } else {
    if (!job.pipeline || job.pipeline.stages.length === 0) {
      throw new AppError(
        422,
        'APPLICATION_NO_PIPELINE',
        'Job must have a pipeline before candidates can be assigned'
      );
    }
    const firstStage = job.pipeline.stages.sort(
      (a: { order: number }, b: { order: number }) => a.order - b.order
    )[0];
    phase = 'approved';
    currentStage = {
      stageId: firstStage._id,
      stageName: firstStage.name,
      assignedAt: new Date(),
      assignedBy: input.createdBy
        ? new mongoose.Types.ObjectId(input.createdBy)
        : null,
    };
  }

  const application = await Application.create({
    candidateId: input.candidateId,
    jobId: input.jobId,
    clientId: input.clientId,
    source: input.source,
    phase,
    currentStage,
    createdBy: input.createdBy
      ? new mongoose.Types.ObjectId(input.createdBy)
      : null,
  });

  if (input.source === 'internal_upload' || input.source === 'assigned') {
    await candidateService.updateCandidateStatus(input.candidateId, 'approved');
  }

  if (input.source === 'direct_apply') {
    runResumeValidation(application._id.toString());
  }

  return application.toSafeObject();
};

export const approveApplication = async (
  id: string,
  input: ApproveApplicationInput
): Promise<IApplication> => {
  const application = await Application.findById(id);
  if (!application) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  }
  if (application.phase !== 'pending') {
    throw new AppError(
      400,
      'APPLICATION_INVALID_PHASE',
      'Only pending applications can be approved'
    );
  }

  const job = await Job.findById(application.jobId);
  if (!job?.pipeline || job.pipeline.stages.length === 0) {
    throw new AppError(
      422,
      'APPLICATION_NO_PIPELINE',
      'Job must have a pipeline assigned before approving candidates'
    );
  }

  const firstStage = job.pipeline.stages.sort(
    (a: { order: number }, b: { order: number }) => a.order - b.order
  )[0];

  application.phase = 'approved';
  application.currentStage = {
    stageId: firstStage._id,
    stageName: firstStage.name,
    assignedAt: new Date(),
    assignedBy: new mongoose.Types.ObjectId(input.approvedBy),
  };
  application.approvedAt = new Date();
  application.approvedBy = new mongoose.Types.ObjectId(input.approvedBy);
  await application.save();

  runCandidateScoring(
    String(application.candidateId),
    String(application.jobId)
  );

  await candidateService.updateCandidateStatus(
    String(application.candidateId),
    'approved'
  );

  return application.toSafeObject();
};

export const rejectApplication = async (
  id: string,
  input: RejectApplicationInput
): Promise<IApplication | { deleted: boolean; isFirstRejection: boolean }> => {
  const application = await Application.findById(id);
  if (!application) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  }

  const isFirstRejection = application.phase === 'pending';

  if (isFirstRejection) {
    await Application.deleteOne({ _id: application._id });
    await candidateService.deleteCandidate(String(application.candidateId));
    return { deleted: true, isFirstRejection: true };
  }

  application.phase = 'rejected';
  application.rejectedAt = new Date();
  application.rejectedBy = new mongoose.Types.ObjectId(input.rejectedBy);
  application.rejectionReason = input.rejectionReason ?? null;
  application.currentStage = null;
  await application.save();

  const activeApps = await Application.countDocuments({
    candidateId: application.candidateId,
    phase: { $in: ['pending', 'approved'] },
  });
  if (activeApps === 0) {
    const candidate = await Candidate.findById(application.candidateId);
    if (candidate && !candidate.inTalentPool) {
      await candidateService.deleteCandidate(String(application.candidateId));
    }
  }

  return application.toSafeObject();
};

export const moveStage = async (
  id: string,
  input: MoveStageInput
): Promise<IApplication> => {
  const application = await Application.findById(id);
  if (!application) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  }
  if (application.phase !== 'approved') {
    throw new AppError(
      400,
      'APPLICATION_INVALID_PHASE',
      'Can only move stages for approved applications'
    );
  }

  const job = await Job.findById(application.jobId);
  const targetStage = job?.pipeline?.stages.find(
    (s: { _id: mongoose.Types.ObjectId }) => String(s._id) === input.stageId
  );
  if (!targetStage) {
    throw new AppError(404, 'STAGE_NOT_FOUND', 'Pipeline stage not found');
  }

  application.currentStage = {
    stageId: targetStage._id,
    stageName: targetStage.name,
    assignedAt: new Date(),
    assignedBy: new mongoose.Types.ObjectId(input.movedBy),
  };
  await application.save();

  return application.toSafeObject();
};

export const hireApplication = async (
  id: string,
  input: HireApplicationInput
): Promise<IApplication> => {
  const application = await Application.findById(id);
  if (!application) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  }
  if (application.phase !== 'approved') {
    throw new AppError(
      400,
      'APPLICATION_INVALID_PHASE',
      'Can only hire candidates that are in pipeline'
    );
  }

  application.phase = 'hired';
  application.hiredAt = new Date();
  application.hiredBy = new mongoose.Types.ObjectId(input.hiredBy);
  await application.save();

  await candidateService.updateCandidateStatus(
    String(application.candidateId),
    'hired'
  );

  const candidate = await Candidate.findById(application.candidateId);
  if (!candidate) {
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');
  }

  const { inviteToken } = await userService.provisionVA(
    String(candidate._id),
    candidate.firstName,
    candidate.lastName,
    candidate.email
  );

  if (inviteToken !== null) {
    console.log(
      `VA account created for ${candidate.email}. Invite token: ${inviteToken}`
    );
  }

  return application.toSafeObject();
};

export const updateApplicationNotes = async (
  id: string,
  notes: string,
  updatedBy: string
): Promise<IApplication> => {
  const application = await Application.findById(id);
  if (!application) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  }

  application.notes = notes;
  application.updatedBy = new mongoose.Types.ObjectId(updatedBy);
  await application.save();

  return application.toSafeObject();
};

export const updateAiValidation = async (
  id: string,
  aiValidation: {
    isValid: boolean;
    score: number;
    reason: string;
  }
): Promise<IApplication> => {
  const application = await Application.findById(id);
  if (!application) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  }

  application.aiValidation = {
    ...aiValidation,
    completedAt: new Date(),
  };
  application.markModified('aiValidation');
  await application.save();

  return application.toSafeObject();
};
