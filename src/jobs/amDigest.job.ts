import os from 'os';
import { env } from '../config/env';
import Assignment from '../features/assignments/assignment.model';
import Candidate from '../features/candidates/candidate.model';
import Client from '../features/clients/client.model';
import EodSubmission from '../features/eod-submissions/eodSubmission.model';
import { hasBlocker } from '../features/scorecards/workActivity';
import SurveyReminder from '../features/survey-reminders/surveyReminder.model';
import User from '../features/users/user.model';
import {
  isWorkingDayKey,
  resolveCompanyDay,
} from '../shared/utils/companyDay';
import { sendEmail } from '../shared/utils/email';
import logger from '../shared/utils/logger';
import {
  addDaysToDateKey,
  formatDateKey,
} from '../shared/utils/timezone';
import { scheduleDailyInCompanyTimezone } from './companyScheduler';
import { acquireLock, releaseLock } from './cronLock';

const JOB_NAME = 'am-digest';
const INSTANCE_ID = `${os.hostname()}-${process.pid}`;

/** Sent at 8:00 AM company time, on working days. */
const DIGEST_HOUR = 8;
const DIGEST_MINUTE = 0;

/** Missing this many reports in a row is called out at the top of the email. */
const ESCALATE_AFTER_DAYS = 2;
/** How far back a run of missed reports is counted. */
const MAX_MISSED_DAYS = 10;

export interface MissedReport {
  who: string;
  days: number;
}

export interface DigestContent {
  firstName: string;
  reportDay: string;
  missed: MissedReport[];
  blockers: string[];
  checkins: string[];
}

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const previousWorkingDay = (dayKey: string): string => {
  let day = addDaysToDateKey(dayKey, -1);
  while (!isWorkingDayKey(day)) day = addDaysToDateKey(day, -1);
  return day;
};

/**
 * Reports missed in a row, counting back from `fromDay` to the assignment's
 * start and stopping at the first working day with a report.
 */
export function countMissedInARow(
  fromDay: string,
  startKey: string,
  filedDays: Set<string>
): number {
  let missed = 0;
  let day = fromDay;
  while (missed < MAX_MISSED_DAYS && day >= startKey && !filedDays.has(day)) {
    missed++;
    day = previousWorkingDay(day);
  }
  return missed;
}

const section = (title: string, items: string[]) =>
  items.length === 0
    ? ''
    : `<h3 style="margin:20px 0 6px;font-size:15px">${esc(title)}</h3>
       <ul style="margin:0;padding-left:20px">${items
         .map(item => `<li>${esc(item)}</li>`)
         .join('')}</ul>`;

const missedLine = ({ who, days }: MissedReport) =>
  days > 1
    ? `${who}: ${days}${days >= MAX_MISSED_DAYS ? '+' : ''} reports missed in a row`
    : who;

/**
 * The email body. It names people and counts only: blocker text can contain
 * patient details, so it stays in the CRM.
 */
export function buildDigestEmail(content: DigestContent): {
  subject: string;
  html: string;
  text: string;
} {
  const { firstName, reportDay, missed, blockers, checkins } = content;
  const urgent = missed.filter(m => m.days >= ESCALATE_AFTER_DAYS);
  const recent = missed.filter(m => m.days < ESCALATE_AFTER_DAYS);
  const groups: [string, string[]][] = [
    ['Needs attention: reports missed repeatedly', urgent.map(missedLine)],
    [`Missing report for ${reportDay}`, recent.map(missedLine)],
    [`Blockers reported on ${reportDay}`, blockers],
    ['Check-ins due', checkins],
  ];
  const total = missed.length + blockers.length + checkins.length;
  const link = env.CRM_FRONTEND_URL;

  return {
    subject: urgent.length
      ? `Your morning summary: ${urgent.length} VA(s) need attention`
      : `Your morning summary: ${total} item(s) to follow up`,
    html: `<p>Hi ${esc(firstName)},</p>
      <p>Here is what needs your follow-up today.</p>
      ${groups.map(([title, items]) => section(title, items)).join('')}
      <p style="margin-top:20px"><a href="${esc(link)}">Open the CRM</a> to see the details.</p>`,
    text: [
      `Hi ${firstName},`,
      ...groups.flatMap(([title, items]) =>
        items.length ? [``, `${title}:`, ...items.map(i => `- ${i}`)] : []
      ),
      ``,
      `Open the CRM to see the details: ${link}`,
    ].join('\n'),
  };
}

export async function runAmDigest(): Promise<void> {
  const companyDay = await resolveCompanyDay();
  const { dateKey: today, timezone } = companyDay;
  if (!isWorkingDayKey(today)) return;
  const reportDay = previousWorkingDay(today);

  const assignments = await Assignment.find({
    status: 'active',
    startDate: { $lt: companyDay.end },
  });
  if (assignments.length === 0) return;
  const assignmentIds = assignments.map(a => a._id);

  const [candidates, clients, managers, eods, reminders] = await Promise.all([
    Candidate.find({
      _id: { $in: assignments.map(a => a.candidateId) },
    }).select('firstName lastName'),
    Client.find({ _id: { $in: assignments.map(a => a.clientId) } }).select(
      'companyName'
    ),
    User.find({
      _id: { $in: assignments.map(a => a.accountManagerId) },
      isActive: true,
    }).select('firstName email'),
    EodSubmission.find({
      assignmentId: { $in: assignmentIds },
      // Weekends included, so this comfortably covers MAX_MISSED_DAYS.
      dateKey: { $gte: addDaysToDateKey(today, -(MAX_MISSED_DAYS * 2)) },
    }).select('assignmentId dateKey blockers'),
    SurveyReminder.find({
      relatedType: 'assignment',
      relatedId: { $in: assignmentIds },
      status: { $in: ['pending', 'sent'] },
      dueDate: { $lt: companyDay.end },
    }).select('relatedId'),
  ]);

  const candidateName = new Map(
    candidates.map(c => [String(c._id), `${c.firstName} ${c.lastName}`])
  );
  const clientName = new Map(
    clients.map(c => [String(c._id), c.companyName])
  );
  const filed = new Map<string, Set<string>>();
  const blocked = new Set<string>();
  for (const eod of eods) {
    const id = String(eod.assignmentId);
    if (!filed.has(id)) filed.set(id, new Set());
    filed.get(id)!.add(eod.dateKey);
    if (eod.dateKey === reportDay && hasBlocker(eod.blockers)) blocked.add(id);
  }
  const checkinCounts = new Map<string, number>();
  for (const reminder of reminders) {
    const id = String(reminder.relatedId);
    checkinCounts.set(id, (checkinCounts.get(id) ?? 0) + 1);
  }

  let sent = 0;
  for (const manager of managers) {
    const missed: MissedReport[] = [];
    const blockers: string[] = [];
    const checkins: string[] = [];

    for (const assignment of assignments) {
      if (String(assignment.accountManagerId) !== String(manager._id)) continue;
      const id = String(assignment._id);
      const who = `${candidateName.get(String(assignment.candidateId)) ?? 'VA'} (${
        clientName.get(String(assignment.clientId)) ?? 'client'
      })`;

      const days = countMissedInARow(
        reportDay,
        formatDateKey(assignment.startDate, timezone),
        filed.get(id) ?? new Set()
      );
      if (days > 0) missed.push({ who, days });
      if (blocked.has(id)) blockers.push(who);
      const due = checkinCounts.get(id) ?? 0;
      if (due > 0) checkins.push(due > 1 ? `${who}: ${due} check-ins` : who);
    }

    // No email on a clear day, so that an email always means something.
    if (missed.length + blockers.length + checkins.length === 0) continue;
    missed.sort((a, b) => b.days - a.days);

    try {
      await sendEmail({
        to: [manager.email],
        ...buildDigestEmail({
          firstName: manager.firstName,
          reportDay,
          missed,
          blockers,
          checkins,
        }),
      });
      sent++;
    } catch (error) {
      logger.error(`Failed to send morning digest to manager ${manager._id}`, {
        error: (error as Error).message,
      });
    }
  }
  logger.info(`Morning digest completed: ${sent} sent`);
}

export function scheduleAmDigestJob(): void {
  scheduleDailyInCompanyTimezone(
    JOB_NAME,
    DIGEST_HOUR,
    DIGEST_MINUTE,
    async () => {
      const locked = await acquireLock(JOB_NAME, INSTANCE_ID);
      if (!locked) {
        logger.debug('Morning digest skipped — lock held by another instance');
        return;
      }
      try {
        await runAmDigest();
      } finally {
        await releaseLock(JOB_NAME);
      }
    }
  );
}
