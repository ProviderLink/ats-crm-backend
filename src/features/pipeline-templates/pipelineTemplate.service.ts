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

const DEFAULT_GUARD_ERROR_CODES = new Set([11000, 11001]);

// MongoDB's partial unique index on { isDefault: true } is the backstop that
// guarantees only ONE default can exist in the database, even under races.
// The application layer still clears prior defaults first for a clean UX, but
// if a concurrent write slips through, we translate the E11000 into a friendly
// AppError so the API client gets a useful message instead of a 500.
const handleDefaultGuardError = (err: unknown): never => {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    DEFAULT_GUARD_ERROR_CODES.has((err as { code: number }).code)
  ) {
    throw new AppError(
      409,
      'DEFAULT_TEMPLATE_EXISTS',
      'Another pipeline template is already marked as default. Only one default template is allowed.'
    );
  }
  throw err;
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
    // Reject rather than silently un-defaulting the existing default. Client
    // must first PATCH the current default with isDefault:false, then create
    // the new one as default. The DB-level partial unique index is the backstop.
    const existingDefault = await PipelineTemplate.findOne({ isDefault: true });
    if (existingDefault) {
      throw new AppError(
        409,
        'DEFAULT_TEMPLATE_EXISTS',
        `Another pipeline template ("${existingDefault.name}") is already marked as default. Set its isDefault to false first.`
      );
    }
  }
  let template;
  try {
    template = await PipelineTemplate.create({
      name: input.name,
      description: input.description ?? '',
      isDefault: input.isDefault ?? false,
      stages: input.stages,
      createdBy: new mongoose.Types.ObjectId(createdBy),
    });
  } catch (err) {
    handleDefaultGuardError(err);
  }
  return template!.toSafeObject();
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
  // Reject deactivating a template that is currently the default — new jobs
  // auto-assign the default, so doing so would silently leave new jobs with no
  // usable pipeline. The default must be transferred to another template first.
  if (
    input.isActive === false &&
    template.isDefault &&
    input.isDefault !== true
  ) {
    throw new AppError(
      400,
      'DEFAULT_REQUIRES_ACTIVE',
      'Cannot deactivate the default pipeline template. Assign default status to another active template first.'
    );
  }
  if (input.stages !== undefined) {
    validateStages(input.stages);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    template.stages = input.stages as any;
  }
  if (input.isDefault && !template.isDefault) {
    // Marking a non-default template as default. Reject if another default
    // already exists — the client must first PATCH the current default with
    // isDefault:false, then mark this one as default. The DB-level partial
    // unique index is the backstop.
    const existingDefault = await PipelineTemplate.findOne({
      isDefault: true,
      _id: { $ne: id },
    });
    if (existingDefault) {
      throw new AppError(
        409,
        'DEFAULT_TEMPLATE_EXISTS',
        `Another pipeline template ("${existingDefault.name}") is already marked as default. Set its isDefault to false first.`
      );
    }
    // A template must be active to be the default, otherwise new jobs would
    // auto-pick an inactive pipeline.
    const willBeActive =
      input.isActive !== undefined ? input.isActive : template.isActive;
    if (!willBeActive) {
      throw new AppError(
        400,
        'DEFAULT_REQUIRES_ACTIVE',
        'Only an active pipeline template can be marked as default'
      );
    }
  }
  if (input.name !== undefined) template.name = input.name;
  if (input.description !== undefined) template.description = input.description;
  if (input.isDefault !== undefined) template.isDefault = input.isDefault;
  if (input.isActive !== undefined) template.isActive = input.isActive;
  template.updatedBy = new mongoose.Types.ObjectId(updatedBy);
  try {
    await template.save();
  } catch (err) {
    handleDefaultGuardError(err);
  }
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
  if (template.isDefault) {
    // Deleting the default would leave new jobs with no auto-assigned pipeline.
    throw new AppError(
      400,
      'CANNOT_DELETE_DEFAULT',
      'Cannot delete the default pipeline template. Assign default status to another template first.'
    );
  }
  await template.deleteOne();
  return { deleted: true };
};
