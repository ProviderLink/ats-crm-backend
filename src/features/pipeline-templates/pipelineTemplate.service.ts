import mongoose from 'mongoose';
import { AppError } from '../../shared/utils/AppError';
import Job from '../jobs/job.model';
import PipelineTemplate from './pipelineTemplate.model';
import type {
  CreatePipelineTemplateInput,
  IPipelineTemplate,
  UpdatePipelineTemplateInput,
} from './pipelineTemplate.types';

const validateStages = (stages: { order: number }[]): void => {
  if (stages.length === 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Pipeline template must have at least one stage'
    );
  }
  const orders = stages.map(s => s.order);
  if (new Set(orders).size !== orders.length) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Stage order values must be unique'
    );
  }
};

export const getAllTemplates = async (filters: {
  isActive?: boolean;
}): Promise<IPipelineTemplate[]> => {
  const query: Record<string, unknown> = {};
  if (filters.isActive !== undefined) query['isActive'] = filters.isActive;
  const templates = await PipelineTemplate.find(query).sort({ createdAt: -1 });
  return templates.map(t => t.toSafeObject());
};

export const getTemplateById = async (
  id: string
): Promise<IPipelineTemplate> => {
  const template = await PipelineTemplate.findById(id);
  if (!template) {
    throw new AppError(
      404,
      'PIPELINE_TEMPLATE_NOT_FOUND',
      'Pipeline template not found'
    );
  }
  return template.toSafeObject();
};

export const createTemplate = async (
  input: CreatePipelineTemplateInput,
  createdBy: string
): Promise<IPipelineTemplate> => {
  validateStages(input.stages);
  if (input.isDefault) {
    await PipelineTemplate.updateMany({}, { isDefault: false });
  }
  const template = await PipelineTemplate.create({
    name: input.name,
    description: input.description ?? '',
    isDefault: input.isDefault ?? false,
    stages: input.stages,
    createdBy: new mongoose.Types.ObjectId(createdBy),
  });
  return template.toSafeObject();
};

export const updateTemplate = async (
  id: string,
  input: UpdatePipelineTemplateInput,
  updatedBy: string
): Promise<IPipelineTemplate> => {
  const template = await PipelineTemplate.findById(id);
  if (!template) {
    throw new AppError(
      404,
      'PIPELINE_TEMPLATE_NOT_FOUND',
      'Pipeline template not found'
    );
  }
  if (input.stages !== undefined) {
    validateStages(input.stages);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    template.stages = input.stages as any;
  }
  if (input.isDefault) {
    await PipelineTemplate.updateMany(
      { _id: { $ne: id } },
      { isDefault: false }
    );
  }
  if (input.name !== undefined) template.name = input.name;
  if (input.description !== undefined) template.description = input.description;
  if (input.isDefault !== undefined) template.isDefault = input.isDefault;
  if (input.isActive !== undefined) template.isActive = input.isActive;
  template.updatedBy = new mongoose.Types.ObjectId(updatedBy);
  await template.save();
  return template.toSafeObject();
};

export const deleteTemplate = async (
  id: string
): Promise<{ deleted: boolean }> => {
  const template = await PipelineTemplate.findById(id);
  if (!template) {
    throw new AppError(
      404,
      'PIPELINE_TEMPLATE_NOT_FOUND',
      'Pipeline template not found'
    );
  }
  const jobCount = await Job.countDocuments({
    'pipeline.templateId': id,
  });
  if (jobCount > 0) {
    throw new AppError(
      400,
      'TEMPLATE_IN_USE',
      'Cannot delete template that is in use by jobs'
    );
  }
  await template.deleteOne();
  return { deleted: true };
};
