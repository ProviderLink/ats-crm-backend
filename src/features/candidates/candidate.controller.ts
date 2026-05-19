import { Request, Response } from 'express';
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from '../../config/cloudinary';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
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
    const { url } = await uploadToCloudinary(req.file, 'resumes');
    const candidate = await candidateService.createCandidate(
      {
        ...body,
        resumeUrl: url,
        resumeOriginalName: req.file.originalname,
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
  sendSuccess(
    res,
    { candidateId: id, jobId, assigned: true },
    'Candidate assigned to job',
    200
  );
});
