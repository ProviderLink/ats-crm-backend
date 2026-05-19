import { Router } from 'express';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requireRoles,
} from '../../shared/middleware/authorize';
import {
  exportEodSubmissions,
  exportPerformance,
  exportWorkEntries,
} from './reports.controller';

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('crm'));

router.get(
  '/work-entries/export',
  requireRoles('admin', 'account_manager'),
  exportWorkEntries
);
router.get(
  '/eod-submissions/export',
  requireRoles('admin', 'account_manager'),
  exportEodSubmissions
);
router.get(
  '/performance/export',
  requireRoles('admin', 'account_manager'),
  exportPerformance
);

export default router;
