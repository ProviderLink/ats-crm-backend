import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requireRoles,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import * as surveyReminderController from './surveyReminder.controller';

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('crm'));

const createSurveyReminderSchema = z.object({
  relatedType: z.enum(['client', 'va', 'assignment']),
  relatedId: z.string(),
  surveyType: z.enum([
    '3_day',
    '1_week',
    '30_day',
    '60_day',
    '90_day',
    'monthly',
  ]),
  dueDate: z.string().datetime(),
  assignedTo: z.string(),
});

const updateSurveyReminderSchema = z.object({
  status: z.enum(['pending', 'sent', 'completed', 'skipped']).optional(),
  completedDate: z.string().datetime().optional().nullable(),
  dueDate: z.string().datetime().optional(),
  assignedTo: z.string().optional(),
});

router.get(
  '/',
  requireRoles('admin', 'account_manager'),
  surveyReminderController.getAllSurveyReminders
);

router.post(
  '/',
  requireRoles('admin', 'account_manager'),
  validate(createSurveyReminderSchema),
  surveyReminderController.createSurveyReminder
);

router.get(
  '/:id',
  requireRoles('admin', 'account_manager'),
  surveyReminderController.getSurveyReminderById
);

router.patch(
  '/:id',
  requireRoles('admin', 'account_manager'),
  validate(updateSurveyReminderSchema),
  surveyReminderController.updateSurveyReminder
);

export default router;
