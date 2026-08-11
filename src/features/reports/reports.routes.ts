import { Router } from 'express';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requireRoles,
} from '../../shared/middleware/authorize';
import {
  exportDispositions,
  exportEodSubmissions,
  exportPerformance,
  exportWorkEntries,
} from './reports.controller';

const router = Router();

router.use(authenticate);

// ── CRM reports (mounted at /api/v1/crm/reports) ──
// Each CRM route self-gates; no router-level CRM middleware so ATS sub-routes
// are not polluted when this router is also mounted at /api/v1/reports.

router.get(
  '/work-entries/export',
  requireAppAccess('crm'),
  requireRoles('admin', 'account_manager'),
  exportWorkEntries
);
router.get(
  '/eod-submissions/export',
  requireAppAccess('crm'),
  requireRoles('admin', 'account_manager'),
  exportEodSubmissions
);
router.get(
  '/performance/export',
  requireAppAccess('crm'),
  requireRoles('admin', 'account_manager'),
  exportPerformance
);

// ── ATS reports (mounted at /api/v1/reports/ats) ──
const atsRouter = Router();
atsRouter.use(requireAppAccess('ats'));

atsRouter.get(
  '/dispositions/export',
  requireRoles('admin', 'account_manager'),
  exportDispositions
);

router.use('/ats', atsRouter);

export default router;
