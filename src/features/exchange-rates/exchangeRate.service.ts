import { z } from 'zod';
import AppError from '../../shared/utils/AppError';
import logger from '../../shared/utils/logger';
import ExchangeRate from './exchangeRate.model';

/**
 * USD -> PHP rate from Frankfurter (European Central Bank reference rates,
 * published once per working day; free, no API key).
 *
 * Security notes:
 * - The URL is a fixed constant; nothing from a request reaches it (no SSRF).
 * - Redirects are refused, the call times out, and the body is size-capped.
 * - The response is schema-validated and the rate must fall in a sane range,
 *   so a bad or hostile response can never be stored or shown.
 * - Nothing about our users or candidates is ever sent to the provider.
 */
const PAIR = 'USD_PHP';
const SOURCE_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP';
const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 10_000;
/** Re-check twice a day; ECB publishes one new rate per working day. */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
/** After a failed fetch, wait before trying the provider again. */
const RETRY_COOLDOWN_MS = 10 * 60 * 1000;
/** USD->PHP has traded between ~40 and ~65 for decades; reject anything wild. */
const MIN_RATE = 20;
const MAX_RATE = 200;

const responseSchema = z.object({
  base: z.literal('USD'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.object({
    PHP: z.number().finite().min(MIN_RATE).max(MAX_RATE),
  }),
});

export interface UsdPhpRate {
  rate: number;
  rateDate: string;
  fetchedAt: string;
}

let inFlight: Promise<UsdPhpRate | null> | null = null;
let lastFailureAt = 0;

const toDto = (doc: {
  rate: number;
  rateDate: string;
  fetchedAt: Date;
}): UsdPhpRate => ({
  rate: doc.rate,
  rateDate: doc.rateDate,
  fetchedAt: doc.fetchedAt.toISOString(),
});

async function fetchFromProvider(): Promise<{ rate: number; rateDate: string }> {
  const res = await fetch(SOURCE_URL, {
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Provider responded ${res.status}`);

  const body = await res.text();
  if (body.length > MAX_BODY_BYTES) throw new Error('Provider response too large');

  const parsed = responseSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new Error('Provider response failed validation');

  return { rate: parsed.data.rates.PHP, rateDate: parsed.data.date };
}

/** Fetch and store a fresh rate. Only one fetch runs at a time per process. */
function refresh(): Promise<UsdPhpRate | null> {
  if (inFlight) return inFlight;
  if (Date.now() - lastFailureAt < RETRY_COOLDOWN_MS) {
    return Promise.resolve(null);
  }

  inFlight = (async () => {
    try {
      const { rate, rateDate } = await fetchFromProvider();
      const doc = await ExchangeRate.findOneAndUpdate(
        { pair: PAIR },
        { $set: { rate, rateDate, fetchedAt: new Date() } },
        { upsert: true, new: true }
      ).lean();
      return doc ? toDto(doc) : null;
    } catch (error) {
      lastFailureAt = Date.now();
      logger.warn('[exchangeRate] USD->PHP refresh failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Today's USD->PHP rate. Serves the stored rate straight away and refreshes it
 * in the background when it is older than 12 hours; only the very first call
 * (nothing stored yet) waits for the provider. If the provider is down, the
 * last good rate keeps being served.
 */
export async function getUsdPhpRate(): Promise<UsdPhpRate> {
  const stored = await ExchangeRate.findOne({ pair: PAIR }).lean();

  if (stored) {
    if (Date.now() - stored.fetchedAt.getTime() > STALE_AFTER_MS) {
      void refresh();
    }
    return toDto(stored);
  }

  const fresh = await refresh();
  if (!fresh) {
    throw new AppError(
      503,
      'EXCHANGE_RATE_UNAVAILABLE',
      'Exchange rate is temporarily unavailable'
    );
  }
  return fresh;
}
