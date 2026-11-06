import mongoose from 'mongoose';
import {
  isWorkingDayKey,
  resolveCompanyDay,
} from '../../../shared/utils/companyDay';
import Assignment from '../../assignments/assignment.model';
import Candidate from '../../candidates/candidate.model';
import Client from '../../clients/client.model';
import EodSubmission from '../../eod-submissions/eodSubmission.model';
import { IEodSubmission } from '../../eod-submissions/eodSubmission.types';
import WorkEntry from '../../work-entries/workEntry.model';

/**
 * Get dashboard stats, optionally scoped to an account manager's assignments.
 *
 * When `accountManagerId` is provided (for AM users), all assignment counts,
 * work entries, EOD submissions, and per-VA breakdowns are filtered to only
 * the assignments where the AM is assigned.  Admin users receive global stats.
 */
export const getDashboardStats = async (accountManagerId?: string) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  // EOD counts use the company business day, not a server-local window, so the
  // dashboard agrees with the compliance job and the EOD list for VAs spread
  // across the world.
  const companyDay = await resolveCompanyDay();
  const companyTodayKey = companyDay.dateKey;

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  // ── AM scoping: this AM's own assignments ─────
  // Scoped by assignment, not by VA: a VA can also work for another client
  // under another account manager, and that work is not this AM's to see.
  let assignmentIdFilter: mongoose.Types.ObjectId[] | undefined;

  if (accountManagerId) {
    const amAssignments = await Assignment.find({ accountManagerId })
      .select('_id')
      .lean();
    if (amAssignments.length === 0) {
      // No assignments — return empty stats
      return emptyDashboard();
    }
    assignmentIdFilter = amAssignments.map(
      a => a._id as mongoose.Types.ObjectId
    );
  }

  const assignmentBase = accountManagerId ? { accountManagerId } : {};

  const [
    totalAssignments,
    activeAssignments,
    onHoldAssignments,
    endedAssignments,
    totalEodToday,
    totalWorkEntriesToday,
    dueAssignments,
  ] = await Promise.all([
    Assignment.countDocuments(assignmentBase),
    Assignment.countDocuments({ ...assignmentBase, status: 'active' }),
    Assignment.countDocuments({ ...assignmentBase, status: 'on_hold' }),
    Assignment.countDocuments({ ...assignmentBase, status: 'ended' }),
    EodSubmission.countDocuments({
      dateKey: companyTodayKey,
      ...(assignmentIdFilter
        ? { assignmentId: { $in: assignmentIdFilter } }
        : {}),
    }),
    WorkEntry.countDocuments({
      isDeleted: { $ne: true },
      entryDate: { $gte: todayStart, $lte: todayEnd },
      ...(assignmentIdFilter
        ? { assignmentId: { $in: assignmentIdFilter } }
        : {}),
    }),
    // A report is due from active assignments that have started, on working
    // days only; at the weekend nobody is missing one.
    isWorkingDayKey(companyTodayKey)
      ? Assignment.find({
          ...assignmentBase,
          status: 'active',
          startDate: { $lt: companyDay.end },
        })
          .select('_id')
          .lean()
      : Promise.resolve([]),
  ]);

  const dueIds = dueAssignments.map(a => a._id);
  const filedIds =
    dueIds.length > 0
      ? await EodSubmission.distinct('assignmentId', {
          dateKey: companyTodayKey,
          assignmentId: { $in: dueIds },
        })
      : [];
  const dueCount = dueIds.length;
  const filedCount = filedIds.length;
  const missingEodsToday = dueCount - filedCount;
  const complianceRate =
    dueCount > 0 ? Math.round((filedCount / dueCount) * 100) : 100;

  const eodQuery: Record<string, unknown> = {};
  if (assignmentIdFilter) {
    eodQuery.assignmentId = { $in: assignmentIdFilter };
  }
  const recentEodSubmissions = (await EodSubmission.find(eodQuery)
    .sort({ createdAt: -1 })
    .limit(10)
    .lean()) as unknown as IEodSubmission[];

  const workEntryMatch: Record<string, unknown> = {
    isDeleted: { $ne: true },
    entryDate: { $gte: weekStart, $lte: todayEnd },
  };
  if (assignmentIdFilter) {
    // Aggregation pipelines are not cast by Mongoose, so ids must be ObjectIds.
    workEntryMatch.assignmentId = { $in: assignmentIdFilter };
  }

  const weeklyAgg = await WorkEntry.aggregate([
    { $match: workEntryMatch },
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
    { $match: workEntryMatch },
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
  const aggCandidateIds = perVaAgg.map(r => String(r._id));
  const candidates = await Candidate.find({
    _id: { $in: aggCandidateIds },
  }).lean();
  const vaCandidateMap: Record<string, string> = {};
  for (const c of candidates) {
    vaCandidateMap[String(c._id)] = `${c.firstName} ${c.lastName}`;
  }

  const perVABreakdown = perVaAgg.map(r => ({
    vaId: String(r._id),
    vaName: vaCandidateMap[String(r._id)] ?? 'Unknown VA',
    totalMinutes: r.totalMinutes,
    totalHours: Math.round((r.totalMinutes / 60) * 10) / 10,
    entriesCount: r.entriesCount,
    tasksCompleted: r.tasksCompleted,
  }));

  // Per-Client activity breakdown for the current week
  const perClientAgg = await WorkEntry.aggregate([
    { $match: workEntryMatch },
    {
      $group: {
        _id: '$clientId',
        totalMinutes: { $sum: '$timeSpent' },
        entriesCount: { $sum: 1 },
      },
    },
    { $sort: { totalMinutes: -1 } },
  ]);

  const aggClientIds = perClientAgg.map(r => String(r._id));
  const clients = await Client.find({
    _id: { $in: aggClientIds },
  }).lean();
  const clientNameMap: Record<string, string> = {};
  for (const c of clients) {
    clientNameMap[String(c._id)] = c.companyName;
  }

  const perClientBreakdown = perClientAgg.map(r => ({
    clientId: String(r._id),
    clientName: clientNameMap[String(r._id)] ?? 'Unknown Client',
    totalMinutes: r.totalMinutes,
    totalHours: Math.round((r.totalMinutes / 60) * 10) / 10,
    entriesCount: r.entriesCount,
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
      // Assignments that owe a report today, and how many have filed one.
      totalActive: dueCount,
      submittedToday: filedCount,
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
    perClientBreakdown,
  };
};

/** Empty dashboard returned when an AM has no assignments. */
function emptyDashboard() {
  return {
    overview: {
      totalAssignments: 0,
      activeAssignments: 0,
      onHoldAssignments: 0,
      endedAssignments: 0,
      totalEodSubmissionsToday: 0,
      totalWorkEntriesToday: 0,
      missingEodsToday: 0,
    },
    eodCompliance: {
      totalActive: 0,
      submittedToday: 0,
      missingToday: 0,
      complianceRate: 0,
    },
    recentEodSubmissions: [],
    assignmentHealth: {
      active: 0,
      on_hold: 0,
      ended: 0,
    },
    weeklyWorkHours: {
      totalMinutes: 0,
      totalHours: 0,
      entriesCount: 0,
    },
    perVABreakdown: [],
    perClientBreakdown: [],
  };
}
