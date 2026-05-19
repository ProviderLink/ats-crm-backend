import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import { requireRoles } from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import * as tagController from './tag.controller';

const router = Router();

const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color e.g. #3b82f6'),
});

const updateTagSchema = createTagSchema.partial();

router.use(authenticate);

router.get(
  '/',
  requireRoles(
    'admin',
    'hiring_manager',
    'recruiter',
    'coordinator',
    'interviewer'
  ),
  tagController.getAllTags
);

router.post(
  '/',
  requireRoles('admin', 'hiring_manager'),
  validate(createTagSchema),
  tagController.createTag
);

router.patch(
  '/:id',
  requireRoles('admin', 'hiring_manager'),
  validate(updateTagSchema),
  tagController.updateTag
);

router.delete('/:id', requireRoles('admin'), tagController.deleteTag);

export default router;
