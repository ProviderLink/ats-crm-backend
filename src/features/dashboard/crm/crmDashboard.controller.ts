import catchAsync from '../../../shared/utils/catchAsync';
import { sendSuccess } from '../../../shared/utils/response';
import { getDashboardStats } from './crmDashboard.service';

export const getDashboard = catchAsync(async (req, res) => {
  const stats = await getDashboardStats();
  sendSuccess(res, stats, 'CRM dashboard retrieved', 200);
});
