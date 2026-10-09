import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { scopeListFilters } from '../../shared/utils/crmScope';
import { sendSuccess } from '../../shared/utils/response';
import { assertOwnsAssignment, assignmentScope } from '../assignments/assignmentScope';
import * as workEntryService from './workEntry.service';

export const getAllWorkEntries = catchAsync(
  async (req: Request, res: Response) => {
    const {
      assignmentId,
      candidateId,
      clientId,
      entryDate,
      dateFrom,
      dateTo,
      page,
      limit,
    } = req.query as Record<string, string | undefined>;
    const user = req.user!;

    // A VA sees only their own entries, a client only their VAs'
    const scoped = scopeListFilters(user, { candidateId, clientId });

    const result = await workEntryService.getAllWorkEntries({
      assignmentId,
      candidateId: scoped.candidateId,
      clientId: scoped.clientId,
      scope: await assignmentScope(user),
      entryDate,
      dateFrom,
      dateTo,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    sendSuccess(res, result.workEntries, 'Work entries retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);

export const getWorkEntryById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const workEntry = await workEntryService.getWorkEntryById(id, req.user!);
    await assertOwnsAssignment(req.user!, workEntry.assignmentId);
    sendSuccess(res, workEntry, 'Work entry retrieved', 200);
  }
);

export const createWorkEntry = catchAsync(
  async (req: Request, res: Response) => {
    const body = req.body;
    const createdBy = req.user!._id;
    const workEntry = await workEntryService.createWorkEntry(
      body,
      createdBy,
      req.user!
    );
    sendSuccess(res, workEntry, 'Work entry created', 201);
  }
);

export const updateWorkEntry = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;
    const updatedBy = req.user!._id;
    const workEntry = await workEntryService.updateWorkEntry(
      id,
      body,
      updatedBy,
      req.user!
    );
    sendSuccess(res, workEntry, 'Work entry updated', 200);
  }
);

export const deleteWorkEntry = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await workEntryService.deleteWorkEntry(id, req.user!);
    sendSuccess(res, { deleted: true }, 'Work entry deleted', 200);
  }
);
