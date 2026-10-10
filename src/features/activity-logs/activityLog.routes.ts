import { Router } from 'express';
import authenticate from '../../shared/middleware/authenticate';
import {
  hasPermission,
  requirePermission,
} from '../../shared/middleware/authorize';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { getAllLogs, getResourceLogs } from './activityLog.controller';

const router = Router();

/**
 * The permission that already lets someone read each kind of record. Anyone who
 * can open a candidate, job or client may read that record's own activity; the
 * global feed and every other record type (team members, settings, tags, CRM)
 * still need `activityLogs.read`.
 */
const RECORD_READ_PERMISSION: Record<string, [string, string]> = {
  candidate: ['candidates', 'read'],
  application: ['candidates', 'read'],
  interview: ['interviews', 'read'],
  job: ['jobs', 'read'],
  client: ['clients', 'read'],
};

const canReadRecordLogs = catchAsync(async (req, _res, next) => {
  const user = req.user!;
  if (hasPermission(user, 'activityLogs', 'read')) return next();

  const rule = RECORD_READ_PERMISSION[req.params.resourceType];
  if (
    rule &&
    user.appAccess.includes('ats') &&
    hasPermission(user, rule[0], rule[1])
  ) {
    return next();
  }

  throw new AppError(
    403,
    'AUTH_INSUFFICIENT_PERMISSIONS',
    'You do not have permission to perform this action'
  );
});

router.use(authenticate);

router.get('/', requirePermission('activityLogs', 'read'), getAllLogs);

router.get('/:resourceType/:resourceId', canReadRecordLogs, getResourceLogs);

export default router;
