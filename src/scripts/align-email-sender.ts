import { connectDB } from '../config/db';
import '../config/env';
import { env } from '../config/env';
import Settings from '../features/settings/settings.model';
import { clearEmailSenderCache } from '../shared/utils/emailSender';
import logger from '../shared/utils/logger';

/**
 * One-time alignment: point the singleton settings document's `email.fromEmail`
 * at `COMPANY_EMAIL`.
 *
 * Why this is needed: the sender address is not user-editable — Resend only
 * sends from a verified-domain address, and the inbound webhook only receives
 * replies for `COMPANY_EMAIL` (every outbound email now sets Reply-To to it).
 * The stored value was seeded from a schema default (`hello@aristagroups.com`)
 * that never matched `COMPANY_EMAIL`, so the Settings UI displayed an address
 * that was not the real sender. This brings the row in line.
 *
 * Safety:
 *   - Only rewrites `email.fromEmail`; `fromName` is left exactly as-is.
 *   - Dry-run by default — pass `--apply` to write.
 *   - Idempotent — safe to re-run.
 */
async function run(): Promise<void> {
  await connectDB();

  const apply = process.argv.includes('--apply');
  const target = env.COMPANY_EMAIL;
  const targetLower = target.toLowerCase();

  logger.info(
    `Starting email sender alignment (target: ${target}, apply: ${apply})`
  );

  const settings = await Settings.findOne({});
  if (!settings) {
    logger.info(
      'No settings document found — nothing to align. It will be created with the schema default; verify that matches COMPANY_EMAIL.'
    );
    process.exit(0);
  }

  const current = settings.email?.fromEmail ?? '';
  const currentName = settings.email?.fromName ?? '';

  logger.info(`Current fromName: "${currentName}" (left untouched)`);

  if (current.toLowerCase() === targetLower) {
    logger.info(`fromEmail already "${current}" — nothing to do.`);
    process.exit(0);
  }

  if (!apply) {
    logger.info(
      `Would change fromEmail: "${current || '(empty)'}" → "${target}". ` +
        'Re-run with --apply to write.'
    );
    process.exit(0);
  }

  settings.email.fromEmail = target;
  settings.markModified('email');
  await settings.save();
  clearEmailSenderCache();

  logger.info(`fromEmail aligned: "${current || '(empty)'}" → "${target}"`);
  process.exit(0);
}

run().catch(err => {
  logger.error('Email sender alignment failed', err);
  process.exit(1);
});
