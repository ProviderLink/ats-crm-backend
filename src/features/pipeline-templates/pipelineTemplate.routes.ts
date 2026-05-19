import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import { requireRoles } from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import { PIPELINE_STAGE_ICONS } from './pipelineTemplate.types';
import {
  createTemplate,
  deleteTemplate,
  getAllTemplates,
  getTemplateById,
  updateTemplate,
} from './pipelineTemplate.controller';

const router = Router();

const stageSchema = z.object({
  name: z.string().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .default('#3b82f6'),
  order: z.number().int().min(1),
  isActive: z.boolean().optional().default(true),
  icon: z.enum(PIPELINE_STAGE_ICONS).optional().default('ClipboardList'),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional().default(''),
  isDefault: z.boolean().optional().default(false),
  stages: z.array(stageSchema).min(1),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  stages: z.array(stageSchema).min(1).optional(),
});

router.use(authenticate);

router.get(
  '/',
  requireRoles('admin', 'hiring_manager', 'recruiter', 'coordinator'),
  getAllTemplates
);

router.post(
  '/',
  requireRoles('admin'),
  validate(createTemplateSchema),
  createTemplate
);

router.get(
  '/:id',
  requireRoles('admin', 'hiring_manager', 'recruiter', 'coordinator'),
  getTemplateById
);

router.patch(
  '/:id',
  requireRoles('admin'),
  validate(updateTemplateSchema),
  updateTemplate
);

router.delete('/:id', requireRoles('admin'), deleteTemplate);

export default router;
