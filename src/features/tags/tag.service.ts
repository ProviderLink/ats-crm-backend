import AppError from '../../shared/utils/AppError';
import { emitToAts } from '../../sockets';
import { createLog } from '../activity-logs/activityLog.service';
import Tag from './tag.model';
import type { CreateTagInput, ITag, UpdateTagInput } from './tag.types';

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getAllTags = async (): Promise<ITag[]> => {
  const tags = await Tag.find().sort({ name: 1 });
  return tags.map(t => t.toSafeObject());
};

export const createTag = async (
  input: CreateTagInput,
  createdBy: string
): Promise<ITag> => {
  const existing = await Tag.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(input.name)}$`, 'i') },
  });
  if (existing) {
    throw new AppError(
      409,
      'TAG_ALREADY_EXISTS',
      'A tag with this name already exists'
    );
  }
  const tag = new Tag({ ...input, createdBy });
  await tag.save();

  createLog({
    action: 'created',
    resourceType: 'tag',
    resourceId: tag._id.toString(),
    performedBy: createdBy,
  });

  const result = tag.toSafeObject();
  emitToAts('tags', 'tag:created', result);
  return result;
};

export const updateTag = async (
  id: string,
  input: UpdateTagInput,
  updatedBy?: string | null
): Promise<ITag> => {
  const tag = await Tag.findById(id);
  if (!tag) {
    throw new AppError(404, 'TAG_NOT_FOUND', 'Tag not found');
  }
  if (input.name) {
    const duplicate = await Tag.findOne({
      _id: { $ne: id },
      name: { $regex: new RegExp(`^${escapeRegex(input.name)}$`, 'i') },
    });
    if (duplicate) {
      throw new AppError(
        409,
        'TAG_ALREADY_EXISTS',
        'A tag with this name already exists'
      );
    }
  }
  if (input.name !== undefined) tag.name = input.name;
  if (input.color !== undefined) tag.color = input.color;
  await tag.save();

  createLog({
    action: 'updated',
    resourceType: 'tag',
    resourceId: id,
    performedBy: updatedBy ?? null,
  });

  const result = tag.toSafeObject();
  emitToAts('tags', 'tag:updated', result);
  return result;
};

export const deleteTag = async (
  id: string,
  deletedBy?: string | null
): Promise<{ deleted: boolean }> => {
  const tag = await Tag.findById(id);
  if (!tag) {
    throw new AppError(404, 'TAG_NOT_FOUND', 'Tag not found');
  }
  await tag.deleteOne();

  createLog({
    action: 'deleted',
    resourceType: 'tag',
    resourceId: id,
    performedBy: deletedBy ?? null,
  });

  emitToAts('tags', 'tag:deleted', { _id: id });
  return { deleted: true };
};
