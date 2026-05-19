import catchAsync from '../../../shared/utils/catchAsync';
import { sendSuccess } from '../../../shared/utils/response';
import { getDashboardStats } from './atsDashboard.service';

export const getDashboard = catchAsync(async (req, res) => {
  const stats = await getDashboardStats();
  sendSuccess(res, stats, 'ATS dashboard retrieved', 200);
});
