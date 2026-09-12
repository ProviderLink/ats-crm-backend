import { env } from '../../config/env';
import Settings from '../../features/settings/settings.model';
import logger from './logger';
import { DEFAULT_TIMEZONE, isValidTimeZone } from './timezone';

/**
 * Resolves the company timezone used by the backend.
 *
 * Priority: DB `Settings.companyTimezone` → `COMPANY_TIMEZONE` env → default.
 * The DB value is the source of truth so the Settings UI is authoritative.
 *
 * Kept in a separate module from `timezone.ts` because that one is imported by
 * the settings model itself (importing the model back would be circular).
 */

const CACHE_TTL_MS = 60_000;

let cached: { value: string; at: number } | null = null;

/** Invalidate the cached value (call after settings are updated). */
export function clearCompanyTimezoneCache(): void {
  cached = null;
}

/**
 * Resolve the company timezone. Never throws — falls back to the env value,
 * then to a built-in default, so emails and cron jobs always keep running.
 */
export async function getCompanyTimezone(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let value = env.COMPANY_TIMEZONE || DEFAULT_TIMEZONE;

  try {
    const settings = await Settings.getSettings();
    if (settings?.companyTimezone) value = settings.companyTimezone;
  } catch (error) {
    logger.error('Failed to read company timezone from settings', { error });
  }

  if (!isValidTimeZone(value)) {
    logger.warn(
      `Invalid company timezone "${value}" — falling back to ${DEFAULT_TIMEZONE}`
    );
    value = DEFAULT_TIMEZONE;
  }

  cached = { value, at: Date.now() };
  return value;
}
