import mongoose from 'mongoose';
import { deleteFromCloudinary } from '../../config/cloudinary';
import { runResumeParsing } from '../../jobs';
import { AppError } from '../../shared/utils/AppError';
import logger from '../../shared/utils/logger';
import { emitToAts } from '../../sockets';
import ActivityLog from '../activity-logs/activityLog.model';
import { createLog } from '../activity-logs/activityLog.service';
import Application from '../applications/application.model';
import Assignment from '../assignments/assignment.model';
import DispositionReason from '../disposition-reasons/dispositionReason.model';
import Email from '../emails/email.model';
import EodReminder from '../eod-reminders/eodReminder.model';
import EodSubmission from '../eod-submissions/eodSubmission.model';
import InterviewScorecard from '../interview-scorecards/interview-scorecard.model';
import Interview from '../interviews/interview.model';
import PerformanceReview from '../performance-reviews/performanceReview.model';
import WorkEntry from '../work-entries/workEntry.model';
import Candidate, {
  normalizePhone,
  type ICandidateDocument,
} from './candidate.model';
import type {
  CreateCandidateInput,
  ICandidate,
  ICandidateAiScore,
  ICandidateAiValidation,
  ICandidateParsedData,
  UpdateCandidateInput,
} from './candidate.types';

function extractCloudinaryPublicId(
  url: string,
  resourceType: 'raw' | 'image' = 'image'
): string | null {
  const match = url.split('?')[0].match(/\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  let publicId = match[1];
  try {
    publicId = decodeURIComponent(publicId);
  } catch {
    // Keep the raw path if decoding fails.
  }
  // Images store their format separately, so the extension is not part of the
  // public_id. Raw assets keep the full uploaded path (extension included when
  // the file was uploaded with one).
  if (resourceType === 'image') {
    publicId = publicId.replace(/\.[^.]+$/, '');
  }
  return publicId;
}

export const getAllCandidates = async (filters: {
  status?: string;
  inTalentPool?: boolean;
  eligibilityStatus?: 'eligible' | 'permanently_ineligible';
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
    eligibilityStatus,
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

  // An explicit eligibilityStatus filter is authoritative — it lets a caller
  // request ONLY the permanently-ineligible set (the admin Ineligible page),
  // rather than fetching a mixed page and filtering client-side, which silently
  // truncated the list once a client had more candidates than the page size.
  if (eligibilityStatus !== undefined) {
    query['eligibilityStatus'] = eligibilityStatus;
  } else if (!includeIneligible) {
    // Default: exclude permanently ineligible candidates unless requested
    query['eligibilityStatus'] = { $ne: 'permanently_ineligible' };
  }

  const skip = (page - 1) * limit;
  const [candidates, total] = await Promise.all([
    Candidate.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Candidate.countDocuments(query),
  ]);

  // Resolve disposition-reason labels in one batch — the admin Ineligible list
  // needs the human label, and the codebase never uses populate(). Inactive or
  // since-deleted reasons are still resolved so old rows keep their wording.
  const reasonIds = [
    ...new Set(
      candidates
        .map(
          c =>
            (c as unknown as { permanentlyIneligibleReason?: unknown })
              .permanentlyIneligibleReason
        )
        .filter(Boolean)
        .map(String)
    ),
  ];
  const reasonDocs =
    reasonIds.length > 0
      ? await DispositionReason.find({ _id: { $in: reasonIds } }).select(
          'label'
        )
      : [];
  const reasonLabelMap: Record<string, string> = Object.fromEntries(
    reasonDocs.map(r => [String(r._id), String(r.label ?? '')])
  );

  return {
    candidates: candidates.map(c => {
      const safe = c.toSafeObject() as ICandidate & {
        permanentlyIneligibleReasonLabel?: string | null;
      };
      // Full resume text is large and only the detail/export paths need it.
      delete (safe as Partial<ICandidate>)['resumeRawText'];
      const reasonId = safe.permanentlyIneligibleReason;
      safe.permanentlyIneligibleReasonLabel = reasonId
        ? (reasonLabelMap[String(reasonId)] ?? null)
        : null;
      return safe;
    }),
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
 * Re-applying through the public form refreshes the stored resume and profile
 * only while the candidate is still In Review. Once they are approved, hired
 * or in a pipeline (or banned) their record is left exactly as it is.
 */
export const canApplicantUpdateProfile = async (
  candidate: ICandidateDocument
): Promise<boolean> => {
  if (candidate.status !== 'pending') return false;
  if (candidate.eligibilityStatus === 'permanently_ineligible') return false;
  const inPipeline = await Application.exists({
    candidateId: candidate._id,
    phase: { $in: ['approved', 'hired'] },
  });
  return !inPipeline;
};

/** The candidate a public application belongs to, matched by email then phone. */
export const findExistingApplicant = async (
  email: string,
  phone?: string
): Promise<ICandidateDocument | null> => {
  const byEmail = await Candidate.findOne({ email: email.toLowerCase() });
  if (byEmail) return byEmail;
  const normalizedPhone = normalizePhone(phone);
  return normalizedPhone
    ? Candidate.findOne({ phoneNormalized: normalizedPhone })
    : null;
};

/**
 * Merge portfolio input onto an existing candidate on re-apply.
 *
 * Only overwrites what the applicant actually supplied. The superseded
 * Cloudinary file is kept so an overwrite from a public request is recoverable.
 */
async function applyPortfolioToExisting(
  existing: ICandidateDocument,
  input: CreateCandidateInput
): Promise<void> {
  if (input.portfolioUrl !== undefined && input.portfolioUrl !== null) {
    existing.portfolioUrl = input.portfolioUrl;
  }

  if (
    input.portfolioFileUrl !== undefined &&
    input.portfolioFileUrl !== null &&
    input.portfolioFileUrl !== existing.portfolioFileUrl
  ) {
    existing.portfolioFileUrl = input.portfolioFileUrl;
    existing.portfolioFileName = input.portfolioFileName ?? null;
  }
}

/** Apply a re-application's resume, portfolio and parsed data to a candidate. */
async function refreshFromApplication(
  existing: ICandidateDocument,
  input: CreateCandidateInput
): Promise<void> {
  if (input.resumeUrl && input.resumeRawText) {
    // The previous resume file is intentionally kept in Cloudinary: this
    // refresh comes from a public request, so an overwrite stays recoverable.
    existing.resumeUrl = input.resumeUrl;
    existing.resumeOriginalName = input.resumeOriginalName;
    existing.resumeRawText = input.resumeRawText;
  }
  await applyPortfolioToExisting(existing, input);
  // Save AI-parsed data when provided (re-apply with a freshly parsed resume)
  if (input.parsedData) {
    existing.parsedData = input.parsedData;
    existing.markModified('parsedData');
  }
  // Always record the job they applied to (idempotent)
  if (input.appliedJobId && !existing.appliedJobId) {
    existing.appliedJobId = new mongoose.Types.ObjectId(input.appliedJobId);
  }
}

/**
 * Find an existing candidate by email or normalized phone, or create a new one.
 * Returns {candidate, isExisting} so callers can react to pre-existing profiles.
 * An existing candidate is only updated while they are still In Review (see
 * canApplicantUpdateProfile).
 */
export const findOrCreateCandidate = async (
  input: CreateCandidateInput,
  createdBy: string | null
): Promise<{ candidate: ICandidate; isExisting: boolean }> => {
  const normalizedPhone = normalizePhone(input.phone);

  // 1. Email match (case-insensitive), 2. phone match (normalized)
  const existing =
    (await Candidate.findOne({ email: input.email.toLowerCase() })) ??
    (normalizedPhone
      ? await Candidate.findOne({ phoneNormalized: normalizedPhone })
      : null);
  if (existing) {
    if (await canApplicantUpdateProfile(existing)) {
      await refreshFromApplication(existing, input);
      await existing.save();
    }
    return { candidate: existing.toSafeObject(), isExisting: true };
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
    portfolioUrl: input.portfolioUrl ?? null,
    portfolioFileUrl: input.portfolioFileUrl ?? null,
    portfolioFileName: input.portfolioFileName ?? null,
    yearsOfExperience: input.yearsOfExperience ?? 0,
    englishProficiency: input.englishProficiency ?? null,
    currentSalaryPHP: input.currentSalaryPHP ?? null,
    currentSalaryUSD: input.currentSalaryUSD ?? null,
    reasonForLeaving: input.reasonForLeaving ?? null,
    cityOfResidence: input.cityOfResidence ?? null,
    parsedData: input.parsedData ?? null,
    source: input.source,
    tags: input.tags ? input.tags.map(t => new mongoose.Types.ObjectId(t)) : [],
    appliedJobId: input.appliedJobId
      ? new mongoose.Types.ObjectId(input.appliedJobId)
      : null,
    status,
    createdBy: createdBy ? new mongoose.Types.ObjectId(createdBy) : null,
  });

  // Trigger AI resume parsing in background only when parsedData wasn't already
  // supplied by the caller (avoids overwriting reviewed data with a re-parse).
  if (
    !input.parsedData &&
    candidate.resumeRawText &&
    candidate.resumeRawText.trim() !== ''
  ) {
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
    portfolioUrl: input.portfolioUrl ?? null,
    portfolioFileUrl: input.portfolioFileUrl ?? null,
    portfolioFileName: input.portfolioFileName ?? null,
    yearsOfExperience: input.yearsOfExperience ?? 0,
    englishProficiency: input.englishProficiency ?? null,
    currentSalaryPHP: input.currentSalaryPHP ?? null,
    currentSalaryUSD: input.currentSalaryUSD ?? null,
    reasonForLeaving: input.reasonForLeaving ?? null,
    cityOfResidence: input.cityOfResidence ?? null,
    parsedData: input.parsedData ?? null,
    source: input.source,
    tags: input.tags ? input.tags.map(t => new mongoose.Types.ObjectId(t)) : [],
    status,
    createdBy: createdBy ? new mongoose.Types.ObjectId(createdBy) : null,
  });

  // Trigger AI resume parsing in background only when parsedData wasn't already
  // supplied by the caller (avoids overwriting reviewed data with a re-parse).
  if (
    !input.parsedData &&
    candidate.resumeRawText &&
    candidate.resumeRawText.trim() !== ''
  ) {
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
    const currentTags = candidate.tags.map(String).sort().join(',');
    const nextTags = [...input.tags].map(String).sort().join(',');
    if (currentTags !== nextTags) changes.push('Tags updated');
    candidate.tags = input.tags.map(
      t => new mongoose.Types.ObjectId(t)
    ) as unknown as mongoose.Types.ObjectId[];
  }
  if (input.parsedData !== undefined) {
    if (
      JSON.stringify(candidate.parsedData ?? null) !==
      JSON.stringify(input.parsedData ?? null)
    ) {
      changes.push('Profile data updated');
    }
    candidate.parsedData = input.parsedData;
    candidate.markModified('parsedData');
  }
  if (input.appliedJobId !== undefined) {
    if (String(candidate.appliedJobId ?? '') !== String(input.appliedJobId ?? '')) {
      changes.push('Applied job updated');
    }
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

  // An update that changed nothing is not an event worth a timeline row.
  if (changes.length > 0) {
    createLog({
      action: 'updated',
      resourceType: 'candidate',
      resourceId: id,
      metadata: { changes },
      performedBy: updatedBy,
    });
  }

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

  // Permanent deletion is only allowed from the Ineligible list.
  // Everywhere else a candidate is closed out by rejecting them, never deleted,
  // so their history stays intact. This mirrors the UI, which only exposes
  // Delete on the Ineligible page.
  if (candidate.eligibilityStatus !== 'permanently_ineligible') {
    throw new AppError(
      409,
      'CANDIDATE_NOT_INELIGIBLE',
      'Candidates can only be permanently deleted from the Ineligible list. Reject the candidate instead.'
    );
  }

  // Permanently ineligible — only admins
  if (!isAdmin) {
    throw new AppError(
      403,
      'CANDIDATE_PERMANENTLY_INELIGIBLE',
      'Only an administrator can delete a permanently ineligible candidate'
    );
  }

  if (candidate.resumeUrl) {
    const publicId = extractCloudinaryPublicId(candidate.resumeUrl, 'raw');
    if (publicId) await deleteFromCloudinary(publicId, 'raw');
  }

  if (candidate.portfolioFileUrl) {
    const publicId = extractCloudinaryPublicId(
      candidate.portfolioFileUrl,
      'raw'
    );
    if (publicId) await deleteFromCloudinary(publicId, 'raw');
  }

  if (candidate.avatar) {
    const publicId = extractCloudinaryPublicId(candidate.avatar, 'image');
    if (publicId) await deleteFromCloudinary(publicId, 'image');
  }

  // ── Delete every record that references this candidate ──
  // The confirmation dialog tells the user this erases "applications,
  // interviews, emails, and history", so each of these must actually go —
  // leaving them behind orphans rows that point at a candidate that no longer
  // exists, and breaks any report that resolves a candidate by id.
  //
  // Activity logs are included on purpose: they are the "history" the dialog
  // names, and they are keyed by resourceId/relatedId, so they would otherwise
  // survive as unreachable records.
  const relatedDeletions: { label: string; run: () => Promise<number> }[] = [
    {
      label: 'application',
      run: async () =>
        (await Application.deleteMany({ candidateId: id })).deletedCount ?? 0,
    },
    {
      label: 'interview',
      run: async () =>
        (await Interview.deleteMany({ candidateId: id })).deletedCount ?? 0,
    },
    {
      label: 'interview scorecard',
      run: async () =>
        (await InterviewScorecard.deleteMany({ candidateId: id }))
          .deletedCount ?? 0,
    },
    {
      label: 'assignment',
      run: async () =>
        (await Assignment.deleteMany({ candidateId: id })).deletedCount ?? 0,
    },
    {
      label: 'work entry',
      run: async () =>
        (await WorkEntry.deleteMany({ candidateId: id })).deletedCount ?? 0,
    },
    {
      label: 'EOD submission',
      run: async () =>
        (await EodSubmission.deleteMany({ candidateId: id })).deletedCount ?? 0,
    },
    {
      label: 'EOD reminder',
      run: async () =>
        (await EodReminder.deleteMany({ candidateId: id })).deletedCount ?? 0,
    },
    {
      label: 'performance review',
      run: async () =>
        (await PerformanceReview.deleteMany({ candidateId: id }))
          .deletedCount ?? 0,
    },
    {
      label: 'email',
      run: async () =>
        (await Email.deleteMany({ 'context.candidateId': id })).deletedCount ??
        0,
    },
    {
      label: 'activity log',
      run: async () =>
        (
          await ActivityLog.deleteMany({
            $or: [
              { resourceType: 'candidate', resourceId: id },
              { relatedType: 'candidate', relatedId: id },
            ],
          })
        ).deletedCount ?? 0,
    },
  ];

  for (const { label, run } of relatedDeletions) {
    const count = await run();
    if (count > 0) {
      logger.info(`Deleted ${count} ${label}(s) for candidate ${id}`);
    }
  }

  await candidate.deleteOne();

  // Logged after the purge above would have removed it, so this entry is
  // written last and deliberately left in place as the tombstone for the
  // deletion itself.
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

/**
 * Candidate-level reject — used from the "In Review" tab.
 *
 * A candidate sitting In Review normally has NO application: a public apply
 * only creates the candidate, and the application is created later, at
 * approval. So this closes the candidate out directly via the talent-pool /
 * eligibility flags, which is what removes them from In Review.
 *
 * It deliberately refuses when the candidate holds a live application. In that
 * case they are really a pipeline candidate, and applying a destination here
 * would ban or pool them platform-wide — silently destroying every other job's
 * pipeline. Callers must use the application-level reject instead, which knows
 * how to remove them from a single job.
 */
export const rejectCandidate = async (
  id: string,
  input: {
    rejectionReasonId: string;
    destination?: 'candidate_pool' | 'permanently_ineligible';
    internalNotes?: string;
  },
  performedBy: string
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  if (candidate.status !== 'pending') {
    throw new AppError(
      400,
      'CANDIDATE_NOT_PENDING',
      'Only candidates still in review can be rejected here'
    );
  }

  if (candidate.eligibilityStatus === 'permanently_ineligible') {
    throw new AppError(
      400,
      'CANDIDATE_ALREADY_INELIGIBLE',
      'This candidate is already permanently ineligible'
    );
  }

  const reason = await DispositionReason.findById(input.rejectionReasonId);
  if (!reason)
    throw new AppError(
      404,
      'DISPOSITION_REASON_NOT_FOUND',
      'Rejection reason not found'
    );
  if (!reason.isActive)
    throw new AppError(
      400,
      'DISPOSITION_REASON_INACTIVE',
      'This rejection reason is no longer active'
    );

  if (
    reason.requireInternalNotes &&
    (!input.internalNotes || input.internalNotes.trim() === '')
  ) {
    throw new AppError(
      422,
      'INTERNAL_NOTES_REQUIRED',
      'Internal notes are required for this rejection reason'
    );
  }

  // A reason in the permanently-ineligible category always wins.
  const destination =
    reason.defaultEligibility === 'permanently_ineligible'
      ? 'permanently_ineligible'
      : (input.destination ?? 'candidate_pool');

  const now = new Date();
  const performedById = new mongoose.Types.ObjectId(performedBy);
  const reasonId = new mongoose.Types.ObjectId(input.rejectionReasonId);

  // This endpoint exists for candidates who hold no application — the normal
  // In Review case. If they DO hold a live application, they are really a
  // pipeline candidate: closing their applications here would apply the
  // destination (ban / talent pool) platform-wide and silently destroy every
  // other job's pipeline. Refuse, and send the caller to the application-level
  // reject, which knows how to remove them from one job only.
  const liveApplicationCount = await Application.countDocuments({
    candidateId: id,
    phase: { $in: ['pending', 'approved'] },
  });

  if (liveApplicationCount > 0) {
    throw new AppError(
      409,
      'CANDIDATE_HAS_ACTIVE_APPLICATION',
      'This candidate still has an active application. Reject them from the pipeline so only that job is affected.'
    );
  }

  if (destination === 'permanently_ineligible') {
    candidate.eligibilityStatus = 'permanently_ineligible';
    candidate.permanentlyIneligibleAt = now;
    candidate.permanentlyIneligibleBy = performedById;
    candidate.permanentlyIneligibleReason = reasonId;
    // A banned candidate is never also in the talent pool.
    candidate.inTalentPool = false;
    candidate.talentPoolAddedAt = null;
    candidate.talentPoolNotes = null;
  } else {
    candidate.inTalentPool = true;
    candidate.talentPoolAddedAt = now;
    candidate.talentPoolNotes = input.internalNotes ?? null;
  }

  await candidate.save();

  createLog({
    action: 'rejected',
    resourceType: 'candidate',
    resourceId: id,
    metadata: {
      reason: reason.label,
      reasonId: input.rejectionReasonId,
      destination,
      internalNotes: input.internalNotes ?? null,
    },
    performedBy,
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

  // A no-op transition must not be logged. Callers mirror an application's
  // phase onto the candidate without first checking the current status, which
  // produced noise like "changed the candidate status from approved to
  // approved" in the timeline.
  if (previousStatus === status) {
    return candidate.toSafeObject();
  }

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

  // The AI result lands asynchronously (a background job), so without this emit
  // no open client learns about it. Same shape as every other candidate write
  // here, so the UI's `candidate:updated` handler can patch it in place.
  const result = candidate.toSafeObject();
  emitToAts('candidates', 'candidate:updated', result);
  return result;
};

/**
 * Point the candidate's job reference at a different job.
 *
 * Used by the composite change-job flow: the old application is closed and a
 * new one created, so the candidate's own job pointer must follow. Applied
 * without touching status — the new application's phase already expresses it.
 */
export const updateAppliedJob = async (
  id: string,
  jobId: string,
  performedBy?: string | null
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  const previousJobId = candidate.appliedJobId
    ? String(candidate.appliedJobId)
    : null;
  candidate.appliedJobId = new mongoose.Types.ObjectId(jobId);
  await candidate.save();

  createLog({
    action: 'updated',
    resourceType: 'candidate',
    resourceId: id,
    metadata: { from: previousJobId, to: jobId, movedJob: true },
    performedBy: performedBy ?? null,
  });

  const result = candidate.toSafeObject();
  emitToAts('candidates', 'candidate:updated', result);
  return result;
};

/**
 * Restore a permanently ineligible candidate.
 *
 * The candidate always needs a job and returns to **In Review** as a normal
 * pending candidate — exactly like a fresh public applicant. No application is
 * created here: applications are created at approval, so creating one now would
 * collide with the unique (candidateId, jobId) index when the candidate is
 * later approved.
 */
export const restoreCandidate = async (
  id: string,
  jobId: string,
  performedBy: string
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  if (candidate.eligibilityStatus !== 'permanently_ineligible') {
    throw new AppError(
      400,
      'CANDIDATE_NOT_INELIGIBLE',
      'Only a permanently ineligible candidate can be restored'
    );
  }

  // The (candidateId, jobId) index on Application is unique regardless of
  // phase, so a closed application for the chosen job would block the approval
  // that follows restore — the recruiter would hit an "already applied" 409
  // with no way forward. Refuse up front and point at a usable job instead of
  // allowing the candidate into a dead end.
  const existingApplication = await Application.findOne({
    candidateId: id,
    jobId,
  });

  if (existingApplication) {
    throw new AppError(
      409,
      'JOB_ALREADY_HAS_APPLICATION',
      'This candidate already has a closed application for the selected job, which would block approval. Choose a different job.'
    );
  }

  candidate.eligibilityStatus = 'eligible';
  candidate.permanentlyIneligibleAt = null;
  candidate.permanentlyIneligibleBy = null;
  candidate.permanentlyIneligibleReason = null;

  // Send them back through the normal review flow for the chosen job.
  candidate.appliedJobId = new mongoose.Types.ObjectId(jobId);
  candidate.status = 'pending';

  // A restored candidate is not pooled — they are back in the active flow.
  candidate.inTalentPool = false;
  candidate.talentPoolAddedAt = null;
  candidate.talentPoolNotes = null;

  await candidate.save();

  createLog({
    action: 'eligibility_changed',
    resourceType: 'candidate',
    resourceId: id,
    metadata: {
      from: 'permanently_ineligible',
      to: 'eligible',
      jobId,
      restored: true,
    },
    performedBy,
  });

  const result = candidate.toSafeObject();
  emitToAts('candidates', 'candidate:updated', result);
  return result;
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
