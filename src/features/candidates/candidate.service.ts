import mongoose from 'mongoose';
import { deleteFromCloudinary } from '../../config/cloudinary';
import { runResumeParsing } from '../../jobs';
import { AppError } from '../../shared/utils/AppError';
import Candidate from './candidate.model';
import type {
  CreateCandidateInput,
  ICandidate,
  ICandidateAiScore,
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
}): Promise<{
  candidates: ICandidate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { status, inTalentPool, search, tags, page = 1, limit = 20 } = filters;
  const query: Record<string, unknown> = {};

  if (status !== undefined) query['status'] = status;
  if (inTalentPool !== undefined) query['inTalentPool'] = inTalentPool;
  if (tags !== undefined && tags.length > 0) query['tags'] = { $in: tags };
  if (search !== undefined && search.trim() !== '')
    query['$text'] = { $search: search };

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
    phone: input.phone,
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

  return candidate.toSafeObject();
};

export const updateCandidate = async (
  id: string,
  input: UpdateCandidateInput,
  updatedBy: string | null
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  if (input.firstName !== undefined) candidate.firstName = input.firstName;
  if (input.lastName !== undefined) candidate.lastName = input.lastName;
  if (input.phone !== undefined) candidate.phone = input.phone;
  if (input.avatar !== undefined) candidate.avatar = input.avatar;
  if (input.videoIntroUrl !== undefined)
    candidate.videoIntroUrl = input.videoIntroUrl;
  if (input.videoIntroSource !== undefined)
    candidate.videoIntroSource = input.videoIntroSource;
  if (input.yearsOfExperience !== undefined)
    candidate.yearsOfExperience = input.yearsOfExperience;
  if (input.englishProficiency !== undefined)
    candidate.englishProficiency = input.englishProficiency;
  if (input.currentSalaryPHP !== undefined)
    candidate.currentSalaryPHP = input.currentSalaryPHP;
  if (input.currentSalaryUSD !== undefined)
    candidate.currentSalaryUSD = input.currentSalaryUSD;
  if (input.reasonForLeaving !== undefined)
    candidate.reasonForLeaving = input.reasonForLeaving;
  if (input.cityOfResidence !== undefined)
    candidate.cityOfResidence = input.cityOfResidence;
  if (input.tags !== undefined)
    candidate.tags = input.tags.map(
      t => new mongoose.Types.ObjectId(t)
    ) as unknown as mongoose.Types.ObjectId[];
  if (input.parsedData !== undefined) {
    candidate.parsedData = input.parsedData;
    candidate.markModified('parsedData');
  }

  candidate.updatedBy = updatedBy
    ? (new mongoose.Types.ObjectId(
        updatedBy
      ) as unknown as mongoose.Types.ObjectId)
    : null;

  await candidate.save();
  return candidate.toSafeObject();
};

export const deleteCandidate = async (
  id: string
): Promise<{ deleted: boolean }> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  if (candidate.resumeUrl) {
    const publicId = extractCloudinaryPublicId(candidate.resumeUrl);
    if (publicId) await deleteFromCloudinary(publicId, 'raw');
  }

  if (candidate.avatar) {
    const publicId = extractCloudinaryPublicId(candidate.avatar);
    if (publicId) await deleteFromCloudinary(publicId, 'image');
  }

  await candidate.deleteOne();
  return { deleted: true };
};

export const updateTalentPool = async (
  id: string,
  action: 'add' | 'remove',
  notes?: string
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
  return candidate.toSafeObject();
};

export const updateCandidateStatus = async (
  id: string,
  status: 'pending' | 'approved' | 'hired'
): Promise<ICandidate> => {
  const candidate = await Candidate.findById(id);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  candidate.status = status;
  await candidate.save();
  return candidate.toSafeObject();
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
  return candidate.toSafeObject();
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
  return candidate.toSafeObject();
};
