import mongoose from 'mongoose';
import AppError from '../../shared/utils/AppError';
import EodReminder from './eodReminder.model';
import type { CreateEodReminderInput, IEodReminder } from './eodReminder.types';

export const getAllEodReminders = async (filters: {
  assignmentId?: string;
  candidateId?: string;
  status?: string;
  /** Extra Mongo condition, e.g. an account manager's own assignments. */
  scope?: Record<string, unknown>;
  page?: number;
  limit?: number;
}): Promise<{
  eodReminders: IEodReminder[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const {
    assignmentId,
    candidateId,
    status,
    scope,
    page = 1,
    limit = 20,
  } = filters;
  const query: Record<string, unknown> = {};
  if (scope) query['$and'] = [scope];

  if (assignmentId !== undefined)
    query['assignmentId'] = new mongoose.Types.ObjectId(assignmentId);
  if (candidateId !== undefined)
    query['candidateId'] = new mongoose.Types.ObjectId(candidateId);
  if (status !== undefined) query['status'] = status;

  const skip = (page - 1) * limit;
  const [eodReminders, total] = await Promise.all([
    EodReminder.find(query).sort({ reminderDate: -1 }).skip(skip).limit(limit),
    EodReminder.countDocuments(query),
  ]);

  return {
    eodReminders: eodReminders.map(r => r.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getEodReminderById = async (id: string): Promise<IEodReminder> => {
  const eodReminder = await EodReminder.findById(id);
  if (!eodReminder)
    throw new AppError(404, 'EOD_REMINDER_NOT_FOUND', 'EOD reminder not found');
  return eodReminder.toSafeObject();
};

export const createEodReminder = async (
  input: CreateEodReminderInput
): Promise<IEodReminder> => {
  const eodReminder = await EodReminder.create({
    assignmentId: new mongoose.Types.ObjectId(input.assignmentId),
    candidateId: new mongoose.Types.ObjectId(input.candidateId),
    reminderDate: input.reminderDate,
    reminderType: input.reminderType,
    status: input.status,
  });
  return eodReminder.toSafeObject();
};
