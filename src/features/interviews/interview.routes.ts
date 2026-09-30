import { Router } from 'express';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import {
  cancelInterview,
  createInterview,
  getAllInterviews,
  getInterviewById,
  submitFeedback,
  updateInterview,
} from './interview.controller';
import {
  createInterviewSchema,
  feedbackSchema,
  updateInterviewSchema,
} from './interview.schemas';

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('ats'));

router.get('/', requirePermission('interviews', 'read'), getAllInterviews);

router.post(
  '/',
  requirePermission('interviews', 'write'),
  validate(createInterviewSchema),
  createInterview
);

router.get('/:id', requirePermission('interviews', 'read'), getInterviewById);

router.patch(
  '/:id',
  requirePermission('interviews', 'write'),
  validate(updateInterviewSchema),
  updateInterview
);

router.delete(
  '/:id',
  requirePermission('interviews', 'write'),
  cancelInterview
);

router.post(
  '/:id/feedback',
  requirePermission('interviews', 'write'),
  validate(feedbackSchema),
  submitFeedback
);

export default router;
