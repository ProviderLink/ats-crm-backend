import catchAsync from '../../../shared/utils/catchAsync';
import { sendSuccess } from '../../../shared/utils/response';
import { getDashboardMetrics, getDashboardStats } from './atsDashboard.service';

export const getDashboard = catchAsync(async (req, res) => {
  const stats = await getDashboardStats();
  sendSuccess(res, stats, 'ATS dashboard retrieved', 200);
});

export const getMetrics = catchAsync(async (req, res) => {
  const metrics = await getDashboardMetrics();
  sendSuccess(res, metrics, 'ATS dashboard metrics retrieved', 200);
});
