import AppError from '../../shared/utils/AppError';
import { emitToAts } from '../../sockets';
import { createLog } from '../activity-logs/activityLog.service';
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
    const unDefaulted = await EmailTemplate.find({
      type: input.type,
      isDefault: true,
    });
    await EmailTemplate.updateMany(
      { type: input.type, isDefault: true },
      { isDefault: false }
    );
    for (const t of unDefaulted) {
      emitToAts('email-templates', 'email_template:updated', {
        ...t.toSafeObject(),
        isDefault: false,
      });
    }
  }
  const template = new EmailTemplate({ ...input, createdBy });
  await template.save();
  const result = template.toSafeObject();
  createLog({
    action: 'created',
    resourceType: 'email_template',
    resourceId: result._id,
    metadata: { name: result.name, type: result.type },
    performedBy: createdBy,
  });
  emitToAts('email-templates', 'email_template:created', result);
  return result;
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
    // Use the NEW type if it's being changed, so we un-default the right group.
    const effectiveType = input.type ?? template.type;
    const unDefaulted = await EmailTemplate.find({
      type: effectiveType,
      isDefault: true,
      _id: { $ne: id },
    });
    await EmailTemplate.updateMany(
      { type: effectiveType, isDefault: true, _id: { $ne: id } },
      { isDefault: false }
    );
    for (const t of unDefaulted) {
      emitToAts('email-templates', 'email_template:updated', {
        ...t.toSafeObject(),
        isDefault: false,
      });
    }
  }
  const changes: string[] = [];
  if (input.name !== undefined && input.name !== template.name) {
    changes.push(`Name changed from "${template.name}" to "${input.name}"`);
  }
  if (input.subject !== undefined && input.subject !== template.subject) {
    changes.push('Subject updated');
  }
  if (
    (input.bodyHtml !== undefined && input.bodyHtml !== template.bodyHtml) ||
    (input.bodyText !== undefined && input.bodyText !== template.bodyText)
  ) {
    changes.push('Body updated');
  }
  if (input.type !== undefined && input.type !== template.type) {
    changes.push(`Type changed from "${template.type}" to "${input.type}"`);
  }
  if (input.isDefault !== undefined && input.isDefault !== template.isDefault) {
    changes.push(input.isDefault ? 'Set as default' : 'Removed as default');
  }
  if (input.isActive !== undefined && input.isActive !== template.isActive) {
    changes.push(input.isActive ? 'Activated' : 'Deactivated');
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
  const result = template.toSafeObject();
  if (changes.length > 0) {
    createLog({
      action: 'updated',
      resourceType: 'email_template',
      resourceId: id,
      metadata: { name: result.name, changes },
      performedBy: updatedBy,
    });
  }
  emitToAts('email-templates', 'email_template:updated', result);
  return result;
};

export const deleteTemplate = async (
  id: string,
  deletedBy?: string | null
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
  createLog({
    action: 'deleted',
    resourceType: 'email_template',
    resourceId: id,
    metadata: { name: template.name },
    performedBy: deletedBy ?? null,
  });
  emitToAts('email-templates', 'email_template:deleted', { _id: id });
  return { deleted: true };
};
