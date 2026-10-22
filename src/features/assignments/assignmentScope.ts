import mongoose from 'mongoose';
import AppError from '../../shared/utils/AppError';
import Assignment from './assignment.model';

interface Actor {
  _id: string;
  roles: string[];
}

/** An account manager (not an admin) sees only the assignments they manage. */
export const isAccountManagerOnly = (user: Actor): boolean =>
  user.roles.includes('account_manager') && !user.roles.includes('admin');

const forbidden = () =>
  new AppError(
    403,
    'AUTH_INSUFFICIENT_PERMISSIONS',
    'This record belongs to another account manager'
  );

const ownAssignments = (user: Actor) =>
  Assignment.find({
    accountManagerId: new mongoose.Types.ObjectId(user._id),
  }).select('candidateId clientId');

/**
 * Mongo condition limiting a query on an `assignmentId` field to the caller's
 * own assignments. `undefined` for everyone who is not an account manager.
 */
export async function assignmentScope(
  user: Actor
): Promise<Record<string, unknown> | undefined> {
  if (!isAccountManagerOnly(user)) return undefined;
  const ids = (await ownAssignments(user)).map(a => a._id);
  return { assignmentId: { $in: ids } };
}

/**
 * Same, for records keyed by a (candidate, client) pair instead of an
 * assignment id, e.g. performance reviews.
 */
export async function pairScope(
  user: Actor
): Promise<Record<string, unknown> | undefined> {
  if (!isAccountManagerOnly(user)) return undefined;
  const pairs = (await ownAssignments(user)).map(a => ({
    candidateId: a.candidateId,
    clientId: a.clientId,
  }));
  return pairs.length > 0 ? { $or: pairs } : { _id: { $in: [] } };
}

/** The assignment itself must be managed by the caller. */
export function assertManagesAssignment(
  user: Actor,
  assignment: { accountManagerId?: unknown }
): void {
  if (!isAccountManagerOnly(user)) return;
  if (String(assignment.accountManagerId) !== String(user._id)) {
    throw forbidden();
  }
}

/** A record that points at an assignment (work entry, EOD, reminder...). */
export async function assertOwnsAssignment(
  user: Actor,
  assignmentId: unknown
): Promise<void> {
  if (!isAccountManagerOnly(user)) return;
  const owned = await Assignment.exists({
    _id: assignmentId,
    accountManagerId: new mongoose.Types.ObjectId(user._id),
  });
  if (!owned) throw forbidden();
}

/** A record keyed by candidate + client (performance reviews). */
export async function assertOwnsPair(
  user: Actor,
  candidateId: unknown,
  clientId: unknown
): Promise<void> {
  if (!isAccountManagerOnly(user)) return;
  const owned = await Assignment.exists({
    candidateId,
    clientId,
    accountManagerId: new mongoose.Types.ObjectId(user._id),
  });
  if (!owned) throw forbidden();
}

/** An account manager may only act on a VA they manage. */
export async function assertManagesCandidate(
  user: Actor,
  candidateId: unknown
): Promise<void> {
  if (!isAccountManagerOnly(user)) return;
  const owned = await Assignment.exists({
    candidateId,
    accountManagerId: new mongoose.Types.ObjectId(user._id),
  });
  if (!owned) throw forbidden();
}

/** An account manager may only act on a client they manage. */
export async function assertManagesClient(
  user: Actor,
  clientId: unknown
): Promise<void> {
  if (!isAccountManagerOnly(user)) return;
  const owned = await Assignment.exists({
    clientId,
    accountManagerId: new mongoose.Types.ObjectId(user._id),
  });
  if (!owned) throw forbidden();
}

/**
 * Survey reminders reach an account manager when they are assigned to them or
 * relate to one of their assignments, VAs or clients. `undefined` for anyone
 * who is not an account manager.
 */
export async function reminderScope(
  user: Actor
): Promise<Record<string, unknown> | undefined> {
  if (!isAccountManagerOnly(user)) return undefined;
  const own = await ownAssignments(user);
  const relatedIds = own.flatMap(a => [a._id, a.candidateId, a.clientId]);
  return {
    $or: [
      { assignedTo: new mongoose.Types.ObjectId(user._id) },
      { relatedId: { $in: relatedIds } },
    ],
  };
}

/** The reminder must fall inside the caller's `reminderScope`. */
export async function assertOwnsReminder(
  user: Actor,
  reminder: { relatedId: unknown; assignedTo?: unknown }
): Promise<void> {
  if (!isAccountManagerOnly(user)) return;
  if (String(reminder.assignedTo) === String(user._id)) return;
  const own = await ownAssignments(user);
  const related = String(reminder.relatedId);
  const matches = own.some(a =>
    [a._id, a.candidateId, a.clientId].some(id => String(id) === related)
  );
  if (!matches) throw forbidden();
}

/**
 * The VAs and clients an account manager manages (through any of their
 * assignments). `undefined` for anyone who is not an account manager.
 */
export async function managedIds(
  user: Actor
): Promise<{ candidateIds: unknown[]; clientIds: unknown[] } | undefined> {
  if (!isAccountManagerOnly(user)) return undefined;
  const own = await ownAssignments(user);
  return {
    candidateIds: [...new Set(own.map(a => String(a.candidateId)))].map(
      id => new mongoose.Types.ObjectId(id)
    ),
    clientIds: [...new Set(own.map(a => String(a.clientId)))].map(
      id => new mongoose.Types.ObjectId(id)
    ),
  };
}

