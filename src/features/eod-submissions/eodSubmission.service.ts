import mongoose from 'mongoose';
import AppError from '../../shared/utils/AppError';
import { emitToCrm } from '../../sockets';
import { createLog } from '../activity-logs/activityLog.service';
import Assignment from '../assignments/assignment.model';
import EodSubmission from './eodSubmission.model';
import type {
  CreateEodSubmissionInput,
  IEodSubmission,
  UpdateEodSubmissionInput,
} from './eodSubmission.types';

export const getAllEodSubmissions = async (filters: {
  assignmentId?: string;
  candidateId?: string;
  clientId?: string;
  date?: string;
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
  if (date !== undefined) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    query['date'] = { $gte: start, $lte: end };
  }

  const skip = (page - 1) * limit;
  const [eodSubmissions, total] = await Promise.all([
    EodSubmission.find(query).sort({ date: -1 }).skip(skip).limit(limit),
    EodSubmission.countDocuments(query),
  ]);

  return {
    eodSubmissions: eodSubmissions.map(e => e.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getEodSubmissionById = async (
  id: string
): Promise<IEodSubmission> => {
  const eodSubmission = await EodSubmission.findById(id);
  if (!eodSubmission)
    throw new AppError(404, 'EOD_NOT_FOUND', 'EOD submission not found');
  return eodSubmission.toSafeObject();
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

  const submissionDate = new Date(input.date);
  submissionDate.setHours(0, 0, 0, 0);
  const nextDay = new Date(submissionDate);
  nextDay.setDate(nextDay.getDate() + 1);

  const existing = await EodSubmission.findOne({
    assignmentId: input.assignmentId,
    date: { $gte: submissionDate, $lt: nextDay },
  });
  if (existing)
    throw new AppError(
      409,
      'EOD_ALREADY_SUBMITTED',
      'EOD already submitted for this assignment today'
    );

  const eodSubmission = await EodSubmission.create({
    assignmentId: new mongoose.Types.ObjectId(input.assignmentId),
    candidateId: assignment.candidateId,
    clientId: assignment.clientId,
    date: submissionDate,
    shiftStart: input.shiftStart,
    shiftEnd: input.shiftEnd,
    hoursWorked: input.hoursWorked,
    summaryOfWork: input.summaryOfWork,
    pendingTasks: input.pendingTasks,
    blockers: input.blockers ?? null,
    notes: input.notes ?? null,
  });

  emitToCrm('assignments', 'eod:submitted', {
    eodId: eodSubmission._id.toString(),
    assignmentId: input.assignmentId,
    candidateId: String(assignment.candidateId),
    clientId: String(assignment.clientId),
  });

  createLog({
    type: 'eod_submitted',
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
  if (input.hoursWorked !== undefined)
    eodSubmission.hoursWorked = input.hoursWorked;
  if (input.summaryOfWork !== undefined)
    eodSubmission.summaryOfWork = input.summaryOfWork;
  if (input.pendingTasks !== undefined)
    eodSubmission.pendingTasks = input.pendingTasks;
  if (input.blockers !== undefined)
    eodSubmission.blockers = input.blockers ?? null;
  if (input.notes !== undefined) eodSubmission.notes = input.notes ?? null;

  await eodSubmission.save();
  const result = eodSubmission.toSafeObject();
  emitToCrm('assignments', 'eod:updated', result);
  return result;
};
