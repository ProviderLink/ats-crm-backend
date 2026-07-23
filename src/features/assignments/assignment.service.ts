import mongoose from 'mongoose';
import AppError from '../../shared/utils/AppError';
import { emitToCrm } from '../../sockets';
import { createLog } from '../activity-logs/activityLog.service';
import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
import { createAssignmentReminders } from '../survey-reminders/surveyReminder.service';
import * as userService from '../users/user.service';
import Assignment from './assignment.model';
import type {
  CreateAssignmentInput,
  IAssignment,
  UpdateAssignmentInput,
} from './assignment.types';

export const getAllAssignments = async (filters: {
  candidateId?: string;
  clientId?: string;
  accountManagerId?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{
  assignments: IAssignment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const {
    candidateId,
    clientId,
    accountManagerId,
    status,
    page = 1,
    limit = 20,
  } = filters;
  const query: Record<string, unknown> = {};

  if (candidateId !== undefined)
    query['candidateId'] = new mongoose.Types.ObjectId(candidateId);
  if (clientId !== undefined)
    query['clientId'] = new mongoose.Types.ObjectId(clientId);
  if (accountManagerId !== undefined)
    query['accountManagerId'] = new mongoose.Types.ObjectId(accountManagerId);
  if (status !== undefined) query['status'] = status;

  const skip = (page - 1) * limit;
  const [assignments, total] = await Promise.all([
    Assignment.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Assignment.countDocuments(query),
  ]);

  return {
    assignments: assignments.map(a => a.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getAssignmentById = async (id: string): Promise<IAssignment> => {
  const assignment = await Assignment.findById(id);
  if (!assignment)
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found');
  return assignment.toSafeObject();
};

export const createAssignment = async (
  input: CreateAssignmentInput,
  createdBy: string
): Promise<IAssignment> => {
  const candidate = await Candidate.findById(input.candidateId);
  if (!candidate)
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');

  const client = await Client.findById(input.clientId);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  const assignment = await Assignment.create({
    candidateId: new mongoose.Types.ObjectId(input.candidateId),
    clientId: new mongoose.Types.ObjectId(input.clientId),
    serviceType: input.serviceType,
    status: input.status ?? 'active',
    startDate: new Date(input.startDate),
    endDate: input.endDate ? new Date(input.endDate) : null,
    accountManagerId: new mongoose.Types.ObjectId(input.accountManagerId),
    notes: input.notes ?? null,
    createdBy: new mongoose.Types.ObjectId(createdBy),
  });

  const primaryContact = client.contacts.find(
    (c: { isPrimary: boolean }) => c.isPrimary
  );
  const clientEmail = primaryContact?.email ?? client.email;
  const firstName = primaryContact?.name?.split(' ')[0] ?? 'Client';
  const lastName = primaryContact?.name?.split(' ').slice(1).join(' ') ?? '';

  const { inviteToken } = await userService.provisionClient(
    String(client._id),
    firstName,
    lastName,
    clientEmail
  );

  if (inviteToken !== null) {
    userService
      .sendTeamMemberInvite({
        email: clientEmail,
        firstName,
        inviteToken,
        invitedByName: 'CRM System',
      })
      .catch(err => {
        console.error('Failed to send client invite email:', err);
      });
  }

  createAssignmentReminders(
    assignment._id.toString(),
    new Date(input.startDate),
    input.accountManagerId
  );

  createLog({
    action: 'created',
    resourceType: 'assignment',
    resourceId: assignment._id.toString(),
    relatedType: 'candidate',
    relatedId: input.candidateId,
    performedBy: createdBy,
  });

  const result = assignment.toSafeObject();
  emitToCrm('assignments', 'assignment:created', result);
  return result;
};

export const updateAssignment = async (
  id: string,
  input: UpdateAssignmentInput,
  updatedBy: string,
  userRoles: string[] = []
): Promise<IAssignment> => {
  const assignment = await Assignment.findById(id);
  if (!assignment)
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found');

  // Account managers can only manage assignments they are assigned to
  if (
    !userRoles.includes('admin') &&
    userRoles.includes('account_manager') &&
    String(assignment.accountManagerId) !== updatedBy
  ) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'You can only manage assignments assigned to you'
    );
  }

  if (assignment.status === 'ended') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Cannot update an ended assignment'
    );
  }

  const changes: string[] = [];

  if (
    input.serviceType !== undefined &&
    input.serviceType !== assignment.serviceType
  ) {
    changes.push(
      `Service type changed from "${assignment.serviceType}" to "${input.serviceType}"`
    );
    assignment.serviceType = input.serviceType;
  } else if (input.serviceType !== undefined) {
    assignment.serviceType = input.serviceType;
  }
  if (input.startDate !== undefined) {
    changes.push('Start date updated');
    assignment.startDate = new Date(input.startDate);
  }
  if (input.endDate !== undefined) {
    changes.push(input.endDate ? 'End date updated' : 'End date removed');
    assignment.endDate = input.endDate ? new Date(input.endDate) : null;
  }
  if (
    input.accountManagerId !== undefined &&
    String(assignment.accountManagerId) !== input.accountManagerId
  ) {
    changes.push('Account manager changed');
    assignment.accountManagerId = new mongoose.Types.ObjectId(
      input.accountManagerId
    );
  } else if (input.accountManagerId !== undefined) {
    assignment.accountManagerId = new mongoose.Types.ObjectId(
      input.accountManagerId
    );
  }
  if (input.notes !== undefined) {
    changes.push('Notes updated');
    assignment.notes = input.notes ?? null;
  }
  if (input.status !== undefined && input.status !== assignment.status) {
    changes.push(
      `Status changed from "${assignment.status}" to "${input.status}"`
    );
    assignment.status = input.status;
  } else if (input.status !== undefined) {
    assignment.status = input.status;
  }

  assignment.updatedBy = new mongoose.Types.ObjectId(updatedBy);
  await assignment.save();

  createLog({
    action: 'updated',
    resourceType: 'assignment',
    resourceId: id,
    relatedType: 'candidate',
    relatedId: String(assignment.candidateId),
    metadata: changes.length > 0 ? { changes } : {},
    performedBy: updatedBy,
  });

  const result = assignment.toSafeObject();
  emitToCrm('assignments', 'assignment:updated', result);
  return result;
};

export const endAssignment = async (
  id: string,
  updatedBy: string,
  userRoles: string[] = []
): Promise<IAssignment> => {
  const assignment = await Assignment.findById(id);
  if (!assignment)
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found');

  // Account managers can only manage assignments they are assigned to
  if (
    !userRoles.includes('admin') &&
    userRoles.includes('account_manager') &&
    String(assignment.accountManagerId) !== updatedBy
  ) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'You can only manage assignments assigned to you'
    );
  }

  if (assignment.status === 'ended') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Assignment is already ended');
  }

  assignment.status = 'ended';
  if (!assignment.endDate) assignment.endDate = new Date();
  assignment.updatedBy = new mongoose.Types.ObjectId(updatedBy);
  await assignment.save();

  createLog({
    action: 'ended',
    resourceType: 'assignment',
    resourceId: id,
    performedBy: updatedBy,
  });

  const result = assignment.toSafeObject();
  emitToCrm('assignments', 'assignment:updated', result);
  return result;
};

export const updateAssignmentStatus = async (
  id: string,
  status: 'active' | 'on_hold',
  updatedBy: string
): Promise<IAssignment> => {
  const assignment = await Assignment.findById(id);
  if (!assignment)
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found');

  if (assignment.status === 'ended') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Cannot change status of ended assignment'
    );
  }

  const previousStatus = assignment.status;
  assignment.status = status;
  assignment.updatedBy = new mongoose.Types.ObjectId(updatedBy);
  await assignment.save();

  createLog({
    action: 'status_changed',
    resourceType: 'assignment',
    resourceId: id,
    relatedType: 'candidate',
    relatedId: String(assignment.candidateId),
    metadata: { from: previousStatus, to: status },
    performedBy: updatedBy,
  });

  const result = assignment.toSafeObject();
  emitToCrm('assignments', 'assignment:updated', result);
  return result;
};
