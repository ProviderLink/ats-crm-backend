import os from 'os';
import { createLog } from '../features/activity-logs/activityLog.service';
import SurveyReminder from '../features/survey-reminders/surveyReminder.model';
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

async function runSurveyDispatcher(): Promise<void> {
  try {
    const timeZone = await getCompanyTimezone();
    logger.info('Running survey reminder dispatcher', { timeZone });

    // End of the company-local calendar day (exclusive), so the boundary does
    // not depend on the server's timezone.
    const { end } = getDayRangeInTimeZone(new Date(), timeZone);
    const endOfToday = new Date(end.getTime() - 1);

    const reminders = await SurveyReminder.find({
      status: 'pending',
      dueDate: { $lte: endOfToday },
    });

    for (const reminder of reminders) {
      const accountManager = await User.findOne({
        _id: reminder.assignedTo,
        deactivatedAt: null,
      });
      if (!accountManager) continue;

      try {
        await sendEmail({
          to: [accountManager.email],
          subject: `Survey Reminder: ${reminder.surveyType} check-in due`,
          html: `
            <p>Hi ${accountManager.firstName},</p>
            <p>You have a ${reminder.surveyType} check-in survey due.</p>
            <p>Please complete this survey as soon as possible.</p>
          `,
          text: `Hi ${accountManager.firstName}, you have a ${reminder.surveyType} check-in survey due.`,
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
