import mongoose from 'mongoose';
import { createLog } from '../activity-logs/activityLog.service';
import Assignment from '../assignments/assignment.model';
import EodSubmission from '../eod-submissions/eodSubmission.model';
import WorkEntry from '../work-entries/workEntry.model';
import Scorecard from './scorecard.model';
import type { IScorecard } from './scorecard.types';

const DAYS_IN_WEEK = 7;

function getWeekRange(date: Date): { weekStart: Date; weekEnd: Date } {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const weekStart = new Date(d.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}

function computeProductivityScore(params: {
  totalHours: number;
  totalTasks: number;
  eodCompliance: number;
  onTimeRate: number;
}): number {
  const { totalHours, totalTasks, eodCompliance, onTimeRate } = params;
  // Weighted score per spec: EOD Compliance 40%, Work Volume 30%, Task Completion 20%, Consistency 10%
  // Work Volume = total hours normalized to a 40h week
  // Task Completion = completed tasks normalized to ~15 tasks/week (3/day)
  // Consistency = on-time submission rate
  const hoursScore = Math.min(totalHours / 40, 1) * 30; // Work Volume 30%
  const tasksScore = Math.min(totalTasks / (DAYS_IN_WEEK * 3), 1) * 20; // Task Completion 20%
  const eodScore = (eodCompliance / 100) * 40; // EOD Compliance 40%
  const onTimeScore = (onTimeRate / 100) * 10; // Consistency 10%
  return Math.round(hoursScore + tasksScore + eodScore + onTimeScore);
}

export const getAllScorecards = async (filters: {
  vaId?: string;
  page?: number;
  limit?: number;
}): Promise<{
  scorecards: IScorecard[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { vaId, page = 1, limit = 20 } = filters;
  const query: Record<string, unknown> = {};
  if (vaId) query['vaId'] = new mongoose.Types.ObjectId(vaId);

  const skip = (page - 1) * limit;
  const [scorecards, total] = await Promise.all([
    Scorecard.find(query).sort({ weekStart: -1 }).skip(skip).limit(limit),
    Scorecard.countDocuments(query),
  ]);

  return {
    scorecards: scorecards.map(s => s.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getScorecardById = async (id: string): Promise<IScorecard> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('SCORECARD_NOT_FOUND');
  }
  const scorecard = await Scorecard.findById(id);
  if (!scorecard) throw new Error('SCORECARD_NOT_FOUND');
  return scorecard.toSafeObject();
};

export const generateScorecards = async (
  vaId?: string,
  performedBy?: string
): Promise<{ generated: number }> => {
  const assignmentFilter: Record<string, unknown> = { status: 'active' };
  if (vaId) {
    assignmentFilter['candidateId'] = new mongoose.Types.ObjectId(vaId);
  }
  const activeAssignments = await Assignment.find(assignmentFilter);
  const { weekStart, weekEnd } = getWeekRange(new Date());
  let generated = 0;

  for (const assignment of activeAssignments) {
    const vaId = assignment.candidateId.toString();
    const assignmentId = assignment._id.toString();

    // Work entries for this assignment this week
    const workEntries = await WorkEntry.find({
      assignmentId: assignment._id,
      entryDate: { $gte: weekStart, $lte: weekEnd },
    });

    const totalHours =
      workEntries.reduce((sum, we) => sum + (we.timeSpent ?? 0), 0) / 60; // convert minutes to hours
    const totalTasksCompleted = workEntries.filter(
      we => we.status === 'completed'
    ).length;
    const avgTasksPerDay =
      DAYS_IN_WEEK > 0
        ? Math.round((totalTasksCompleted / DAYS_IN_WEEK) * 10) / 10
        : 0;

    // Category distribution
    const categoryDistribution: Record<string, number> = {};
    for (const we of workEntries) {
      const cat = we.taskCategory ?? 'Other';
      categoryDistribution[cat] = (categoryDistribution[cat] ?? 0) + 1;
    }

    // EOD compliance: how many days had an EOD submission
    const eodCount = await EodSubmission.countDocuments({
      assignmentId: assignment._id,
      date: { $gte: weekStart, $lte: weekEnd },
    });
    const eodComplianceRate = Math.round((eodCount / DAYS_IN_WEEK) * 100);

    // On-time: EODs submitted on the same day (crude proxy — check createdAt vs date)
    const eodSubmissions = await EodSubmission.find({
      assignmentId: assignment._id,
      date: { $gte: weekStart, $lte: weekEnd },
    });
    const onTimeCount = eodSubmissions.filter(eod => {
      const submissionDay = new Date(eod.createdAt).toDateString();
      const eodDay = new Date(eod.date).toDateString();
      return submissionDay === eodDay;
    }).length;
    const onTimeSubmissionRate =
      eodCount > 0 ? Math.round((onTimeCount / eodCount) * 100) : 0;

    const productivityScore = computeProductivityScore({
      totalHours,
      totalTasks: totalTasksCompleted,
      eodCompliance: eodComplianceRate,
      onTimeRate: onTimeSubmissionRate,
    });

    // Upsert — one scorecard per VA per assignment per week
    await Scorecard.findOneAndUpdate(
      {
        vaId: assignment.candidateId,
        assignmentId: assignment._id,
        weekStart,
      },
      {
        vaId: assignment.candidateId,
        assignmentId: assignment._id,
        weekStart,
        weekEnd,
        totalHours: Math.round(totalHours * 10) / 10,
        totalTasksCompleted,
        avgTasksPerDay,
        eodComplianceRate,
        onTimeSubmissionRate,
        productivityScore,
        categoryDistribution,
        generatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    generated++;
  }

  if (performedBy) {
    await createLog({
      action: 'scorecard_generated',
      resourceType: 'scorecards',
      resourceId: 'bulk',
      description: `Generated ${generated} scorecards for week of ${weekStart.toISOString().slice(0, 10)}`,
      performedBy,
    });
  }

  return { generated };
};
