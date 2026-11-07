import type { Request } from 'express';
import AppError from './AppError';

/** ATS roles that may manage every interview and scorecard. */
const MANAGING_ROLES = ['admin', 'hiring_manager', 'recruiter', 'coordinator'];

/**
 * True for someone whose only ATS role is "interviewer". They may act only on
 * the interviews they sit on and on their own scorecards.
 */
export function isInterviewerOnly(req: Request): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  return (
    roles.includes('interviewer') &&
    !roles.some(role => MANAGING_ROLES.includes(role))
  );
}

/** Throws 403 unless `userId` is one of `allowedIds`. */
export function assertOneOf(
  userId: string,
  allowedIds: Array<unknown>,
  message: string
): void {
  if (!allowedIds.some(id => id != null && String(id) === String(userId))) {
    throw new AppError(403, 'FORBIDDEN', message);
  }
}
