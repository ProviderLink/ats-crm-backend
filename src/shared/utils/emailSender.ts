import { env } from '../../config/env';
import Settings from '../../features/settings/settings.model';
import logger from './logger';

/**
 * Resolves the sender identity used for outbound email.
 *
 * Kept in its own module (mirroring `companyTimezone.ts`) because it reads the
 * settings MODEL directly. Going through `settings.service` would be circular,
 * since the service imports the timezone/AI cache helpers.
 */

export interface EmailSenderIdentity {
  /**
   * The address that actually appears in the `from` header. Pinned to
   * `COMPANY_EMAIL`: Resend only accepts senders on a verified domain, and the
   * inbound webhook can only receive replies for that one mailbox. Letting this
   * be an arbitrary user-supplied address would silently break candidate reply
   * threading, so it is deliberately not configurable.
   */
  fromEmail: string;
  /** Display name only — safe to personalise from Settings. */
  fromName: string;
  /** Header set on every outbound mail so replies reach the inbound mailbox. */
  replyTo: string;
}

const CACHE_TTL_MS = 60_000;

let cached: { value: EmailSenderIdentity; at: number } | null = null;

/** Invalidate the cached identity (call after settings are updated). */
export function clearEmailSenderCache(): void {
  cached = null;
}

/**
 * Resolve the sender identity. Never throws — falls back to the env values so
 * outbound email keeps working even if the settings read fails.
 *
 * Priority: Settings `email.fromName` → `COMPANY_NAME` env. The address and
 * reply-to are always `COMPANY_EMAIL`.
 */
export async function getEmailSenderIdentity(): Promise<EmailSenderIdentity> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const fallback: EmailSenderIdentity = {
    fromEmail: env.COMPANY_EMAIL,
    fromName: env.COMPANY_NAME,
    replyTo: env.COMPANY_EMAIL,
  };

  let value = fallback;

  try {
    const settings = await Settings.getSettings();
    const fromName = settings?.email?.fromName?.trim();
    if (fromName) value = { ...fallback, fromName };
  } catch (error) {
    logger.error('Failed to read email sender settings', { error });
  }

  cached = { value, at: Date.now() };
  return value;
}
