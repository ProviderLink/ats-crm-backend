import cron from 'node-cron';
import os from 'os';
import { createLog } from '../features/activity-logs/activityLog.service';
import SurveyReminder from '../features/survey-reminders/surveyReminder.model';
import User from '../features/users/user.model';
import { sendEmail } from '../shared/utils/email';
import logger from '../shared/utils/logger';
import { acquireLock, releaseLock } from './cronLock';

const JOB_NAME = 'survey-dispatcher';
const INSTANCE_ID = `${os.hostname()}-${process.pid}`;

async function runSurveyDispatcher(): Promise<void> {
  try {
    logger.info('Running survey reminder dispatcher');

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const reminders = await SurveyReminder.find({
      status: 'pending',
      dueDate: { $lte: today },
    });

    for (const reminder of reminders) {
      const accountManager = await User.findById(reminder.assignedTo);
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
  cron.schedule('0 9 * * *', async () => {
    const locked = await acquireLock(JOB_NAME, INSTANCE_ID);
    if (!locked) {
      logger.debug('Survey dispatcher skipped — lock held by another instance');
      return;
    }
    try {
      await runSurveyDispatcher();
    } finally {
      await releaseLock(JOB_NAME);
    }
  });
}
