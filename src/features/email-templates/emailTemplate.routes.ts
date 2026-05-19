import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import { requireRoles } from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import * as templateController from './emailTemplate.controller';

const router = Router();

const SYSTEM_VARIABLES_ENUM = z.enum([
  'candidateName',
  'candidateEmail',
  'jobTitle',
  'clientName',
  'interviewDate',
  'interviewTime',
  'interviewType',
  'meetingLink',
  'interviewerName',
  'companyName',
  'senderName',
]);

const TEMPLATE_TYPE_ENUM = z.enum([
  'interview',
  'offer',
  'rejection',
  'follow_up',
  'eod_reminder',
  'survey_reminder',
  'general',
]);

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  subject: z.string().min(1).max(200),
  bodyHtml: z.string().min(1),
  bodyText: z.string().min(1),
  type: TEMPLATE_TYPE_ENUM,
  variables: z.array(SYSTEM_VARIABLES_ENUM).optional(),
  isDefault: z.boolean().optional(),
});

const updateTemplateSchema = createTemplateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

router.use(authenticate);

router.get(
  '/',
  requireRoles('admin', 'hiring_manager', 'recruiter', 'coordinator'),
  templateController.getAllTemplates
);

router.post(
  '/',
  requireRoles('admin'),
  validate(createTemplateSchema),
  templateController.createTemplate
);

router.get(
  '/:id',
  requireRoles('admin', 'hiring_manager', 'recruiter', 'coordinator'),
  templateController.getTemplateById
);

router.patch(
  '/:id',
  requireRoles('admin'),
  validate(updateTemplateSchema),
  templateController.updateTemplate
);

router.delete('/:id', requireRoles('admin'), templateController.deleteTemplate);

export default router;
