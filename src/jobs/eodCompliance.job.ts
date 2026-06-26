import cron from 'node-cron';
import { createLog } from '../features/activity-logs/activityLog.service';
import Assignment from '../features/assignments/assignment.model';
import Candidate from '../features/candidates/candidate.model';
import { createEodReminder } from '../features/eod-reminders/eodReminder.service';
import EodSubmission from '../features/eod-submissions/eodSubmission.model';
import Settings from '../features/settings/settings.model';
import { sendEmail } from '../shared/utils/email';
import logger from '../shared/utils/logger';

async function runEodComplianceCheck(): Promise<void> {
  try {
    const settings = await Settings.getSettings();
    logger.info('Running EOD compliance check');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const assignments = await Assignment.find({ status: 'active' });

    for (const assignment of assignments) {
      const eodExists = await EodSubmission.findOne({
        assignmentId: assignment._id,
        date: { $gte: today, $lt: tomorrow },
      });

      if (eodExists) continue;

      const candidate = await Candidate.findById(assignment.candidateId);
      if (!candidate) continue;

      const vaEmail = candidate.email;
      const vaName = `${candidate.firstName} ${candidate.lastName}`;

      let status: 'sent' | 'failed' = 'sent';
      try {
        await sendEmail({
          to: [vaEmail],
          subject: 'EOD Submission Reminder',
          html: `
            <p>Hi ${vaName},</p>
            <p>This is a reminder to submit your End of Day report.</p>
            <p>Please log in and submit your EOD summary as soon as possible.</p>
          `,
          text: `Hi ${vaName}, please submit your EOD report.`,
        });
      } catch {
        status = 'failed';
      }

      await createEodReminder({
        assignmentId: assignment._id.toString(),
        candidateId: assignment.candidateId.toString(),
        reminderDate: new Date(),
        reminderType: 'missing_eod',
        status,
      });

      createLog({
        type: 'eod_reminder_sent',
        resourceType: 'eod',
        resourceId: assignment._id.toString(),
        relatedType: 'candidate',
        relatedId: assignment.candidateId.toString(),
      });
    }

    logger.info('EOD compliance check completed');
  } catch (error) {
    logger.error('EOD compliance check failed', { error });
  }
}

export function scheduleEodComplianceJob(): void {
  cron.schedule('0 17 * * *', async () => {
    await runEodComplianceCheck();
  });
}
