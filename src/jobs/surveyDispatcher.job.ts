import os from 'os';
import { createLog } from '../features/activity-logs/activityLog.service';
import Assignment from '../features/assignments/assignment.model';
import Candidate from '../features/candidates/candidate.model';
import Client from '../features/clients/client.model';
import SurveyReminder from '../features/survey-reminders/surveyReminder.model';
import { syncAssignmentCheckins } from '../features/survey-reminders/surveyReminder.service';
import User from '../features/users/user.model';
import { getCompanyTimezone } from '../shared/utils/companyTimezone';
import { sendEmail } from '../shared/utils/email';
import logger from '../shared/utils/logger';
import { getDayRangeInTimeZone } from '../shared/utils/timezone';
import { scheduleDailyInCompanyTimezone } from './companyScheduler';
import { acquireLock, releaseLock } from './cronLock';

const JOB_NAME = 'survey-dispatcher';
const INSTANCE_ID = `${os.hostname()}-${process.pid}`;

/** Survey reminders are dispatched at 9:00 AM company time. */
const SURVEY_HOUR = 9;
const SURVEY_MINUTE = 0;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * "3-day check-in" and "Rahim Uddin (Acme Inc.)", so the manager knows which
 * VA and client the reminder is for.
 */
async function describeReminder(
  surveyType: string,
  relatedType: string,
  relatedId: string
): Promise<{ checkin: string; about: string }> {
  const label = surveyType.replace(/_/g, '-');
  const checkin = `${label.charAt(0).toUpperCase()}${label.slice(1)} check-in`;
  if (relatedType !== 'assignment') return { checkin, about: '' };

  const assignment = await Assignment.findById(relatedId).select(
    'candidateId clientId'
  );
  if (!assignment) return { checkin, about: '' };
  const [candidate, client] = await Promise.all([
    Candidate.findById(assignment.candidateId).select('firstName lastName'),
    Client.findById(assignment.clientId).select('companyName'),
  ]);
  const va =
    `${candidate?.firstName ?? ''} ${candidate?.lastName ?? ''}`.trim();
  const company = client?.companyName ?? '';
  const about = va && company ? `${va} (${company})` : va || company;
  return { checkin, about };
}

async function runSurveyDispatcher(): Promise<void> {
  try {
    const timeZone = await getCompanyTimezone();
    logger.info('Running survey reminder dispatcher', { timeZone });

    // End of the company-local calendar day (exclusive), so the boundary does
    // not depend on the server's timezone.
    const { end } = getDayRangeInTimeZone(new Date(), timeZone);
    const endOfToday = new Date(end.getTime() - 1);

    await syncAssignmentCheckins();

    const reminders = await SurveyReminder.find({
      status: 'pending',
      dueDate: { $lte: endOfToday },
    });

    // A check-in on a paused assignment stays pending until it resumes.
    const onHold = await Assignment.find({ status: 'on_hold' }).select('_id');
    const onHoldIds = new Set(onHold.map(a => String(a._id)));

    for (const reminder of reminders) {
      if (
        reminder.relatedType === 'assignment' &&
        onHoldIds.has(String(reminder.relatedId))
      ) {
        continue;
      }

      const accountManager = await User.findById(reminder.assignedTo);
      if (!accountManager) continue;

      try {
        const { checkin, about } = await describeReminder(
          reminder.surveyType,
          reminder.relatedType,
          String(reminder.relatedId)
        );
        const aboutText = about ? ` for ${about}` : '';
        await sendEmail({
          to: [accountManager.email],
          subject: `${checkin} due${about ? `: ${about}` : ''}`,
          html: `
            <p>Hi ${escapeHtml(accountManager.firstName)},</p>
            <p>The ${escapeHtml(checkin.toLowerCase())}${escapeHtml(aboutText)} is due.</p>
            <p>Please complete this survey as soon as possible.</p>
          `,
          text: `Hi ${accountManager.firstName}, the ${checkin.toLowerCase()}${aboutText} is due.`,
        });

        reminder.status = 'sent';
        await reminder.save();

        createLog({
          action: 'survey_dispatched',
          resourceType: 'survey',
          resourceId: reminder._id.toString(),
          relatedType: reminder.relatedType,
          relatedId: reminder.relatedId.toString(),
        });
      } catch {
        logger.error(`Failed to send survey reminder ${reminder._id}`);
      }
    }

    logger.info(
      `Survey dispatcher completed: ${reminders.length} reminders processed`
    );
  } catch (error) {
    logger.error('Survey dispatcher failed', { error });
  }
}

export function scheduleSurveyDispatcherJob(): void {
  scheduleDailyInCompanyTimezone(
    JOB_NAME,
    SURVEY_HOUR,
    SURVEY_MINUTE,
    async () => {
      const locked = await acquireLock(JOB_NAME, INSTANCE_ID);
      if (!locked) {
        logger.debug(
          'Survey dispatcher skipped — lock held by another instance'
        );
        return;
      }
      try {
        await runSurveyDispatcher();
      } finally {
        await releaseLock(JOB_NAME);
      }
    }
  );
}
