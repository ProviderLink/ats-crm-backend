import AppError from './AppError';

export interface CrmActor {
  roles: string[];
  candidateRef?: string | null;
  clientRef?: string | null;
}

const forbidden = () =>
  new AppError(
    403,
    'AUTH_INSUFFICIENT_PERMISSIONS',
    'You do not have access to this record'
  );

/** Admins and account managers see every CRM record. */
const isStaff = (actor: CrmActor): boolean =>
  actor.roles.includes('admin') || actor.roles.includes('account_manager');

/** A VA owns records of their own candidate; a client owns their own client's. */
export function assertOwnsRecord(
  actor: CrmActor,
  record: { candidateId?: unknown; clientId?: unknown }
): void {
  if (isStaff(actor)) return;
  const sameCandidate =
    actor.roles.includes('va') &&
    !!actor.candidateRef &&
    record.candidateId !== undefined &&
    String(record.candidateId) === String(actor.candidateRef);
  const sameClient =
    actor.roles.includes('client') &&
    !!actor.clientRef &&
    record.clientId !== undefined &&
    String(record.clientId) === String(actor.clientRef);
  if (!sameCandidate && !sameClient) throw forbidden();
}

/** Same as assertOwnsRecord for endpoints keyed by a candidate (VA) id. */
export function assertOwnsCandidate(
  actor: CrmActor,
  candidateId: unknown
): void {
  assertOwnsRecord(actor, { candidateId });
}

/**
 * Narrow a list query to what the caller may see. Staff pass their filters
 * through; a VA or client is pinned to their own ref. A VA/client without a
 * ref gets nothing, rather than falling back to whatever id they sent.
 */
export function scopeListFilters(
  actor: CrmActor,
  filters: { candidateId?: string; clientId?: string }
): { candidateId?: string; clientId?: string } {
  if (isStaff(actor)) return filters;
  if (actor.roles.includes('va')) {
    if (!actor.candidateRef) throw forbidden();
    return { ...filters, candidateId: actor.candidateRef };
  }
  if (actor.roles.includes('client')) {
    if (!actor.clientRef) throw forbidden();
    return { ...filters, clientId: actor.clientRef };
  }
  throw forbidden();
}
