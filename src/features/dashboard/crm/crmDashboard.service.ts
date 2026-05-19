import Assignment from '../../assignments/assignment.model';
import EodReminder from '../../eod-reminders/eodReminder.model';
import EodSubmission from '../../eod-submissions/eodSubmission.model';
import { IEodSubmission } from '../../eod-submissions/eodSubmission.types';
import WorkEntry from '../../work-entries/workEntry.model';

export const getDashboardStats = async () => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  const [
    totalAssignments,
    activeAssignments,
    onHoldAssignments,
    endedAssignments,
    totalEodToday,
    totalWorkEntriesToday,
    missingEodsToday,
  ] = await Promise.all([
    Assignment.countDocuments({}),
    Assignment.countDocuments({ status: 'active' }),
    Assignment.countDocuments({ status: 'on_hold' }),
    Assignment.countDocuments({ status: 'ended' }),
    EodSubmission.countDocuments({
      date: { $gte: todayStart, $lte: todayEnd },
    }),
    WorkEntry.countDocuments({
      entryDate: { $gte: todayStart, $lte: todayEnd },
    }),
    EodReminder.countDocuments({
      reminderDate: { $gte: todayStart, $lte: todayEnd },
      status: 'sent',
    }),
  ]);

  const complianceRate =
    activeAssignments > 0
      ? Math.round((totalEodToday / activeAssignments) * 100)
      : 100;

  const recentEodSubmissions = (await EodSubmission.find({})
    .sort({ createdAt: -1 })
    .limit(10)
    .lean()) as unknown as IEodSubmission[];

  const weeklyAgg = await WorkEntry.aggregate([
    {
      $match: {
        entryDate: { $gte: weekStart, $lte: todayEnd },
      },
    },
    {
      $group: {
        _id: null,
        totalMinutes: { $sum: '$timeSpent' },
        entriesCount: { $sum: 1 },
      },
    },
  ]);

  const weeklyData = weeklyAgg[0] ?? { totalMinutes: 0, entriesCount: 0 };

  return {
    overview: {
      totalAssignments,
      activeAssignments,
      onHoldAssignments,
      endedAssignments,
      totalEodSubmissionsToday: totalEodToday,
      totalWorkEntriesToday,
      missingEodsToday,
    },
    eodCompliance: {
      totalActive: activeAssignments,
      submittedToday: totalEodToday,
      missingToday: missingEodsToday,
      complianceRate,
    },
    recentEodSubmissions,
    assignmentHealth: {
      active: activeAssignments,
      on_hold: onHoldAssignments,
      ended: endedAssignments,
    },
    weeklyWorkHours: {
      totalMinutes: weeklyData.totalMinutes,
      totalHours: weeklyData.totalMinutes / 60,
      entriesCount: weeklyData.entriesCount,
    },
  };
};
