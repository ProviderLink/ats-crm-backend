import { Router } from 'express';
import authenticate from '../../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requireRoles,
} from '../../../shared/middleware/authorize';
import { getDashboard } from './crmDashboard.controller';

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('crm'));

router.get('/', requireRoles('admin', 'account_manager'), getDashboard);

export default router;
