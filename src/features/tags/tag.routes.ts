import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
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
router.use(requireAppAccess('ats'));

router.get('/', requirePermission('tags', 'read'), tagController.getAllTags);

router.post(
  '/',
  requirePermission('tags', 'write'),
  validate(createTagSchema),
  tagController.createTag
);

router.patch(
  '/:id',
  requirePermission('tags', 'write'),
  validate(updateTagSchema),
  tagController.updateTag
);

router.delete(
  '/:id',
  requirePermission('tags', 'manage'),
  tagController.deleteTag
);

export default router;
