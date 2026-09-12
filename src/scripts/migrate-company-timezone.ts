import { connectDB } from '../config/db';
import '../config/env';
import Settings from '../features/settings/settings.model';
import { clearCompanyTimezoneCache } from '../shared/utils/companyTimezone';
import logger from '../shared/utils/logger';
import { DEFAULT_TIMEZONE, isValidTimeZone } from '../shared/utils/timezone';

/**
 * One-time migration: move the singleton settings document's `companyTimezone`
 * onto the workspace default (Katy, Texas → `America/Chicago`).
 *
 * Why this is needed: the schema default only applies when a document is first
 * created. `Settings.getSettings()` upserts with `setDefaultsOnInsert`, so an
 * existing row keeps whatever value it already had — which was the old
 * `America/New_York` default. Without this migration the backend would keep
 * scheduling in Eastern time even though the app now targets Central.
 *
 * Safety:
 *   - Only touches the legacy `America/New_York` value (the previous default).
 *     Any timezone an admin deliberately chose is left untouched.
 *   - Pass `--force` to overwrite whatever is stored.
 *   - Idempotent — safe to re-run.
 */
async function run(): Promise<void> {
  await connectDB();

  const force = process.argv.includes('--force');
  logger.info(
    `Starting company timezone migration (target: ${DEFAULT_TIMEZONE}, force: ${force})`
  );

  const settings = await Settings.findOne({});
  if (!settings) {
    logger.info(
      'No settings document found — nothing to migrate. It will be created with the new default.'
    );
    process.exit(0);
  }

  const current = settings.companyTimezone;

  if (current === DEFAULT_TIMEZONE) {
    logger.info(`Already set to ${DEFAULT_TIMEZONE} — nothing to do.`);
    process.exit(0);
  }

  const isLegacyDefault = current === 'America/New_York' || !current;
  if (!isLegacyDefault && !force) {
    logger.warn(
      `companyTimezone is "${current}" (not the legacy default). ` +
        'Leaving it untouched — re-run with --force to overwrite.'
    );
    process.exit(0);
  }

  if (!isValidTimeZone(DEFAULT_TIMEZONE)) {
    logger.error(
      `Target timezone ${DEFAULT_TIMEZONE} is not valid — aborting.`
    );
    process.exit(1);
  }

  settings.companyTimezone = DEFAULT_TIMEZONE;
  await settings.save();
  clearCompanyTimezoneCache();

  logger.info(`companyTimezone migrated: "${current}" → "${DEFAULT_TIMEZONE}"`);
  process.exit(0);
}

run().catch(err => {
  logger.error('Company timezone migration failed', err);
  process.exit(1);
});
