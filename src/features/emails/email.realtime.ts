import logger from '../../shared/utils/logger';
import { emitToAts } from '../../sockets';
import type { IEmail } from './email.types';

type EmailDoc = { toSafeObject: () => IEmail };

/**
 * Push an email change to connected ATS clients.
 *
 * Called AFTER the database write has succeeded, and it must never fail the
 * request or webhook that triggered it — so every error is swallowed and only
 * logged. Clients that miss the event catch up on their next reconnect refetch.
 */
export const broadcastEmail = (
  event: 'email:created' | 'email:updated',
  email: EmailDoc
): void => {
  try {
    emitToAts('emails', event, email.toSafeObject());
  } catch (error) {
    logger.warn(`Realtime ${event} failed: ${(error as Error).message}`);
  }
};
