import mongoose from 'mongoose';
import AppError from '../../shared/utils/AppError';
import {
  computeShiftHours,
  resolveCompanyDay,
} from '../../shared/utils/companyDay';
import { emitToCrm } from '../../sockets';
import { createLog } from '../activity-logs/activityLog.service';
import Assignment from '../assignments/assignment.model';
import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
import EodSubmission from './eodSubmission.model';
import type {
  CreateEodSubmissionInput,
  IEodSubmission,
  UpdateEodSubmissionInput,
} from './eodSubmission.types';

/**
 * Build a `dateKey` query fragment for the company business-day filters.
 *
 * `dateKey` (not `date`) is the field every day comparison uses, because a
 * `YYYY-MM-DD` string is exactly "which company day" with no timezone
 * ambiguity. Range filters (dateFrom/dateTo) are likewise plain string
 * comparisons, which sort lexicographically for this format.
 */
function buildDateKeyFilter(
  date?: string,
  dateFrom?: string,
  dateTo?: string
): Record<string, string> | undefined {
  if (date) return { $gte: date, $lte: date };

  if (!dateFrom && !dateTo) return undefined;

  const range: Record<string, string> = {};
  if (dateFrom) range['$gte'] = dateFrom;
  if (dateTo) range['$lte'] = dateTo;
  return range;
}

export const getAllEodSubmissions = async (filters: {
  assignmentId?: string;
  candidateId?: string;
  clientId?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}): Promise<{
  eodSubmissions: IEodSubmission[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const {
    assignmentId,
    candidateId,
    clientId,
    date,
    dateFrom,
    dateTo,
    page = 1,
    limit = 20,
  } = filters;
  const query: Record<string, unknown> = {};

  if (assignmentId !== undefined)
    query['assignmentId'] = new mongoose.Types.ObjectId(assignmentId);
  if (candidateId !== undefined)
    query['candidateId'] = new mongoose.Types.ObjectId(candidateId);
  if (clientId !== undefined)
    query['clientId'] = new mongoose.Types.ObjectId(clientId);
  if (date !== undefined || dateFrom !== undefined || dateTo !== undefined) {
    const dateKeyFilter = buildDateKeyFilter(date, dateFrom, dateTo);
    if (dateKeyFilter) query['dateKey'] = dateKeyFilter;
  }

  const skip = (page - 1) * limit;
  const [eodSubmissions, total] = await Promise.all([
    EodSubmission.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    EodSubmission.countDocuments(query),
  ]);

  const candidateIds = [
    ...new Set(eodSubmissions.map(e => String(e.candidateId))),
  ];
  const clientIds = [...new Set(eodSubmissions.map(e => String(e.clientId)))];

  const [candidateDocs, clientDocs] = await Promise.all([
    candidateIds.length > 0
      ? Candidate.find({ _id: { $in: candidateIds } }).select(
          'firstName lastName'
        )
      : [],
    clientIds.length > 0
      ? Client.find({ _id: { $in: clientIds } }).select('companyName')
      : [],
  ]);

  const candidateNameMap: Record<string, string> = Object.fromEntries(
    candidateDocs.map(c => [
      String(c._id),
      `${(c as any).firstName ?? ''} ${(c as any).lastName ?? ''}`.trim(),
    ])
  );
  const clientNameMap: Record<string, string> = Object.fromEntries(
    clientDocs.map(c => [String(c._id), String((c as any).companyName ?? '')])
  );

  return {
    eodSubmissions: eodSubmissions.map(e => ({
      ...e.toSafeObject(),
      candidateName: candidateNameMap[String(e.candidateId)] ?? '',
      companyName: clientNameMap[String(e.clientId)] ?? '',
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getEodSubmissionById = async (
  id: string,
  viewer?: {
    roles: string[];
    candidateRef?: string | null;
    clientRef?: string | null;
  }
): Promise<
  IEodSubmission & { candidateName?: string; companyName?: string }
> => {
  const eodSubmission = await EodSubmission.findById(id);
  if (!eodSubmission)
    throw new AppError(404, 'EOD_NOT_FOUND', 'EOD submission not found');

  // Ownership scoping: admin and account_manager bypass; VA may only view their
  // own EODs (matched by candidateRef); client may only view EODs for their
  // own client (matched by clientRef).
  if (viewer) {
    const isAdmin = viewer.roles.includes('admin');
    const isAM = viewer.roles.includes('account_manager');
    if (!isAdmin && !isAM) {
      const isVa = viewer.roles.includes('va');
      const isClient = viewer.roles.includes('client');
      const ownerMatch =
        (isVa &&
          viewer.candidateRef &&
          String(eodSubmission.candidateId) === String(viewer.candidateRef)) ||
        (isClient &&
          viewer.clientRef &&
          String(eodSubmission.clientId) === String(viewer.clientRef));
      if (!ownerMatch) {
        throw new AppError(
          403,
          'AUTH_INSUFFICIENT_PERMISSIONS',
          'You do not have permission to view this EOD submission'
        );
      }
    }
  }

  // Join candidate + client names so the detail view has full context.
  const [candidateDoc, clientDoc] = await Promise.all([
    Candidate.findById(eodSubmission.candidateId).select('firstName lastName'),
    Client.findById(eodSubmission.clientId).select('companyName'),
  ]);

  const candidateName = candidateDoc
    ? `${(candidateDoc as any).firstName ?? ''} ${
        (candidateDoc as any).lastName ?? ''
      }`.trim()
    : '';
  const companyName = clientDoc
    ? String((clientDoc as any).companyName ?? '')
    : '';

  return {
    ...eodSubmission.toSafeObject(),
    candidateName,
    companyName,
  };
};

/**
 * Company-day context for the EOD submission form.
 *
 * The form must show the company's business day (and name its timezone) rather
 * than the VA's local date, otherwise a VA several hours ahead could be told
 * they are filing for tomorrow. Clients fetch this once and use `dateKey` as
 * the authoritative day.
 */
export const getEodContext = async (): Promise<{
  dateKey: string;
  timezone: string;
}> => {
  const companyDay = await resolveCompanyDay();
  return { dateKey: companyDay.dateKey, timezone: companyDay.timezone };
};

export const createEodSubmission = async (
  input: CreateEodSubmissionInput
): Promise<IEodSubmission> => {
  const assignment = await Assignment.findById(input.assignmentId);
  if (!assignment)
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found');
  if (assignment.status === 'ended') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Cannot submit EOD for an ended assignment'
    );
  }

  // Resolve the company business day. When the client omits `date` (the
  // preferred path) this is the company's *current* day, so a VA in any
  // timezone always files against the day the company is working.
  const companyDay = await resolveCompanyDay(input.date ?? null);

  // Hours are derived from the shift times rather than trusted from the client:
  // the VA's device clock and locale must not influence a reported figure.
  const hoursWorked = computeShiftHours(input.shiftStart, input.shiftEnd);

  // One EOD per assignment per company business day. Matching on `dateKey`
  // makes the guard timezone-proof; the unique index backs it up so a race
  // cannot slip a duplicate through.
  const existing = await EodSubmission.findOne({
    assignmentId: input.assignmentId,
    dateKey: companyDay.dateKey,
  });
  if (existing)
    throw new AppError(
      409,
      'EOD_ALREADY_SUBMITTED',
      `EOD already submitted for this assignment on ${companyDay.dateKey} (company time)`
    );

  const eodSubmission = await EodSubmission.create({
    assignmentId: new mongoose.Types.ObjectId(input.assignmentId),
    candidateId: assignment.candidateId,
    clientId: assignment.clientId,
    date: companyDay.start,
    dateKey: companyDay.dateKey,
    dateTimezone: companyDay.timezone,
    shiftStart: input.shiftStart,
    shiftEnd: input.shiftEnd,
    hoursWorked,
    summaryOfWork: input.summaryOfWork ?? null,
    workEntries: input.workEntries ?? [],
    pendingTasks: input.pendingTasks,
    blockers: input.blockers ?? null,
    notes: input.notes ?? null,
    communicatedWithClient: input.communicatedWithClient ?? null,
    clientNote: input.clientNote ?? null,
  });

  emitToCrm('assignments', 'eod:submitted', {
    eodId: eodSubmission._id.toString(),
    assignmentId: input.assignmentId,
    candidateId: String(assignment.candidateId),
    clientId: String(assignment.clientId),
  });

  createLog({
    action: 'eod_submitted',
    resourceType: 'eod',
    resourceId: eodSubmission._id.toString(),
    relatedType: 'assignment',
    relatedId: input.assignmentId,
  });

  return eodSubmission.toSafeObject();
};

export const updateEodSubmission = async (
  id: string,
  input: UpdateEodSubmissionInput
): Promise<IEodSubmission> => {
  const eodSubmission = await EodSubmission.findById(id);
  if (!eodSubmission)
    throw new AppError(404, 'EOD_NOT_FOUND', 'EOD submission not found');

  if (input.shiftStart !== undefined)
    eodSubmission.shiftStart = input.shiftStart;
  if (input.shiftEnd !== undefined) eodSubmission.shiftEnd = input.shiftEnd;
  // Whenever the shift changes, re-derive the hours server-side so the stored
  // figure stays consistent with the recorded shift times.
  if (input.shiftStart !== undefined || input.shiftEnd !== undefined) {
    eodSubmission.hoursWorked = computeShiftHours(
      eodSubmission.shiftStart,
      eodSubmission.shiftEnd
    );
  } else if (input.hoursWorked !== undefined) {
    eodSubmission.hoursWorked = input.hoursWorked;
  }
  if (input.summaryOfWork !== undefined)
    eodSubmission.summaryOfWork = input.summaryOfWork ?? null;
  if (input.workEntries !== undefined)
    eodSubmission.workEntries = input.workEntries;
  if (input.pendingTasks !== undefined)
    eodSubmission.pendingTasks = input.pendingTasks;
  if (input.blockers !== undefined)
    eodSubmission.blockers = input.blockers ?? null;
  if (input.notes !== undefined) eodSubmission.notes = input.notes ?? null;
  if (input.communicatedWithClient !== undefined)
    eodSubmission.communicatedWithClient = input.communicatedWithClient ?? null;
  if (input.clientNote !== undefined)
    eodSubmission.clientNote = input.clientNote ?? null;

  await eodSubmission.save();
  const result = eodSubmission.toSafeObject();
  emitToCrm('assignments', 'eod:updated', result);
  return result;
};

export const deleteEodSubmission = async (id: string): Promise<void> => {
  const eodSubmission = await EodSubmission.findById(id);
  if (!eodSubmission)
    throw new AppError(404, 'EOD_NOT_FOUND', 'EOD submission not found');

  await EodSubmission.findByIdAndDelete(id);

  createLog({
    action: 'eod_deleted',
    resourceType: 'eod',
    resourceId: id,
    relatedType: 'assignment',
    relatedId: String(eodSubmission.assignmentId),
  });

  emitToCrm('assignments', 'eod:deleted', { eodId: id });
};
