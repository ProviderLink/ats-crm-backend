import catchAsync from '../../../shared/utils/catchAsync';
import { sendSuccess } from '../../../shared/utils/response';
import { getDashboardStats } from './crmDashboard.service';

export const getDashboard = catchAsync(async (req, res) => {
  // Account managers see only their own assignments' activity.
  // Admins see global stats.
  const isAM =
    !req.user!.roles.includes('admin') &&
    req.user!.roles.includes('account_manager');
  const accountManagerId = isAM ? req.user!._id : undefined;

  const stats = await getDashboardStats(accountManagerId);
  sendSuccess(res, stats, 'CRM dashboard retrieved', 200);
});
