import type { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as tagService from './tag.service';

export const getAllTags = catchAsync(async (_req: Request, res: Response) => {
  const tags = await tagService.getAllTags();
  sendSuccess(res, tags, 'Tags retrieved', 200);
});

export const createTag = catchAsync(async (req: Request, res: Response) => {
  const tag = await tagService.createTag(req.body, req.user!._id);
  sendSuccess(res, tag, 'Tag created', 201);
});

export const updateTag = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const tag = await tagService.updateTag(id, req.body, req.user!._id);
  sendSuccess(res, tag, 'Tag updated', 200);
});

export const deleteTag = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  await tagService.deleteTag(id, req.user!._id);
  sendSuccess(res, { deleted: true }, 'Tag deleted', 200);
});
