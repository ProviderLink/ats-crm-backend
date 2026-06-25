import { Router } from 'express';
import authenticate from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/authorize';
import { getAllLogs, getResourceLogs } from './activityLog.controller';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('activityLogs', 'read'), getAllLogs);

router.get(
  '/:resourceType/:resourceId',
  requirePermission('activityLogs', 'read'),
  getResourceLogs
);

export default router;
