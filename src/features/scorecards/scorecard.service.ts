import mongoose from 'mongoose';
import { getCompanyTimezone } from '../../shared/utils/companyTimezone';
import { formatDateKey } from '../../shared/utils/timezone';
import { createLog } from '../activity-logs/activityLog.service';
import Assignment from '../assignments/assignment.model';
import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
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

  const vaIds = [...new Set(scorecards.map(s => String(s.vaId)))];
  const assignmentIds = [
    ...new Set(scorecards.map(s => String(s.assignmentId))),
  ];

  const [candidateDocs, assignmentDocs] = await Promise.all([
    vaIds.length > 0
      ? Candidate.find({ _id: { $in: vaIds } }).select('firstName lastName')
      : [],
    assignmentIds.length > 0
      ? Assignment.find({ _id: { $in: assignmentIds } }).select('clientId')
      : [],
  ]);

  const candidateNameMap: Record<string, string> = Object.fromEntries(
    candidateDocs.map(c => [
      String(c._id),
      `${(c as any).firstName ?? ''} ${(c as any).lastName ?? ''}`.trim(),
    ])
  );

  const assignmentToClient: Record<string, string> = Object.fromEntries(
    assignmentDocs.map(a => [String(a._id), String(a.clientId)])
  );
  const clientIds = [
    ...new Set(Object.values(assignmentToClient).filter(Boolean)),
  ];
  const clientDocs =
    clientIds.length > 0
      ? await Client.find({ _id: { $in: clientIds } }).select('companyName')
      : [];
  const clientNameMap: Record<string, string> = Object.fromEntries(
    clientDocs.map(c => [String(c._id), String((c as any).companyName ?? '')])
  );

  return {
    scorecards: scorecards.map(s => {
      const clientId = assignmentToClient[String(s.assignmentId)] ?? '';
      return {
        ...s.toSafeObject(),
        vaName: candidateNameMap[String(s.vaId)] ?? '',
        companyName: clientNameMap[clientId] ?? '',
      };
    }),
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
  const companyTimezone = await getCompanyTimezone();
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

    // EOD compliance: how many company business days had a submission.
    // `dateKeyFrom`/`dateKeyTo` mirror the week window on the company calendar.
    const dateKeyFrom = formatDateKey(weekStart, companyTimezone);
    const dateKeyTo = formatDateKey(weekEnd, companyTimezone);

    const eodCount = await EodSubmission.countDocuments({
      assignmentId: assignment._id,
      dateKey: { $gte: dateKeyFrom, $lte: dateKeyTo },
    });
    const eodComplianceRate = Math.min(
      100,
      Math.round((eodCount / DAYS_IN_WEEK) * 100)
    );

    // On-time = submitted during the company day it reports on. Comparing ISO
    // dates (rather than parsed local dates) keeps this correct for a VA whose
    // device is in a different timezone from the company.
    const eodSubmissions = await EodSubmission.find({
      assignmentId: assignment._id,
      dateKey: { $gte: dateKeyFrom, $lte: dateKeyTo },
    });
    const onTimeCount = eodSubmissions.filter(eod => {
      const submittedOn = formatDateKey(
        new Date(eod.createdAt as unknown as Date),
        companyTimezone
      );
      return submittedOn === eod.dateKey;
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
