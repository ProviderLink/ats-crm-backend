import Assignment from '../../assignments/assignment.model';
import Candidate from '../../candidates/candidate.model';
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

  // Per-VA activity breakdown for the current week
  const perVaAgg = await WorkEntry.aggregate([
    {
      $match: {
        entryDate: { $gte: weekStart, $lte: todayEnd },
      },
    },
    {
      $group: {
        _id: '$candidateId',
        totalMinutes: { $sum: '$timeSpent' },
        entriesCount: { $sum: 1 },
        tasksCompleted: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
        },
      },
    },
    { $sort: { totalMinutes: -1 } },
  ]);

  // Resolve candidate names
  const candidateIds = perVaAgg.map(r => r._id);
  const candidates = await Candidate.find({
    _id: { $in: candidateIds },
  }).lean();
  const candidateMap: Record<string, string> = {};
  for (const c of candidates) {
    candidateMap[String(c._id)] = `${c.firstName} ${c.lastName}`;
  }

  const perVABreakdown = perVaAgg.map(r => ({
    vaId: String(r._id),
    vaName: candidateMap[String(r._id)] ?? 'Unknown VA',
    totalMinutes: r.totalMinutes,
    totalHours: Math.round((r.totalMinutes / 60) * 10) / 10,
    entriesCount: r.entriesCount,
    tasksCompleted: r.tasksCompleted,
  }));

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
    perVABreakdown,
  };
};
