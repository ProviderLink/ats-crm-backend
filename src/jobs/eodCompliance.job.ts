import os from 'os';
import { createLog } from '../features/activity-logs/activityLog.service';
import Assignment from '../features/assignments/assignment.model';
import Candidate from '../features/candidates/candidate.model';
import { createEodReminder } from '../features/eod-reminders/eodReminder.service';
import EodSubmission from '../features/eod-submissions/eodSubmission.model';
import { resolveCompanyDay } from '../shared/utils/companyDay';
import { sendEmail } from '../shared/utils/email';
import logger from '../shared/utils/logger';
import { scheduleDailyInCompanyTimezone } from './companyScheduler';
import { acquireLock, releaseLock } from './cronLock';

const JOB_NAME = 'eod-compliance';
const INSTANCE_ID = `${os.hostname()}-${process.pid}`;

/** EOD compliance runs at 5:00 PM company time. */
const EOD_HOUR = 17;
const EOD_MINUTE = 0;

async function runEodComplianceCheck(): Promise<void> {
  try {
    // Resolve "today" as the company's business day, using exactly the same
    // helper the EOD API uses. The two can no longer disagree, which is what
    // previously caused VAs who had already submitted to be emailed again.
    const companyDay = await resolveCompanyDay();
    logger.info('Running EOD compliance check', {
      dateKey: companyDay.dateKey,
      timeZone: companyDay.timezone,
    });

    const assignments = await Assignment.find({ status: 'active' });

    for (const assignment of assignments) {
      const eodExists = await EodSubmission.findOne({
        assignmentId: assignment._id,
        dateKey: companyDay.dateKey,
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
        action: 'eod_compliance_checked',
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
  scheduleDailyInCompanyTimezone(JOB_NAME, EOD_HOUR, EOD_MINUTE, async () => {
    const locked = await acquireLock(JOB_NAME, INSTANCE_ID);
    if (!locked) {
      logger.debug(
        'EOD compliance check skipped — lock held by another instance'
      );
      return;
    }
    try {
      await runEodComplianceCheck();
    } finally {
      await releaseLock(JOB_NAME);
    }
  });
}
