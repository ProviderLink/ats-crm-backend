import mongoose from 'mongoose';
import { deleteFromCloudinary } from '../../config/cloudinary';
import { runResumeParsing } from '../../jobs';
import { AppError } from '../../shared/utils/AppError';
import logger from '../../shared/utils/logger';
import { emitToAts } from '../../sockets';
import { createLog } from '../activity-logs/activityLog.service';
import Interview from '../interviews/interview.model';
import Candidate, { normalizePhone } from './candidate.model';
import type {
  CreateCandidateInput,
  ICandidate,
  ICandidateAiScore,
  ICandidateAiValidation,
  ICandidateParsedData,
  UpdateCandidateInput,
} from './candidate.types';

function extractCloudinaryPublicId(url: string): string | null {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
  return match ? match[1] : null;
}

export const getAllCandidates = async (filters: {
  status?: string;
  inTalentPool?: boolean;
  search?: string;
  tags?: string[];
  page?: number;
  limit?: number;
  includeIneligible?: boolean;
  includeBlockedApps?: boolean;
}): Promise<{
  candidates: ICandidate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const {
    status,
    inTalentPool,
    search,
    tags,
    page = 1,
    limit = 20,
    includeIneligible = false,
  } = filters;
  const query: Record<string, unknown> = {};

  if (status !== undefined) query['status'] = status;
  if (inTalentPool !== undefined) query['inTalentPool'] = inTalentPool;
  if (tags !== undefined && tags.length > 0) query['tags'] = { $in: tags };
  if (search !== undefined && search.trim() !== '')
    query['$text'] = { $search: search };

  // Default: exclude permanently ineligible candidates unless explicitly requested
  if (!includeIneligible) {
    query['eligibilityStatus'] = { $ne: 'permanently_ineligible' };
  }

  const skip = (page - 1) * limit;
  const [candidates, total] = await Promise.all([
    Candidate.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Candidate.countDocuments(query),
  ]);

  return {
    candidates: candidates.map(c => c.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getCandidateById = async (
  id: string,
  includeRawText = false
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  const result = candidate.toSafeObject();
  if (!includeRawText) delete (result as Partial<ICandidate>)['resumeRawText'];
  return result;
};

export const getCandidateByEmail = async (
  email: string
): Promise<ICandidate | null> => {
  const candidate = await Candidate.findOne({
    email: email.toLowerCase(),
  });
  if (!candidate) return null;
  return candidate.toSafeObject();
};

/**
 * Find an existing candidate by email or normalized phone, or create a new one.
 * Returns {candidate, isExisting} so callers can react to pre-existing profiles.
 * This is the single entry point for both internal and public candidate creation.
 */
export const findOrCreateCandidate = async (
  input: CreateCandidateInput,
  createdBy: string | null
): Promise<{ candidate: ICandidate; isExisting: boolean }> => {
  const normalizedPhone = normalizePhone(input.phone);

  // 1. Email match (case-insensitive)
  const byEmail = await Candidate.findOne({
    email: input.email.toLowerCase(),
  });
  if (byEmail) {
    // Existing candidate — update resume if new one provided
    if (input.resumeUrl && input.resumeRawText) {
      byEmail.resumeUrl = input.resumeUrl;
      byEmail.resumeOriginalName = input.resumeOriginalName;
      byEmail.resumeRawText = input.resumeRawText;
    }
    // Always record the job they applied to (idempotent)
    if (input.appliedJobId && !byEmail.appliedJobId) {
      byEmail.appliedJobId = new mongoose.Types.ObjectId(input.appliedJobId);
    }
    await byEmail.save();
    return { candidate: byEmail.toSafeObject(), isExisting: true };
  }

  // 2. Phone match (normalized)
  if (normalizedPhone) {
    const byPhone = await Candidate.findOne({
      phoneNormalized: normalizedPhone,
    });
    if (byPhone) {
      if (input.resumeUrl && input.resumeRawText) {
        byPhone.resumeUrl = input.resumeUrl;
        byPhone.resumeOriginalName = input.resumeOriginalName;
        byPhone.resumeRawText = input.resumeRawText;
      }
      // Always record the job they applied to (idempotent)
      if (input.appliedJobId && !byPhone.appliedJobId) {
        byPhone.appliedJobId = new mongoose.Types.ObjectId(input.appliedJobId);
      }
      await byPhone.save();
      return { candidate: byPhone.toSafeObject(), isExisting: true };
    }
  }

  // 3. Create new candidate
  const status = input.source === 'applied' ? 'pending' : 'approved';

  const candidate = await Candidate.create({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone ?? '',
    phoneNormalized: normalizedPhone,
    resumeUrl: input.resumeUrl,
    resumeOriginalName: input.resumeOriginalName,
    resumeRawText: input.resumeRawText ?? '',
    videoIntroUrl: input.videoIntroUrl ?? null,
    videoIntroSource: input.videoIntroSource ?? null,
    yearsOfExperience: input.yearsOfExperience ?? 0,
    englishProficiency: input.englishProficiency ?? null,
    currentSalaryPHP: input.currentSalaryPHP ?? null,
    currentSalaryUSD: input.currentSalaryUSD ?? null,
    reasonForLeaving: input.reasonForLeaving ?? null,
    cityOfResidence: input.cityOfResidence ?? null,
    source: input.source,
    tags: input.tags ? input.tags.map(t => new mongoose.Types.ObjectId(t)) : [],
    appliedJobId: input.appliedJobId
      ? new mongoose.Types.ObjectId(input.appliedJobId)
      : null,
    status,
    createdBy: createdBy ? new mongoose.Types.ObjectId(createdBy) : null,
  });

  // Trigger AI resume parsing in background if resume text is provided
  if (candidate.resumeRawText && candidate.resumeRawText.trim() !== '') {
    runResumeParsing(candidate._id.toString());
  }

  createLog({
    action: 'created',
    resourceType: 'candidate',
    resourceId: candidate._id.toString(),
    metadata: {
      source: input.source,
      status,
      appliedJobId: input.appliedJobId ?? null,
    },
    performedBy: createdBy,
  });

  const result = candidate.toSafeObject();
  emitToAts('candidates', 'candidate:created', result);
  return { candidate: result, isExisting: false };
};

export const createCandidate = async (
  input: CreateCandidateInput,
  createdBy: string | null
): Promise<ICandidate> => {
  const existing = await Candidate.findOne({
    email: input.email.toLowerCase(),
  });
  if (existing)
    throw new AppError(
      409,
      'CANDIDATE_ALREADY_EXISTS',
      'A candidate with this email already exists'
    );

  const status = input.source === 'applied' ? 'pending' : 'approved';

  const candidate = await Candidate.create({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone ?? '',
    phoneNormalized: normalizePhone(input.phone),
    resumeUrl: input.resumeUrl,
    resumeOriginalName: input.resumeOriginalName,
    resumeRawText: input.resumeRawText ?? '',
    videoIntroUrl: input.videoIntroUrl ?? null,
    videoIntroSource: input.videoIntroSource ?? null,
    yearsOfExperience: input.yearsOfExperience ?? 0,
    englishProficiency: input.englishProficiency ?? null,
    currentSalaryPHP: input.currentSalaryPHP ?? null,
    currentSalaryUSD: input.currentSalaryUSD ?? null,
    reasonForLeaving: input.reasonForLeaving ?? null,
    cityOfResidence: input.cityOfResidence ?? null,
    source: input.source,
    tags: input.tags ? input.tags.map(t => new mongoose.Types.ObjectId(t)) : [],
    status,
    createdBy: createdBy ? new mongoose.Types.ObjectId(createdBy) : null,
  });

  // Trigger AI resume parsing in background if resume text is provided
  if (candidate.resumeRawText && candidate.resumeRawText.trim() !== '') {
    runResumeParsing(candidate._id.toString());
  }

  createLog({
    action: 'created',
    resourceType: 'candidate',
    resourceId: candidate._id.toString(),
    metadata: { source: input.source, status },
    performedBy: createdBy,
  });

  const result = candidate.toSafeObject();
  emitToAts('candidates', 'candidate:created', result);
  return result;
};

export const updateCandidate = async (
  id: string,
  input: UpdateCandidateInput,
  updatedBy: string | null
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  const changes: string[] = [];

  if (
    input.firstName !== undefined &&
    input.firstName !== candidate.firstName
  ) {
    changes.push(
      `First name changed from "${candidate.firstName}" to "${input.firstName}"`
    );
    candidate.firstName = input.firstName;
  } else if (input.firstName !== undefined) {
    candidate.firstName = input.firstName;
  }
  if (input.lastName !== undefined && input.lastName !== candidate.lastName) {
    changes.push(
      `Last name changed from "${candidate.lastName}" to "${input.lastName}"`
    );
    candidate.lastName = input.lastName;
  } else if (input.lastName !== undefined) {
    candidate.lastName = input.lastName;
  }
  if (input.phone !== undefined && input.phone !== candidate.phone) {
    changes.push('Phone number updated');
    candidate.phone = input.phone;
  } else if (input.phone !== undefined) {
    candidate.phone = input.phone;
  }
  if (input.avatar !== undefined) {
    changes.push('Profile photo updated');
    candidate.avatar = input.avatar;
  }
  if (
    input.videoIntroUrl !== undefined &&
    input.videoIntroUrl !== candidate.videoIntroUrl
  ) {
    changes.push(
      input.videoIntroUrl ? 'Video intro updated' : 'Video intro removed'
    );
    candidate.videoIntroUrl = input.videoIntroUrl;
  } else if (input.videoIntroUrl !== undefined) {
    candidate.videoIntroUrl = input.videoIntroUrl;
  }
  if (input.videoIntroSource !== undefined)
    candidate.videoIntroSource = input.videoIntroSource;
  if (
    input.yearsOfExperience !== undefined &&
    input.yearsOfExperience !== candidate.yearsOfExperience
  ) {
    changes.push(
      `Years of experience changed from ${candidate.yearsOfExperience} to ${input.yearsOfExperience}`
    );
    candidate.yearsOfExperience = input.yearsOfExperience;
  } else if (input.yearsOfExperience !== undefined) {
    candidate.yearsOfExperience = input.yearsOfExperience;
  }
  if (
    input.englishProficiency !== undefined &&
    input.englishProficiency !== candidate.englishProficiency
  ) {
    changes.push(
      `English proficiency changed from "${candidate.englishProficiency}" to "${input.englishProficiency}"`
    );
    candidate.englishProficiency = input.englishProficiency;
  } else if (input.englishProficiency !== undefined) {
    candidate.englishProficiency = input.englishProficiency;
  }
  if (
    input.currentSalaryPHP !== undefined &&
    input.currentSalaryPHP !== candidate.currentSalaryPHP
  ) {
    changes.push('Current salary (PHP) updated');
    candidate.currentSalaryPHP = input.currentSalaryPHP;
  } else if (input.currentSalaryPHP !== undefined) {
    candidate.currentSalaryPHP = input.currentSalaryPHP;
  }
  if (
    input.currentSalaryUSD !== undefined &&
    input.currentSalaryUSD !== candidate.currentSalaryUSD
  ) {
    changes.push('Current salary (USD) updated');
    candidate.currentSalaryUSD = input.currentSalaryUSD;
  } else if (input.currentSalaryUSD !== undefined) {
    candidate.currentSalaryUSD = input.currentSalaryUSD;
  }
  if (
    input.reasonForLeaving !== undefined &&
    input.reasonForLeaving !== candidate.reasonForLeaving
  ) {
    changes.push('Reason for leaving updated');
    candidate.reasonForLeaving = input.reasonForLeaving;
  } else if (input.reasonForLeaving !== undefined) {
    candidate.reasonForLeaving = input.reasonForLeaving;
  }
  if (
    input.cityOfResidence !== undefined &&
    input.cityOfResidence !== candidate.cityOfResidence
  ) {
    changes.push(
      `City of residence changed from "${candidate.cityOfResidence ?? 'unset'}" to "${input.cityOfResidence}"`
    );
    candidate.cityOfResidence = input.cityOfResidence;
  } else if (input.cityOfResidence !== undefined) {
    candidate.cityOfResidence = input.cityOfResidence;
  }
  if (input.tags !== undefined) {
    changes.push('Tags updated');
    candidate.tags = input.tags.map(
      t => new mongoose.Types.ObjectId(t)
    ) as unknown as mongoose.Types.ObjectId[];
  }
  if (input.parsedData !== undefined) {
    changes.push('Profile data updated');
    candidate.parsedData = input.parsedData;
    candidate.markModified('parsedData');
  }
  if (input.appliedJobId !== undefined) {
    changes.push('Applied job updated');
    candidate.appliedJobId = input.appliedJobId
      ? new mongoose.Types.ObjectId(input.appliedJobId)
      : null;
  }

  candidate.updatedBy = updatedBy
    ? (new mongoose.Types.ObjectId(
        updatedBy
      ) as unknown as mongoose.Types.ObjectId)
    : null;

  await candidate.save();

  createLog({
    action: 'updated',
    resourceType: 'candidate',
    resourceId: id,
    metadata: changes.length > 0 ? { changes } : {},
    performedBy: updatedBy,
  });

  const result = candidate.toSafeObject();
  emitToAts('candidates', 'candidate:updated', result);
  return result;
};

export const deleteCandidate = async (
  id: string,
  deletedBy?: string | null,
  isAdmin = false
): Promise<{ deleted: boolean }> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  // Legal hold — block deletion regardless of role
  if (candidate.legalHold) {
    throw new AppError(
      409,
      'LEGAL_HOLD',
      'Cannot delete candidate — subject to legal hold'
    );
  }

  // Permanently ineligible — only admins
  if (candidate.eligibilityStatus === 'permanently_ineligible' && !isAdmin) {
    throw new AppError(
      403,
      'CANDIDATE_PERMANENTLY_INELIGIBLE',
      'Only an administrator can delete a permanently ineligible candidate'
    );
  }

  if (candidate.resumeUrl) {
    const publicId = extractCloudinaryPublicId(candidate.resumeUrl);
    if (publicId) await deleteFromCloudinary(publicId, 'raw');
  }

  if (candidate.avatar) {
    const publicId = extractCloudinaryPublicId(candidate.avatar);
    if (publicId) await deleteFromCloudinary(publicId, 'image');
  }

  // Delete all interviews associated with this candidate
  const interviewResult = await Interview.deleteMany({ candidateId: id });
  if (interviewResult.deletedCount > 0) {
    logger.info(
      `Deleted ${interviewResult.deletedCount} interview(s) for candidate ${id}`
    );
  }

  await candidate.deleteOne();

  createLog({
    action: 'deleted',
    resourceType: 'candidate',
    resourceId: id,
    performedBy: deletedBy ?? null,
  });

  emitToAts('candidates', 'candidate:deleted', { _id: id });
  return { deleted: true };
};

export const updateTalentPool = async (
  id: string,
  action: 'add' | 'remove',
  notes?: string,
  performedBy?: string | null
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  if (action === 'add') {
    candidate.inTalentPool = true;
    candidate.talentPoolAddedAt = new Date();
    candidate.talentPoolNotes = notes ?? null;
  } else {
    candidate.inTalentPool = false;
    candidate.talentPoolAddedAt = null;
    candidate.talentPoolNotes = null;
  }

  await candidate.save();

  createLog({
    action: action === 'add' ? 'talent_pool_added' : 'talent_pool_removed',
    resourceType: 'candidate',
    resourceId: id,
    performedBy: performedBy ?? null,
  });

  const result = candidate.toSafeObject();
  emitToAts('candidates', 'candidate:updated', result);
  return result;
};

export const updateCandidateStatus = async (
  id: string,
  status: 'pending' | 'approved' | 'hired',
  performedBy?: string | null
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  const previousStatus = candidate.status;
  candidate.status = status;
  await candidate.save();

  createLog({
    action: 'status_changed',
    resourceType: 'candidate',
    resourceId: id,
    metadata: { from: previousStatus, to: status },
    performedBy: performedBy ?? null,
  });

  const result = candidate.toSafeObject();
  emitToAts('candidates', 'candidate:updated', result);
  emitToAts('candidates', 'candidate:statusChanged', {
    _id: result._id,
    status,
  });
  return result;
};

export const updateParsedData = async (
  id: string,
  parsedData: ICandidateParsedData
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  candidate.parsedData = parsedData;
  candidate.markModified('parsedData');

  // Also update the top-level yearsOfExperience from AI-extracted value
  if (
    parsedData.yearsOfExperience !== undefined &&
    parsedData.yearsOfExperience > 0
  ) {
    candidate.yearsOfExperience = parsedData.yearsOfExperience;
  }

  await candidate.save();

  createLog({
    action: 'parsed_data_updated',
    resourceType: 'candidate',
    resourceId: id,
    metadata: {
      sections: [
        (parsedData.skills?.length ?? 0) > 0 ? 'skills' : null,
        (parsedData.experience?.length ?? 0) > 0 ? 'experience' : null,
        (parsedData.education?.length ?? 0) > 0 ? 'education' : null,
      ].filter(Boolean),
      skillsCount: parsedData.skills?.length ?? 0,
      experienceCount: parsedData.experience?.length ?? 0,
      educationCount: parsedData.education?.length ?? 0,
    },
  });

  const result = candidate.toSafeObject();
  emitToAts('candidates', 'candidate:updated', result);
  return result;
};

export const updateAiScore = async (
  id: string,
  aiScore: ICandidateAiScore
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  candidate.aiScore = aiScore;
  candidate.markModified('aiScore');
  await candidate.save();

  createLog({
    action: 'ai_score_updated',
    resourceType: 'candidate',
    resourceId: id,
    metadata: { score: aiScore.score, recommendation: aiScore.recommendation },
  });

  const result = candidate.toSafeObject();
  emitToAts('candidates', 'candidate:updated', result);
  return result;
};

export const updateAiValidation = async (
  id: string,
  aiValidation: ICandidateAiValidation
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  candidate.aiValidation = aiValidation;
  candidate.markModified('aiValidation');
  await candidate.save();

  createLog({
    action: 'ai_validation_updated',
    resourceType: 'candidate',
    resourceId: id,
    metadata: {
      isValid: aiValidation.isValid,
      score: aiValidation.score,
      reason: aiValidation.reason,
    },
  });

  return candidate.toSafeObject();
};

export const updateCandidateEligibility = async (
  id: string,
  eligibilityStatus: 'eligible' | 'permanently_ineligible',
  reason?: string,
  performedBy?: string | null
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  const previousStatus = candidate.eligibilityStatus;
  candidate.eligibilityStatus = eligibilityStatus;

  if (eligibilityStatus === 'permanently_ineligible') {
    candidate.permanentlyIneligibleAt = new Date();
    candidate.permanentlyIneligibleBy = performedBy
      ? new mongoose.Types.ObjectId(performedBy)
      : null;
    candidate.permanentlyIneligibleReason = reason
      ? new mongoose.Types.ObjectId(reason)
      : null;
  } else {
    // Clearing permanently_ineligible — reset all ineligible markers
    candidate.permanentlyIneligibleAt = null;
    candidate.permanentlyIneligibleBy = null;
    candidate.permanentlyIneligibleReason = null;
  }

  await candidate.save();

  createLog({
    action: 'eligibility_changed',
    resourceType: 'candidate',
    resourceId: id,
    metadata: {
      from: previousStatus,
      to: eligibilityStatus,
      reason,
    },
    performedBy: performedBy ?? null,
  });

  const result = candidate.toSafeObject();
  emitToAts('candidates', 'candidate:updated', result);
  return result;
};

export const updateCandidateLegalHold = async (
  id: string,
  legalHold: boolean,
  performedBy?: string | null
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  candidate.legalHold = legalHold;
  await candidate.save();

  createLog({
    action: 'legal_hold_toggled',
    resourceType: 'candidate',
    resourceId: id,
    metadata: { legalHold },
    performedBy: performedBy ?? null,
  });

  const result = candidate.toSafeObject();
  emitToAts('candidates', 'candidate:updated', result);
  return result;
};
