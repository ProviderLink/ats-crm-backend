import { Router } from 'express';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import {
  cancelExternalMeeting,
  createExternalMeeting,
  getAllExternalMeetings,
  getExternalMeetingById,
  updateExternalMeeting,
} from './externalMeeting.controller';
import {
  createExternalMeetingSchema,
  updateExternalMeetingSchema,
} from './externalMeeting.schemas';

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('ats'));

// External meetings share the calendar, so they share its `interviews`
// permission rather than adding a new resource to every role.
router.get(
  '/',
  requirePermission('interviews', 'read'),
  getAllExternalMeetings
);

router.post(
  '/',
  requirePermission('interviews', 'write'),
  validate(createExternalMeetingSchema),
  createExternalMeeting
);

router.get(
  '/:id',
  requirePermission('interviews', 'read'),
  getExternalMeetingById
);

router.patch(
  '/:id',
  requirePermission('interviews', 'write'),
  validate(updateExternalMeetingSchema),
  updateExternalMeeting
);

router.delete(
  '/:id',
  requirePermission('interviews', 'write'),
  cancelExternalMeeting
);

export default router;
