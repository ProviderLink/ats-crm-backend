import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as templateService from './pipelineTemplate.service';

export const getAllTemplates = catchAsync(
  async (req: Request, res: Response) => {
    const { isActive: isActiveRaw } = req.query as Record<
      string,
      string | undefined
    >;
    const isActive =
      isActiveRaw === 'true'
        ? true
        : isActiveRaw === 'false'
          ? false
          : undefined;
    const templates = await templateService.getAllTemplates({ isActive });
    sendSuccess(res, templates, 'Pipeline templates retrieved', 200);
  }
);

export const getTemplateById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const template = await templateService.getTemplateById(id);
    sendSuccess(res, template, 'Pipeline template retrieved', 200);
  }
);

export const createTemplate = catchAsync(
  async (req: Request, res: Response) => {
    const body = req.body;
    const createdBy = req.user!._id;
    const template = await templateService.createTemplate(body, createdBy);
    sendSuccess(res, template, 'Pipeline template created', 201);
  }
);

export const updateTemplate = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;
    const updatedBy = req.user!._id;
    const template = await templateService.updateTemplate(id, body, updatedBy);
    sendSuccess(res, template, 'Pipeline template updated', 200);
  }
);

export const deleteTemplate = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await templateService.deleteTemplate(id, req.user!._id);
    sendSuccess(res, { deleted: true }, 'Pipeline template deleted', 200);
  }
);
