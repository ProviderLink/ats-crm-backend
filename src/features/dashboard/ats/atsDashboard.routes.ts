import { Router } from 'express';
import authenticate from '../../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../../shared/middleware/authorize';
import { getDashboard, getMetrics } from './atsDashboard.controller';

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('ats'));

router.get('/', requirePermission('dashboard', 'read'), getDashboard);
router.get('/metrics', requirePermission('dashboard', 'read'), getMetrics);

export default router;
