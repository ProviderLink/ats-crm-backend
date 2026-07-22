import { Router } from 'express';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requireRoles,
} from '../../shared/middleware/authorize';
import * as scorecardController from './scorecard.controller';

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('crm'));

router.get(
  '/',
  requireRoles('admin', 'account_manager'),
  scorecardController.getAllScorecards
);

router.get(
  '/:id',
  requireRoles('admin', 'account_manager'),
  scorecardController.getScorecardById
);

router.post(
  '/generate',
  requireRoles('admin', 'account_manager'),
  scorecardController.generateScorecards
);

export default router;
