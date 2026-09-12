import cron from 'node-cron';
import { getCompanyTimezone } from '../shared/utils/companyTimezone';
import logger from '../shared/utils/logger';
import { getTimePartsInTimeZone } from '../shared/utils/timezone';

/**
 * Schedule a job to run once per day at `hour:minute` **in the company
 * timezone** (the value stored in Settings).
 *
 * node-cron fixes the timezone when the task is created, so a plain
 * `cron.schedule('0 17 * * *', { timezone })` would keep using the value that
 * was current at boot. Instead we tick every minute and compare the
 * company-local wall clock, which means changing the timezone in Settings
 * takes effect on the next minute with no restart.
 *
 * Behaviour matches the previous hard-coded cron exactly: the job fires only
 * during its target minute and is NOT replayed after downtime. That is
 * deliberate — these jobs send email, so a restart at 6 PM must not re-trigger
 * the 5 PM digest and duplicate reminders. The once-per-local-day guard is kept
 * as a second line of defence against a double tick within the same minute.
 *
 * @param name   Unique job name (used for logs + the once-per-day guard).
 * @param hour   Target hour in 24h company-local time.
 * @param minute Target minute in company-local time.
 * @param run    The job body.
 */
export function scheduleDailyInCompanyTimezone(
  name: string,
  hour: number,
  minute: number,
  run: () => Promise<void>
): void {
  let lastRunDay: string | null = null;
  let running = false;

  cron.schedule('* * * * *', async () => {
    if (running) return;

    const now = new Date();
    let timeZone: string;
    try {
      timeZone = await getCompanyTimezone();
    } catch (error) {
      logger.error(`[${name}] Could not resolve company timezone`, { error });
      return;
    }

    const { hour: localHour, minute: localMinute } = getTimePartsInTimeZone(
      now,
      timeZone
    );
    const localDay = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    if (localHour !== hour || localMinute !== minute) return;
    if (lastRunDay === localDay) return;

    running = true;
    try {
      await run();
      lastRunDay = localDay;
    } catch (error) {
      logger.error(`[${name}] Job failed`, { error });
    } finally {
      running = false;
    }
  });

  logger.info(
    `[${name}] Scheduled daily at ${hour}:${String(minute).padStart(2, '0')} company time`
  );
}
