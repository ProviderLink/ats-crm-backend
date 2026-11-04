import os from 'os';
import { generateMissingScorecardsForLastWeek } from '../features/scorecards/scorecard.service';
import logger from '../shared/utils/logger';
import { scheduleDailyInCompanyTimezone } from './companyScheduler';
import { acquireLock, releaseLock } from './cronLock';

const JOB_NAME = 'scorecard-weekly';
const INSTANCE_ID = `${os.hostname()}-${process.pid}`;

/**
 * Runs every morning, not only on Monday, and fills in only what is missing:
 * the scheduler does not replay a run missed during a restart, and a finished
 * week must never be lost because of one.
 */
const SCORECARD_HOUR = 6;
const SCORECARD_MINUTE = 0;

export function scheduleScorecardJob(): void {
  scheduleDailyInCompanyTimezone(
    JOB_NAME,
    SCORECARD_HOUR,
    SCORECARD_MINUTE,
    async () => {
      const locked = await acquireLock(JOB_NAME, INSTANCE_ID);
      if (!locked) {
        logger.debug('Scorecard job skipped — lock held by another instance');
        return;
      }
      try {
        const { generated } = await generateMissingScorecardsForLastWeek();
        logger.info(`Scorecard job completed: ${generated} generated`);
      } finally {
        await releaseLock(JOB_NAME);
      }
    }
  );
}
