import { Router } from 'express';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requireRoles,
} from '../../shared/middleware/authorize';
import * as eodReminderController from './eodReminder.controller';

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('crm'));

router.get(
  '/',
  requireRoles('admin', 'account_manager'),
  eodReminderController.getAllEodReminders
);

router.get(
  '/:id',
  requireRoles('admin', 'account_manager'),
  eodReminderController.getEodReminderById
);

export default router;
