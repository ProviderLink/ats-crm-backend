import mongoose from 'mongoose';
import AppError from '../../shared/utils/AppError';
import {
  assertOwnsCandidate,
  assertOwnsRecord,
  type CrmActor,
} from '../../shared/utils/crmScope';
import { emitToCrm } from '../../sockets';
import { createLog } from '../activity-logs/activityLog.service';
import Assignment from '../assignments/assignment.model';
import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
import WorkEntry from './workEntry.model';
import type {
  CreateWorkEntryInput,
  IWorkEntry,
  UpdateWorkEntryInput,
} from './workEntry.types';

export const getAllWorkEntries = async (filters: {
  assignmentId?: string;
  candidateId?: string;
  clientId?: string;
  /** Extra Mongo condition, e.g. an account manager's own assignments. */
  scope?: Record<string, unknown>;
  entryDate?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}): Promise<{
  workEntries: IWorkEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const {
    assignmentId,
    candidateId,
    clientId,
    scope,
    entryDate,
    dateFrom,
    dateTo,
    page = 1,
    limit = 20,
  } = filters;
  const query: Record<string, unknown> = {};
  // Always exclude soft-deleted entries
  query['isDeleted'] = { $ne: true };
  if (scope) query['$and'] = [scope];

  if (assignmentId !== undefined)
    query['assignmentId'] = new mongoose.Types.ObjectId(assignmentId);
  if (candidateId !== undefined)
    query['candidateId'] = new mongoose.Types.ObjectId(candidateId);
  if (clientId !== undefined)
    query['clientId'] = new mongoose.Types.ObjectId(clientId);
  if (entryDate !== undefined) {
    const start = new Date(entryDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(entryDate);
    end.setHours(23, 59, 59, 999);
    query['entryDate'] = { $gte: start, $lte: end };
  } else if (dateFrom !== undefined || dateTo !== undefined) {
    const range: Record<string, Date> = {};
    if (dateFrom !== undefined) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      range['$gte'] = from;
    }
    if (dateTo !== undefined) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      range['$lte'] = to;
    }
    query['entryDate'] = range;
  }

  const skip = (page - 1) * limit;
  const [workEntries, total] = await Promise.all([
    WorkEntry.find(query)
      .sort({ entryDate: -1, entryTime: 1 })
      .skip(skip)
      .limit(limit),
    WorkEntry.countDocuments(query),
  ]);

  const candidateIds = [
    ...new Set(workEntries.map(e => String(e.candidateId))),
  ];
  const clientIds = [...new Set(workEntries.map(e => String(e.clientId)))];

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
    workEntries: workEntries.map(e => ({
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

export const getWorkEntryById = async (
  id: string,
  actor?: CrmActor
): Promise<IWorkEntry> => {
  const workEntry = await WorkEntry.findById(id);
  if (!workEntry)
    throw new AppError(404, 'WORK_ENTRY_NOT_FOUND', 'Work entry not found');
  if (actor) assertOwnsRecord(actor, workEntry);
  return workEntry.toSafeObject();
};

export const createWorkEntry = async (
  input: CreateWorkEntryInput,
  createdBy: string,
  actor?: CrmActor
): Promise<IWorkEntry> => {
  const assignment = await Assignment.findById(input.assignmentId);
  if (!assignment)
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found');
  if (actor) assertOwnsCandidate(actor, assignment.candidateId);
  if (assignment.status === 'ended') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Cannot add work entries to an ended assignment'
    );
  }

  const workEntry = await WorkEntry.create({
    assignmentId: new mongoose.Types.ObjectId(input.assignmentId),
    candidateId: assignment.candidateId,
    clientId: assignment.clientId,
    entryDate: new Date(input.entryDate),
    entryTime: input.entryTime,
    taskCategory: input.taskCategory,
    taskDescription: input.taskDescription,
    timeSpent: input.timeSpent,
    status: input.status ?? 'completed',
    notes: input.notes ?? null,
  });

  createLog({
    action: 'created',
    resourceType: 'work_entry',
    resourceId: workEntry._id.toString(),
    performedBy: createdBy,
  });

  const result = workEntry.toSafeObject();
  emitToCrm('assignments', 'workEntry:created', result);
  return result;
};

export const updateWorkEntry = async (
  id: string,
  input: UpdateWorkEntryInput,
  updatedBy: string,
  actor?: CrmActor
): Promise<IWorkEntry> => {
  void updatedBy;
  const workEntry = await WorkEntry.findById(id);
  if (!workEntry)
    throw new AppError(404, 'WORK_ENTRY_NOT_FOUND', 'Work entry not found');
  if (actor) assertOwnsCandidate(actor, workEntry.candidateId);

  if (input.entryDate !== undefined)
    workEntry.entryDate = new Date(input.entryDate);
  if (input.entryTime !== undefined) workEntry.entryTime = input.entryTime;
  if (input.taskCategory !== undefined)
    workEntry.taskCategory = input.taskCategory;
  if (input.taskDescription !== undefined)
    workEntry.taskDescription = input.taskDescription;
  if (input.timeSpent !== undefined) workEntry.timeSpent = input.timeSpent;
  if (input.status !== undefined) workEntry.status = input.status;
  if (input.notes !== undefined) workEntry.notes = input.notes ?? null;

  await workEntry.save();

  createLog({
    action: 'updated',
    resourceType: 'work_entry',
    resourceId: id,
    performedBy: updatedBy,
  });

  const result = workEntry.toSafeObject();
  emitToCrm('assignments', 'workEntry:updated', result);
  return result;
};

export const deleteWorkEntry = async (
  id: string,
  actor?: CrmActor
): Promise<{ deleted: boolean }> => {
  const workEntry = await WorkEntry.findById(id);
  if (!workEntry)
    throw new AppError(404, 'WORK_ENTRY_NOT_FOUND', 'Work entry not found');
  if (actor) assertOwnsCandidate(actor, workEntry.candidateId);

  // Soft-delete: mark as deleted instead of removing from DB
  workEntry.isDeleted = true;
  workEntry.deletedAt = new Date();
  await workEntry.save();

  createLog({
    action: 'deleted',
    resourceType: 'work_entry',
    resourceId: id,
  });

  emitToCrm('assignments', 'workEntry:deleted', { _id: id });
  return { deleted: true };
};
