import AppError from './AppError';
import { getCompanyTimezone } from './companyTimezone';
import {
  addDaysToDateKey,
  formatDateKey,
  getDayRangeForDateKey,
  parseDateKey,
} from './timezone';

/**
 * The "company business day".
 *
 * EOD submitters are virtual assistants working from anywhere in the world, but
 * they all work the *company's* schedule. So every reporting day on the platform
 * is defined by the company timezone (Settings → General), never by the VA's
 * device clock and never by the server's clock.
 *
 * This module is the single place that answers "which business day is it, and
 * what UTC instants does that day cover?" — used by the EOD API, the compliance
 * job, scorecards, dashboards and reports so they can never drift apart.
 */

export interface CompanyDay {
  /** `YYYY-MM-DD` — the company-local calendar day. Indexable and tz-explicit. */
  dateKey: string;
  /** IANA timezone the key was computed in (stored for auditability). */
  timezone: string;
  /** Inclusive UTC instant at which the company day starts. */
  start: Date;
  /** Exclusive UTC instant at which the *next* company day starts. */
  end: Date;
}

/**
 * Resolve a company business day.
 *
 * - `dateKey` omitted/nullish → the company's *current* day.
 * - `dateKey` provided → validates it, then resolves its boundaries.
 *
 * Always reads the timezone from Settings (60s cache) so an admin change takes
 * effect without a restart.
 */
export async function resolveCompanyDay(
  dateKey?: string | null
): Promise<CompanyDay> {
  const timezone = await getCompanyTimezone();

  let resolvedKey: string;

  if (dateKey === undefined || dateKey === null || dateKey === '') {
    resolvedKey = formatDateKey(new Date(), timezone);
  } else {
    // Accept a full ISO timestamp too, but only kept for the moment-conversion
    // case; a bare date key is the expected input.
    const key =
      dateKey.length > 10
        ? formatDateKey(new Date(dateKey), timezone)
        : dateKey;

    if (!parseDateKey(key)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `Invalid date "${dateKey}" — expected YYYY-MM-DD`
      );
    }
    resolvedKey = key;
  }

  const { start, end } = getDayRangeForDateKey(resolvedKey, timezone);

  return { dateKey: resolvedKey, timezone, start, end };
}

/** The company's current business day key, e.g. `'2025-06-04'`. */
export async function getCompanyTodayKey(): Promise<string> {
  const timezone = await getCompanyTimezone();
  return formatDateKey(new Date(), timezone);
}

/**
 * Build an inclusive `{ $gte, $lte }` range over the `dateKey` field covering
 * the company days from `dateFrom` through `dateTo` (either may be omitted).
 * Returns `null` when no bounds were supplied.
 */
export function buildDateKeyRange(
  dateFrom?: string,
  dateTo?: string
): { $gte?: string; $lte?: string } | null {
  const range: { $gte?: string; $lte?: string } = {};
  if (dateFrom) range.$gte = dateFrom;
  if (dateTo) range.$lte = dateTo;
  return Object.keys(range).length > 0 ? range : null;
}

/**
 * Decimal hours between two `HH:MM` wall-clock strings on the company clock.
 *
 * Handles shifts that cross midnight (e.g. 22:00 → 02:00 = 4h). When `end` is
 * not after `start` the shift is assumed to wrap into the next day, which is
 * the common case for a VA covering another region's business hours.
 *
 * This lives on the server so `hoursWorked` is authoritative and cannot be
 * skewed by a VA's device clock or locale.
 */
export function computeShiftHours(start: string, end: string): number {
  const toMinutes = (value: string): number | null => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? '');
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  };

  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (startMin === null || endMin === null) return 0;

  let minutes = endMin - startMin;
  if (minutes < 0) minutes += 24 * 60; // crossed midnight

  const hours = Math.min(minutes / 60, 24);
  return Math.round(hours * 100) / 100;
}

/** The company day key `days` days before `dateKey` (week windows, etc.). */
export function dateKeyDaysBefore(dateKey: string, days: number): string {
  return addDaysToDateKey(dateKey, -days);
}
