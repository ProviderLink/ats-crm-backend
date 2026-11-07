import mongoose from 'mongoose';
import AppError from '../../shared/utils/AppError';
import { createLog } from '../activity-logs/activityLog.service';
import Assignment from '../assignments/assignment.model';
import SurveyReminder from './surveyReminder.model';
import type {
  CreateSurveyReminderInput,
  ISurveyReminder,
  UpdateSurveyReminderInput,
} from './surveyReminder.types';

export const getAllSurveyReminders = async (filters: {
  relatedType?: string;
  relatedId?: string;
  status?: string;
  assignedTo?: string;
  /** Extra Mongo conditions, e.g. an account manager's reminder scope. */
  scope?: Record<string, unknown>;
  page?: number;
  limit?: number;
}): Promise<{
  surveyReminders: ISurveyReminder[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const {
    relatedType,
    relatedId,
    status,
    assignedTo,
    scope,
    page = 1,
    limit = 20,
  } = filters;
  const query: Record<string, unknown> = { ...scope };

  if (relatedType !== undefined) query['relatedType'] = relatedType;
  if (relatedId !== undefined)
    query['relatedId'] = new mongoose.Types.ObjectId(relatedId);
  if (status !== undefined) query['status'] = status;
  if (assignedTo !== undefined)
    query['assignedTo'] = new mongoose.Types.ObjectId(assignedTo);

  const skip = (page - 1) * limit;
  const [surveyReminders, total] = await Promise.all([
    SurveyReminder.find(query).sort({ dueDate: 1 }).skip(skip).limit(limit),
    SurveyReminder.countDocuments(query),
  ]);

  return {
    surveyReminders: surveyReminders.map(r => r.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getSurveyReminderById = async (
  id: string
): Promise<ISurveyReminder> => {
  const surveyReminder = await SurveyReminder.findById(id);
  if (!surveyReminder)
    throw new AppError(
      404,
      'SURVEY_REMINDER_NOT_FOUND',
      'Survey reminder not found'
    );
  return surveyReminder.toSafeObject();
};

export const createSurveyReminder = async (
  input: CreateSurveyReminderInput,
  createdBy?: string | null
): Promise<ISurveyReminder> => {
  const surveyReminder = await SurveyReminder.create({
    relatedType: input.relatedType,
    relatedId: new mongoose.Types.ObjectId(input.relatedId),
    surveyType: input.surveyType,
    dueDate: new Date(input.dueDate),
    assignedTo: new mongoose.Types.ObjectId(input.assignedTo),
  });
  createLog({
    action: 'survey_created',
    resourceType: 'survey',
    resourceId: surveyReminder._id.toString(),
    relatedType: input.relatedType,
    relatedId: input.relatedId,
    metadata: { surveyType: input.surveyType, dueDate: input.dueDate },
    performedBy: createdBy ?? null,
  });
  return surveyReminder.toSafeObject();
};

export const createAssignmentReminders = async (
  assignmentId: string,
  startDate: Date,
  accountManagerId: string
): Promise<void> => {
  // Spec: 3-day, 1-week, 30-day, monthly (60-day) check-in schedule
  const reminders = [
    { days: 3, type: '3_day' },
    { days: 7, type: '1_week' },
    { days: 30, type: '30_day' },
    { days: 60, type: 'monthly' },
  ].map(({ days, type }) => ({
    relatedType: 'assignment',
    relatedId: new mongoose.Types.ObjectId(assignmentId),
    surveyType: type,
    dueDate: new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000),
    assignedTo: new mongoose.Types.ObjectId(accountManagerId),
  }));
  await SurveyReminder.insertMany(reminders);
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHLY_DAYS = 30;
/** Day 60 is the last check-in created with the assignment. */
const FIRST_RECURRING_PERIOD = 3;

/** An ended assignment needs no more check-ins. */
export const closeCheckins = async (assignmentId: string): Promise<void> => {
  await SurveyReminder.updateMany(
    {
      relatedType: 'assignment',
      relatedId: new mongoose.Types.ObjectId(assignmentId),
      status: { $in: ['pending', 'sent'] },
    },
    { $set: { status: 'skipped' } }
  );
};

/** Hand an assignment's open check-ins to its new account manager. */
export const reassignCheckins = async (
  assignmentId: string,
  accountManagerId: string
): Promise<void> => {
  await SurveyReminder.updateMany(
    {
      relatedType: 'assignment',
      relatedId: new mongoose.Types.ObjectId(assignmentId),
      status: { $in: ['pending', 'sent'] },
    },
    { $set: { assignedTo: new mongoose.Types.ObjectId(accountManagerId) } }
  );
};

/**
 * Bring check-ins in line with the assignments, once a day before they are sent.
 * Ended assignments have theirs closed, which also catches anything ended
 * before this existed. Active assignments get a monthly check-in every 30 days
 * after day 60. Only the current period is created, so an old assignment gets
 * one check-in rather than a backlog.
 */
export const syncAssignmentCheckins = async (now = new Date()): Promise<void> => {
  const ended = await Assignment.find({ status: 'ended' }).select('_id').lean();
  if (ended.length > 0) {
    await SurveyReminder.updateMany(
      {
        relatedType: 'assignment',
        relatedId: { $in: ended.map(a => a._id) },
        status: { $in: ['pending', 'sent'] },
      },
      { $set: { status: 'skipped' } }
    );
  }

  const active = await Assignment.find({ status: 'active' }).select(
    'startDate accountManagerId'
  );
  for (const assignment of active) {
    const days = (now.getTime() - assignment.startDate.getTime()) / DAY_MS;
    const period = Math.floor(days / MONTHLY_DAYS);
    if (period < FIRST_RECURRING_PERIOD) continue;

    const dueDate = new Date(
      assignment.startDate.getTime() + period * MONTHLY_DAYS * DAY_MS
    );
    const exists = await SurveyReminder.exists({
      relatedType: 'assignment',
      relatedId: assignment._id,
      dueDate,
    });
    if (exists) continue;

    await SurveyReminder.create({
      relatedType: 'assignment',
      relatedId: assignment._id,
      surveyType: 'monthly',
      dueDate,
      assignedTo: assignment.accountManagerId,
    });
  }
};

export const updateSurveyReminder = async (
  id: string,
  input: UpdateSurveyReminderInput,
  updatedBy?: string | null
): Promise<ISurveyReminder> => {
  const surveyReminder = await SurveyReminder.findById(id);
  if (!surveyReminder)
    throw new AppError(
      404,
      'SURVEY_REMINDER_NOT_FOUND',
      'Survey reminder not found'
    );

  const changes: string[] = [];
  if (input.status !== undefined && input.status !== surveyReminder.status) {
    changes.push(
      `Status changed from "${surveyReminder.status}" to "${input.status}"`
    );
  }
  if (input.dueDate !== undefined) changes.push('Due date updated');
  if (
    input.assignedTo !== undefined &&
    input.assignedTo !== String(surveyReminder.assignedTo)
  ) {
    changes.push('Assigned account manager updated');
  }
  if (input.status !== undefined) surveyReminder.status = input.status;
  if (input.completedDate !== undefined)
    surveyReminder.completedDate = input.completedDate ?? null;
  if (input.dueDate !== undefined)
    surveyReminder.dueDate = new Date(input.dueDate);
  if (input.assignedTo !== undefined)
    surveyReminder.assignedTo = new mongoose.Types.ObjectId(input.assignedTo);

  await surveyReminder.save();
  if (changes.length > 0) {
    createLog({
      action: 'survey_updated',
      resourceType: 'survey',
      resourceId: id,
      relatedType: surveyReminder.relatedType,
      relatedId: String(surveyReminder.relatedId),
      metadata: { surveyType: surveyReminder.surveyType, changes },
      performedBy: updatedBy ?? null,
    });
  }
  return surveyReminder.toSafeObject();
};
