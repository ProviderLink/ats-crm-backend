import mongoose from 'mongoose';
import AppError from '../../shared/utils/AppError';
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
    page = 1,
    limit = 20,
  } = filters;
  const query: Record<string, unknown> = {};

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
  input: CreateSurveyReminderInput
): Promise<ISurveyReminder> => {
  const surveyReminder = await SurveyReminder.create({
    relatedType: input.relatedType,
    relatedId: new mongoose.Types.ObjectId(input.relatedId),
    surveyType: input.surveyType,
    dueDate: new Date(input.dueDate),
    assignedTo: new mongoose.Types.ObjectId(input.assignedTo),
  });
  return surveyReminder.toSafeObject();
};

export const createAssignmentReminders = async (
  assignmentId: string,
  startDate: Date,
  accountManagerId: string
): Promise<void> => {
  const reminders = [30, 60, 90].map(days => ({
    relatedType: 'assignment',
    relatedId: new mongoose.Types.ObjectId(assignmentId),
    surveyType: `${days}_day`,
    dueDate: new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000),
    assignedTo: new mongoose.Types.ObjectId(accountManagerId),
  }));
  await SurveyReminder.insertMany(reminders);
};

export const updateSurveyReminder = async (
  id: string,
  input: UpdateSurveyReminderInput
): Promise<ISurveyReminder> => {
  const surveyReminder = await SurveyReminder.findById(id);
  if (!surveyReminder)
    throw new AppError(
      404,
      'SURVEY_REMINDER_NOT_FOUND',
      'Survey reminder not found'
    );

  if (input.status !== undefined) surveyReminder.status = input.status;
  if (input.completedDate !== undefined)
    surveyReminder.completedDate = input.completedDate ?? null;
  if (input.dueDate !== undefined)
    surveyReminder.dueDate = new Date(input.dueDate);
  if (input.assignedTo !== undefined)
    surveyReminder.assignedTo = new mongoose.Types.ObjectId(input.assignedTo);

  await surveyReminder.save();
  return surveyReminder.toSafeObject();
};
