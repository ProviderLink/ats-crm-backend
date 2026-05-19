import { Router } from 'express';
import authenticate from '../../shared/middleware/authenticate';
import { requireRoles } from '../../shared/middleware/authorize';
import { getAllLogs, getResourceLogs } from './activityLog.controller';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  requireRoles(
    'admin',
    'hiring_manager',
    'recruiter',
    'coordinator',
    'account_manager'
  ),
  getAllLogs
);

router.get(
  '/:resourceType/:resourceId',
  requireRoles(
    'admin',
    'hiring_manager',
    'recruiter',
    'coordinator',
    'account_manager'
  ),
  getResourceLogs
);

export default router;
