import mongoose from 'mongoose';
import {
  runCandidateScoring,
  runResumeParsing,
  runResumeValidation,
} from '../../jobs';
import { AppError } from '../../shared/utils/AppError';
import { emitToAts } from '../../sockets';
import { createLog } from '../activity-logs/activityLog.service';
import Candidate from '../candidates/candidate.model';
import * as candidateService from '../candidates/candidate.service';
import DispositionReason from '../disposition-reasons/dispositionReason.model';
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

  // Permanently ineligible candidate trying to apply — block the application
  const isBlocked = candidate.eligibilityStatus === 'permanently_ineligible';

  if (input.source === 'direct_apply' && job.status !== 'open' && !isBlocked) {
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

  // Blocked applications always stay pending regardless of source
  if (isBlocked) {
    phase = 'pending';
    currentStage = null;
  } else if (input.source === 'direct_apply') {
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
    isBlocked,
    createdBy: input.createdBy
      ? new mongoose.Types.ObjectId(input.createdBy)
      : null,
  });

  if (
    (input.source === 'internal_upload' || input.source === 'assigned') &&
    !isBlocked
  ) {
    // Attribute the derived status change to whoever created the application,
    // otherwise the candidate timeline shows an unattributed "changed the
    // candidate status" entry that reads as a system event.
    await candidateService.updateCandidateStatus(
      input.candidateId,
      'approved',
      input.createdBy ?? null
    );
  }

  if (input.source === 'direct_apply' && !isBlocked) {
    runResumeValidation(application._id.toString());
  }

  // Trigger resume parsing for any source if candidate has raw text
  // but parsedData is missing or hollow (empty skills + experience + education)
  if (candidate.resumeRawText && candidate.resumeRawText.trim() !== '') {
    const pd = candidate.parsedData;
    const hasContent =
      pd &&
      ((pd.skills && pd.skills.length > 0) ||
        (pd.experience && pd.experience.length > 0) ||
        (pd.education && pd.education.length > 0));
    if (!hasContent) {
      runResumeParsing(candidate._id.toString());
    }
  }

  createLog({
    action: isBlocked ? 'ineligible_reapply_blocked' : 'applied',
    resourceType: 'application',
    resourceId: application._id.toString(),
    relatedType: 'candidate',
    relatedId: input.candidateId,
    metadata: { source: input.source, phase, isBlocked },
    performedBy: input.createdBy ?? null,
  });

  const result = application.toSafeObject();
  emitToAts('applications', 'application:created', result);
  return result;
};

export const approveApplication = async (
  id: string,
  input: ApproveApplicationInput,
  startStageId?: string
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

  // Use the specified startStageId if provided, otherwise default to first stage
  let targetStage = job.pipeline.stages.sort(
    (a: { order: number }, b: { order: number }) => a.order - b.order
  )[0];

  if (startStageId) {
    const found = job.pipeline.stages.find(
      (s: any) => s._id.toString() === startStageId
    );
    if (found) targetStage = found;
  }

  application.phase = 'approved';
  application.currentStage = {
    stageId: targetStage._id,
    stageName: targetStage.name,
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
    'approved',
    input.approvedBy
  );

  createLog({
    action: 'approved',
    resourceType: 'application',
    resourceId: id,
    relatedType: 'candidate',
    relatedId: String(application.candidateId),
    metadata: { stageName: targetStage.name },
    performedBy: input.approvedBy,
  });

  const result = application.toSafeObject();
  emitToAts('applications', 'application:updated', result);
  emitToAts('applications', 'application:phaseChanged', {
    _id: result._id,
    phase: 'approved',
  });
  return result;
};

export const rejectApplication = async (
  id: string,
  input: RejectApplicationInput
): Promise<IApplication> => {
  const application = await Application.findById(id);
  if (!application) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  }
  if (application.phase !== 'pending' && application.phase !== 'approved') {
    throw new AppError(
      400,
      'APPLICATION_INVALID_PHASE',
      'Only pending or approved applications can be rejected'
    );
  }

  const performedById = new mongoose.Types.ObjectId(input.rejectedBy);
  const now = new Date();

  // ── A candidate still live on another job keeps that job untouched ──
  // Banning or pooling them here would silently destroy the other pipeline,
  // so a non-final reject is a plain "remove from this job" with no
  // platform-wide side effects.
  const otherLiveApplications = await Application.countDocuments({
    candidateId: application.candidateId,
    _id: { $ne: application._id },
    phase: { $in: ['pending', 'approved'] },
  });
  const isFinalReject = otherLiveApplications === 0;

  // ── Resolve the structured reason (optional) ──
  let reasonLabel: string | null = input.reason?.trim() || null;
  let reasonId: mongoose.Types.ObjectId | null = null;
  let destination: 'candidate_pool' | 'permanently_ineligible' | null = null;

  if (isFinalReject && input.rejectionReasonId) {
    const reason = await DispositionReason.findById(input.rejectionReasonId);
    if (!reason) {
      throw new AppError(
        404,
        'DISPOSITION_REASON_NOT_FOUND',
        'Disposition reason not found'
      );
    }
    if (!reason.isActive) {
      throw new AppError(
        400,
        'DISPOSITION_REASON_INACTIVE',
        'This disposition reason is no longer active'
      );
    }
    if (
      reason.requireInternalNotes &&
      (!input.internalNotes || input.internalNotes.trim() === '')
    ) {
      throw new AppError(
        422,
        'INTERNAL_NOTES_REQUIRED',
        'Internal notes are required for this disposition reason'
      );
    }

    reasonId = new mongoose.Types.ObjectId(input.rejectionReasonId);
    reasonLabel = reason.label;
    // A reason in the permanently-ineligible category always wins.
    destination =
      reason.defaultEligibility === 'permanently_ineligible'
        ? 'permanently_ineligible'
        : (input.destination ?? 'candidate_pool');
  }

  // Preserve the last pipeline stage for historical reference.
  if (application.currentStage) {
    application.lastStage = application.currentStage;
  } else {
    application.lastStage = null;
  }
  application.currentStage = null;

  application.phase = 'rejected';
  application.rejectedAt = now;
  application.rejectedBy = performedById;
  application.rejectionReason = reasonLabel;

  // Disposition payload — only when this was the candidate's last live job.
  if (destination) {
    application.closedAt = now;
    application.closedBy = performedById;
    application.dispositionDate = now;
    application.dispositionReasonId = reasonId;
    application.dispositionDestination = destination;
    application.internalNotes = input.internalNotes ?? null;
  }

  await application.save();

  createLog({
    action: 'rejected',
    resourceType: 'application',
    resourceId: id,
    relatedType: 'candidate',
    relatedId: String(application.candidateId),
    metadata: {
      reason: application.rejectionReason,
      reasonId: input.rejectionReasonId ?? null,
      destination,
      internalNotes: input.internalNotes ?? null,
      isFinalReject,
    },
    performedBy: input.rejectedBy,
  });

  // ── Candidate side-effects — only on the final (decisive) reject ──
  // A candidate is never moved to Talent Pool or Ineligible automatically on a
  // non-final reject; that only happens when the destination is explicitly
  // chosen, which the UI offers exclusively on the last live application.
  if (destination) {
    await candidateService.updateTalentPool(
      String(application.candidateId),
      destination === 'candidate_pool' ? 'add' : 'remove',
      destination === 'candidate_pool'
        ? (input.internalNotes ?? undefined)
        : undefined,
      input.rejectedBy
    );

    if (destination === 'permanently_ineligible') {
      await candidateService.updateCandidateEligibility(
        String(application.candidateId),
        'permanently_ineligible',
        input.rejectionReasonId,
        input.rejectedBy
      );
    }

    createLog({
      action: 'disposition',
      resourceType: 'candidate',
      resourceId: String(application.candidateId),
      relatedType: 'application',
      relatedId: id,
      metadata: {
        destination,
        reasonId: input.rejectionReasonId ?? null,
        reasonLabel,
        lastStage: application.lastStage?.stageName ?? null,
        internalNotes: input.internalNotes ?? null,
      },
      performedBy: input.rejectedBy,
    });
  }

  const result = application.toSafeObject();
  emitToAts('applications', 'application:updated', result);
  emitToAts('applications', 'application:phaseChanged', {
    _id: result._id,
    phase: 'rejected',
  });
  return result;
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

  const previousStageName = application.currentStage?.stageName ?? null;

  application.currentStage = {
    stageId: targetStage._id,
    stageName: targetStage.name,
    assignedAt: new Date(),
    assignedBy: new mongoose.Types.ObjectId(input.movedBy),
  };
  await application.save();

  createLog({
    action: 'stage_changed',
    resourceType: 'application',
    resourceId: id,
    relatedType: 'candidate',
    relatedId: String(application.candidateId),
    metadata: { from: previousStageName, to: targetStage.name },
    performedBy: input.movedBy,
  });

  const result = application.toSafeObject();
  emitToAts('applications', 'application:updated', result);
  return result;
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
    'hired',
    input.hiredBy
  );

  const candidate = await Candidate.findById(application.candidateId);
  if (!candidate) {
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');
  }

  const { inviteToken } = await userService.provisionVA(
    String(candidate._id),
    candidate.firstName,
    candidate.lastName,
    candidate.email,
    input.hiredBy
  );

  if (inviteToken !== null) {
    userService
      .sendTeamMemberInvite({
        email: candidate.email,
        firstName: candidate.firstName,
        inviteToken,
        invitedByName: 'ATS System',
      })
      .catch(err => {
        console.error('Failed to send VA invite email:', err);
      });
  }

  createLog({
    action: 'hired',
    resourceType: 'application',
    resourceId: id,
    relatedType: 'candidate',
    relatedId: String(application.candidateId),
    performedBy: input.hiredBy,
  });

  const result = application.toSafeObject();
  emitToAts('applications', 'application:updated', result);
  emitToAts('applications', 'application:phaseChanged', {
    _id: result._id,
    phase: 'hired',
  });
  return result;
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

  createLog({
    action: 'notes_updated',
    resourceType: 'application',
    resourceId: id,
    relatedType: 'candidate',
    relatedId: String(application.candidateId),
    performedBy: updatedBy,
  });

  const result = application.toSafeObject();
  emitToAts('applications', 'application:updated', result);
  return result;
};

export const updateApplicationAiScore = async (
  id: string,
  aiScore: {
    score: number;
    recommendation: string;
    summary: string;
    strengths: string[];
    concerns: string[];
  }
): Promise<IApplication> => {
  const application = await Application.findById(id);
  if (!application) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  }

  application.aiScore = aiScore;
  application.markModified('aiScore');
  await application.save();

  createLog({
    action: 'ai_score_updated',
    resourceType: 'application',
    resourceId: id,
    relatedType: 'candidate',
    relatedId: String(application.candidateId),
    metadata: { score: aiScore.score, recommendation: aiScore.recommendation },
  });

  const result = application.toSafeObject();
  emitToAts('applications', 'application:updated', result);
  return result;
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

  createLog({
    action: 'ai_validation_updated',
    resourceType: 'application',
    resourceId: id,
    relatedType: 'candidate',
    relatedId: String(application.candidateId),
    metadata: {
      isValid: aiValidation.isValid,
      score: aiValidation.score,
      reason: aiValidation.reason,
    },
  });

  return application.toSafeObject();
};
