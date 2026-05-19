import AppError from '../../shared/utils/AppError';
import EmailTemplate from './emailTemplate.model';
import type {
  CreateEmailTemplateInput,
  IEmailTemplate,
  UpdateEmailTemplateInput,
} from './emailTemplate.types';

export const getAllTemplates = async (filters: {
  type?: string;
  isActive?: boolean;
}): Promise<IEmailTemplate[]> => {
  const query: Record<string, unknown> = {};
  if (filters.type !== undefined) query['type'] = filters.type;
  if (filters.isActive !== undefined) query['isActive'] = filters.isActive;
  const templates = await EmailTemplate.find(query).sort({ createdAt: -1 });
  return templates.map(t => t.toSafeObject());
};

export const getTemplateById = async (id: string): Promise<IEmailTemplate> => {
  const template = await EmailTemplate.findById(id);
  if (!template) {
    throw new AppError(
      404,
      'EMAIL_TEMPLATE_NOT_FOUND',
      'Email template not found'
    );
  }
  return template.toSafeObject();
};

export const createTemplate = async (
  input: CreateEmailTemplateInput,
  createdBy: string
): Promise<IEmailTemplate> => {
  if (input.isDefault) {
    await EmailTemplate.updateMany({ type: input.type }, { isDefault: false });
  }
  const template = new EmailTemplate({ ...input, createdBy });
  await template.save();
  return template.toSafeObject();
};

export const updateTemplate = async (
  id: string,
  input: UpdateEmailTemplateInput,
  updatedBy: string
): Promise<IEmailTemplate> => {
  const template = await EmailTemplate.findById(id);
  if (!template) {
    throw new AppError(
      404,
      'EMAIL_TEMPLATE_NOT_FOUND',
      'Email template not found'
    );
  }
  if (input.isDefault) {
    await EmailTemplate.updateMany(
      { type: template.type, _id: { $ne: id } },
      { isDefault: false }
    );
  }
  if (input.name !== undefined) template.name = input.name;
  if (input.subject !== undefined) template.subject = input.subject;
  if (input.bodyHtml !== undefined) template.bodyHtml = input.bodyHtml;
  if (input.bodyText !== undefined) template.bodyText = input.bodyText;
  if (input.type !== undefined) template.type = input.type;
  if (input.variables !== undefined) template.variables = input.variables;
  if (input.isDefault !== undefined) template.isDefault = input.isDefault;
  if (input.isActive !== undefined) template.isActive = input.isActive;
  template.updatedBy = updatedBy as unknown as typeof template.updatedBy;
  await template.save();
  return template.toSafeObject();
};

export const deleteTemplate = async (
  id: string
): Promise<{ deleted: boolean }> => {
  const template = await EmailTemplate.findById(id);
  if (!template) {
    throw new AppError(
      404,
      'EMAIL_TEMPLATE_NOT_FOUND',
      'Email template not found'
    );
  }
  await template.deleteOne();
  return { deleted: true };
};
