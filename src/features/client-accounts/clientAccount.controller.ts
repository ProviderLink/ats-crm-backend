import { Request, Response } from 'express';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
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
    const result = await service.getAllClientAccounts({
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
    const vas = await service.getHiredVasForClient(id);
    sendSuccess(res, vas, 'Hired VAs retrieved', 200);
  }
);

export const updateClientAccount = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const updatedBy = req.user!._id;
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
