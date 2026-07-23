import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as workEntryService from './workEntry.service';

export const getAllWorkEntries = catchAsync(
  async (req: Request, res: Response) => {
    const { assignmentId, candidateId, clientId, entryDate, page, limit } =
      req.query as Record<string, string | undefined>;
    const user = req.user!;

    // Auto-scope: VA sees only their own entries, client sees only their VAs
    const isAdmin = user.roles.includes('admin');
    const isAM = user.roles.includes('account_manager');

    const resolvedCandidateId =
      isAdmin || isAM
        ? candidateId
        : user.roles.includes('va') && user.candidateRef
          ? user.candidateRef
          : candidateId;

    const resolvedClientId =
      isAdmin || isAM
        ? clientId
        : user.roles.includes('client') && user.clientRef
          ? user.clientRef
          : clientId;

    const result = await workEntryService.getAllWorkEntries({
      assignmentId,
      candidateId: resolvedCandidateId,
      clientId: resolvedClientId,
      entryDate,
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
    const workEntry = await workEntryService.getWorkEntryById(id);
    sendSuccess(res, workEntry, 'Work entry retrieved', 200);
  }
);

export const createWorkEntry = catchAsync(
  async (req: Request, res: Response) => {
    const body = req.body;
    const createdBy = req.user!._id;
    const workEntry = await workEntryService.createWorkEntry(body, createdBy);
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
      updatedBy
    );
    sendSuccess(res, workEntry, 'Work entry updated', 200);
  }
);

export const deleteWorkEntry = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await workEntryService.deleteWorkEntry(id);
    sendSuccess(res, { deleted: true }, 'Work entry deleted', 200);
  }
);
