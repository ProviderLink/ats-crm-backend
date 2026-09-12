/**
 * Timezone helpers (pure — no DB access, so models can import this safely).
 *
 * Resolution of the *company* timezone value lives in
 * `companyTimezone.ts` to keep this module dependency-free.
 */

export const DEFAULT_TIMEZONE = 'America/Chicago';

/** True when `tz` is a valid IANA timezone name accepted by Intl. */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface CalendarParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/** Extract the calendar date of `date` as seen in `timeZone`. */
function getCalendarParts(date: Date, timeZone: string): CalendarParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  return {
    year: Number(map['year']),
    month: Number(map['month']),
    day: Number(map['day']),
  };
}

/** Offset (ms) of `timeZone` from UTC at the instant `date`. East is positive. */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  // `hour` can be "24" for midnight in some ICU versions.
  const hour = Number(map['hour']) % 24;

  const asUtc = Date.UTC(
    Number(map['year']),
    Number(map['month']) - 1,
    Number(map['day']),
    hour,
    Number(map['minute']),
    Number(map['second'])
  );

  return asUtc - date.getTime();
}

/**
 * Convert a wall-clock time in `timeZone` to the matching UTC instant.
 * Applies the offset twice so DST transitions resolve correctly.
 */
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = getTimeZoneOffsetMs(new Date(guess), timeZone);
  let timestamp = guess - firstOffset;

  const secondOffset = getTimeZoneOffsetMs(new Date(timestamp), timeZone);
  if (secondOffset !== firstOffset) timestamp = guess - secondOffset;

  return new Date(timestamp);
}

/**
 * The UTC range covering the calendar day of `date` in `timeZone`.
 * `end` is exclusive and DST-safe (23h / 25h days are handled correctly).
 */
export function getDayRangeInTimeZone(
  date: Date,
  timeZone: string
): { start: Date; end: Date } {
  const { year, month, day } = getCalendarParts(date, timeZone);

  const start = zonedWallTimeToUtc(year, month, day, 0, 0, 0, timeZone);

  // Next calendar day (handles month/year rollover).
  const nextDayUtc = new Date(Date.UTC(year, month - 1, day));
  nextDayUtc.setUTCDate(nextDayUtc.getUTCDate() + 1);
  const next = {
    year: nextDayUtc.getUTCFullYear(),
    month: nextDayUtc.getUTCMonth() + 1,
    day: nextDayUtc.getUTCDate(),
  };

  const end = zonedWallTimeToUtc(
    next.year,
    next.month,
    next.day,
    0,
    0,
    0,
    timeZone
  );

  return { start, end };
}

/**
 * Timezone-safe `toLocaleDateString`. Invalid timezones fall back to the
 * default instead of throwing a RangeError.
 */
export function formatInTimeZone(
  date: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  return d.toLocaleDateString('en-US', { ...options, timeZone: tz });
}

/** Wall-clock hour/minute of `date` as seen in `timeZone` (24h, hour 0-23). */
export function getTimePartsInTimeZone(
  date: Date,
  timeZone: string
): { hour: number; minute: number } {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  return {
    hour: Number(map['hour']) % 24, // "24" at midnight in some ICU versions
    minute: Number(map['minute']),
  };
}

export interface DateKeyParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const DATE_KEY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a `YYYY-MM-DD` key. Returns `null` when the shape is invalid. */
export function parseDateKey(input: string): DateKeyParts | null {
  const match = DATE_KEY_REGEX.exec(input ?? '');
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Reject impossible dates such as 2025-02-31.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** Calendar date of `date` as seen in `timeZone`, formatted `YYYY-MM-DD`. */
export function formatDateKey(
  date: Date,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const { year, month, day } = getCalendarParts(date, tz);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(
    2,
    '0'
  )}-${String(day).padStart(2, '0')}`;
}

/**
 * UTC range covering the calendar day named by a `YYYY-MM-DD` key in
 * `timeZone`. `end` is exclusive and DST-safe (23h / 25h days handled).
 * Throws on a malformed key so bad input fails loudly instead of silently
 * matching the wrong day.
 */
export function getDayRangeForDateKey(
  dateKey: string,
  timeZone: string = DEFAULT_TIMEZONE
): { start: Date; end: Date } {
  const parts = parseDateKey(dateKey);
  if (!parts) {
    throw new Error(`Invalid date key "${dateKey}" — expected YYYY-MM-DD`);
  }

  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const { year, month, day } = parts;
  const start = zonedWallTimeToUtc(year, month, day, 0, 0, 0, tz);

  const nextDayUtc = new Date(Date.UTC(year, month - 1, day));
  nextDayUtc.setUTCDate(nextDayUtc.getUTCDate() + 1);
  const end = zonedWallTimeToUtc(
    nextDayUtc.getUTCFullYear(),
    nextDayUtc.getUTCMonth() + 1,
    nextDayUtc.getUTCDate(),
    0,
    0,
    0,
    tz
  );

  return { start, end };
}

/** Shift a `YYYY-MM-DD` key by whole days (negative shifts go back). */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const parts = parseDateKey(dateKey);
  if (!parts) {
    throw new Error(`Invalid date key "${dateKey}" — expected YYYY-MM-DD`);
  }

  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days)
  );

  return `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${String(
    shifted.getUTCMonth() + 1
  ).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}
