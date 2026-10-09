import { Request, Response } from 'express';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { assertOwnsCandidate } from '../../shared/utils/crmScope';
import { sendSuccess } from '../../shared/utils/response';
import * as service from './vaProfile.service';

export const getAllVaProfiles = catchAsync(
  async (req: Request, res: Response) => {
    const { page, limit } = req.query as Record<string, string | undefined>;
    const result = await service.getAllVaProfiles({
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    sendSuccess(res, result.profiles, 'VA profiles retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);

export const getVaProfileById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    assertOwnsCandidate(req.user!, id);
    try {
      const profile = await service.getVaProfileById(id);
      sendSuccess(res, profile, 'VA profile retrieved', 200);
    } catch {
      throw new AppError(404, 'VA_PROFILE_NOT_FOUND', 'VA profile not found');
    }
  }
);

export const upsertVaProfile = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const updatedBy = req.user!._id;
    const profile = await service.upsertVaProfile(id, req.body, updatedBy);
    sendSuccess(res, profile, 'VA profile updated', 200);
  }
);

export const listVaNotes = catchAsync(async (req: Request, res: Response) => {
  const { vaId } = req.params;
  const notes = await service.listVaNotes(vaId);
  sendSuccess(res, notes, 'VA notes retrieved', 200);
});

export const createVaNote = catchAsync(async (req: Request, res: Response) => {
  const { vaId } = req.params;
  const author = req.user!._id;
  const note = await service.addVaNote(vaId, req.body, author);
  sendSuccess(res, note, 'VA note created', 201);
});
