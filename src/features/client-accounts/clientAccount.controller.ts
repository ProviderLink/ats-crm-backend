import { Request, Response } from 'express';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { assertOwnsRecord } from '../../shared/utils/crmScope';
import { sendSuccess } from '../../shared/utils/response';
import {
  assertManagesClient,
  managedIds,
} from '../assignments/assignmentScope';
import * as clientService from '../clients/client.service';
import * as service from './clientAccount.service';

export const getProvisionedClients = catchAsync(
  async (_req: Request, res: Response) => {
    const clients = await service.getProvisionedClients();
    sendSuccess(res, clients, 'Provisioned clients retrieved', 200);
  }
);

export const getAllClientAccounts = catchAsync(
  async (req: Request, res: Response) => {
    const { page, limit } = req.query as Record<string, string | undefined>;
    const managed = await managedIds(req.user!);
    const result = await service.getAllClientAccounts({
      scope: managed ? { _id: { $in: managed.clientIds } } : undefined,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    sendSuccess(res, result.accounts, 'Client accounts retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);

export const getClientAccountById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await assertManagesClient(req.user!, id);
    try {
      const account = await service.getClientAccountById(id);
      sendSuccess(res, account, 'Client account retrieved', 200);
    } catch {
      throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');
    }
  }
);

export const getHiredVasForClient = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    assertOwnsRecord(req.user!, { clientId: id });
    const vas = await service.getHiredVasForClient(id);
    sendSuccess(res, vas, 'Hired VAs retrieved', 200);
  }
);

export const updateClientAccount = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const updatedBy = req.user!._id;
    await assertManagesClient(req.user!, id);
    try {
      const account = await service.updateClientAccount(
        id,
        req.body,
        updatedBy
      );
      sendSuccess(res, account, 'Client account updated', 200);
    } catch {
      throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');
    }
  }
);

export const listClientNotes = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await assertManagesClient(req.user!, id);
    const notes = await clientService.listNotes(id);
    sendSuccess(res, notes, 'Notes retrieved', 200);
  }
);

export const createClientNote = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await assertManagesClient(req.user!, id);
    const note = await clientService.addNote(id, req.body, req.user!._id);
    sendSuccess(res, note, 'Note created', 201);
  }
);
