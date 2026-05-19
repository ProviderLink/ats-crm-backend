import { Router } from 'express';
import authenticate from '../../../shared/middleware/authenticate';
import { requireRoles } from '../../../shared/middleware/authorize';
import { getDashboard } from './atsDashboard.controller';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  requireRoles('admin', 'hiring_manager', 'recruiter', 'coordinator'),
  getDashboard
);

export default router;
