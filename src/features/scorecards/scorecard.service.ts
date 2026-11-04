import mongoose from 'mongoose';
import { countWorkingDays } from '../../shared/utils/companyDay';
import { getCompanyTimezone } from '../../shared/utils/companyTimezone';
import { addDaysToDateKey, formatDateKey } from '../../shared/utils/timezone';
import { createLog } from '../activity-logs/activityLog.service';
import Assignment, {
  type IAssignmentDocument,
} from '../assignments/assignment.model';
import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
import Scorecard from './scorecard.model';
import type { IScorecard } from './scorecard.types';
import { loadWorkActivity } from './workActivity';

const DAYS_IN_WEEK = 7;

/**
 * The Monday-to-Sunday company week holding a company day. Weeks are keyed by
 * their calendar days at UTC midnight, so the same week always gets the same
 * key whatever the timezone of the server or the company.
 */
function getWeekRange(dayKey: string): {
  weekStart: Date;
  weekEnd: Date;
  dateKeyFrom: string;
  dateKeyTo: string;
} {
  const day = new Date(`${dayKey}T00:00:00.000Z`).getUTCDay();
  const dateKeyFrom = addDaysToDateKey(dayKey, day === 0 ? -6 : 1 - day);
  const dateKeyTo = addDaysToDateKey(dateKeyFrom, 6);
  return {
    weekStart: new Date(`${dateKeyFrom}T00:00:00.000Z`),
    weekEnd: new Date(`${dateKeyTo}T23:59:59.999Z`),
    dateKeyFrom,
    dateKeyTo,
  };
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
  /** Extra Mongo condition, e.g. an account manager's own assignments. */
  scope?: Record<string, unknown>;
  page?: number;
  limit?: number;
}): Promise<{
  scorecards: IScorecard[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { vaId, scope, page = 1, limit = 20 } = filters;
  const query: Record<string, unknown> = {};
  if (vaId) query['vaId'] = new mongoose.Types.ObjectId(vaId);
  if (scope) query['$and'] = [scope];

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
  performedBy?: string,
  accountManagerId?: string
): Promise<{ generated: number }> => {
  const assignmentFilter: Record<string, unknown> = { status: 'active' };
  if (accountManagerId) {
    assignmentFilter['accountManagerId'] = new mongoose.Types.ObjectId(
      accountManagerId
    );
  }
  if (vaId) {
    assignmentFilter['candidateId'] = new mongoose.Types.ObjectId(vaId);
  }
  const activeAssignments = await Assignment.find(assignmentFilter);
  const companyTimezone = await getCompanyTimezone();
  const week = getWeekRange(formatDateKey(new Date(), companyTimezone));
  const generated = await writeScorecards(
    activeAssignments,
    week,
    companyTimezone
  );

  if (performedBy) {
    await createLog({
      action: 'scorecard_generated',
      resourceType: 'scorecards',
      // The log's resource id must be an ObjectId; a run has no single record,
      // so each run gets its own id.
      resourceId: new mongoose.Types.ObjectId().toString(),
      description: `Generated ${generated} scorecards for week of ${week.dateKeyFrom}`,
      metadata: {
        count: generated,
        weekStart: week.dateKeyFrom,
        ...(vaId ? { vaId } : {}),
      },
      performedBy,
    });
  }

  return { generated };
};

/**
 * Fill in last week's scorecards for assignments that do not have one yet.
 * A scorecard someone already generated is left as it is.
 */
export const generateMissingScorecardsForLastWeek = async (): Promise<{
  generated: number;
}> => {
  const companyTimezone = await getCompanyTimezone();
  const today = formatDateKey(new Date(), companyTimezone);
  const week = getWeekRange(addDaysToDateKey(getWeekRange(today).dateKeyFrom, -1));

  const assignments = await Assignment.find({
    startDate: { $lte: week.weekEnd },
    $or: [
      { status: 'active' },
      { status: 'ended', endDate: { $gte: week.weekStart } },
    ],
  });
  const existing = await Scorecard.find({
    weekStart: week.weekStart,
    assignmentId: { $in: assignments.map(a => a._id) },
  }).select('assignmentId');
  const done = new Set(existing.map(s => String(s.assignmentId)));

  const generated = await writeScorecards(
    assignments.filter(a => !done.has(String(a._id))),
    week,
    companyTimezone
  );
  return { generated };
};

async function writeScorecards(
  assignments: IAssignmentDocument[],
  { weekStart, weekEnd, dateKeyFrom, dateKeyTo }: ReturnType<typeof getWeekRange>,
  companyTimezone: string
): Promise<number> {
  let generated = 0;

  for (const assignment of assignments) {
    const activity = await loadWorkActivity(
      [assignment._id as mongoose.Types.ObjectId],
      dateKeyFrom,
      dateKeyTo
    );
    const totalHours = activity.totalMinutes / 60;
    const totalTasksCompleted = activity.tasksCompleted;
    const avgTasksPerDay =
      DAYS_IN_WEEK > 0
        ? Math.round((totalTasksCompleted / DAYS_IN_WEEK) * 10) / 10
        : 0;
    const categoryDistribution = activity.categoryDistribution;

    // EOD compliance: how many company business days had a submission.
    const eodCount = activity.eods.length;
    // Reports are due on working days from the assignment's start up to today,
    // not on all seven days of the week.
    const dueFrom = [
      dateKeyFrom,
      formatDateKey(assignment.startDate, companyTimezone),
    ].reduce((a, b) => (a > b ? a : b));
    const dueTo = [
      dateKeyTo,
      formatDateKey(new Date(), companyTimezone),
      ...(assignment.endDate
        ? [formatDateKey(assignment.endDate, companyTimezone)]
        : []),
    ].reduce((a, b) => (a < b ? a : b));
    const dueDays = countWorkingDays(dueFrom, dueTo);
    const eodComplianceRate =
      dueDays > 0 ? Math.min(100, Math.round((eodCount / dueDays) * 100)) : 100;

    // On-time = submitted during the company day it reports on. Comparing ISO
    // dates (rather than parsed local dates) keeps this correct for a VA whose
    // device is in a different timezone from the company.
    const onTimeCount = activity.eods.filter(eod => {
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

  return generated;
}
