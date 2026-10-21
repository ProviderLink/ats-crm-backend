import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import * as templateController from './emailTemplate.controller';

const router = Router();

const SYSTEM_VARIABLES_ENUM = z.enum([
  'candidateName',
  'candidateEmail',
  'candidatePhone',
  'jobTitle',
  'clientName',
  'interviewDate',
  'interviewTime',
  'interviewType',
  'meetingLink',
  'interviewerName',
  'companyName',
  'currentStage',
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
  'application_confirmation',
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
router.use(requireAppAccess('ats'));

router.get(
  '/',
  requirePermission('emailTemplates', 'read'),
  templateController.getAllTemplates
);

router.post(
  '/',
  requirePermission('emailTemplates', 'write'),
  validate(createTemplateSchema),
  templateController.createTemplate
);

router.get(
  '/:id',
  requirePermission('emailTemplates', 'read'),
  templateController.getTemplateById
);

router.patch(
  '/:id',
  requirePermission('emailTemplates', 'write'),
  validate(updateTemplateSchema),
  templateController.updateTemplate
);

router.delete(
  '/:id',
  requirePermission('emailTemplates', 'write'),
  templateController.deleteTemplate
);

export default router;
