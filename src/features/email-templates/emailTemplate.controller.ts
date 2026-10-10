import type { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as templateService from './emailTemplate.service';

export const getAllTemplates = catchAsync(
  async (req: Request, res: Response) => {
    const { type, isActive } = req.query;
    const filters: { type?: string; isActive?: boolean } = {};
    if (type !== undefined) filters.type = type as string;
    if (isActive !== undefined) filters.isActive = isActive === 'true';
    const templates = await templateService.getAllTemplates(filters);
    sendSuccess(res, templates, 'Email templates retrieved', 200);
  }
);

export const getTemplateById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const template = await templateService.getTemplateById(id);
    sendSuccess(res, template, 'Email template retrieved', 200);
  }
);

export const createTemplate = catchAsync(
  async (req: Request, res: Response) => {
    const template = await templateService.createTemplate(
      req.body,
      req.user!._id
    );
    sendSuccess(res, template, 'Email template created', 201);
  }
);

export const updateTemplate = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const template = await templateService.updateTemplate(
      id,
      req.body,
      req.user!._id
    );
    sendSuccess(res, template, 'Email template updated', 200);
  }
);

export const deleteTemplate = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await templateService.deleteTemplate(id, req.user!._id);
    sendSuccess(res, { deleted: true }, 'Email template deleted', 200);
  }
);
