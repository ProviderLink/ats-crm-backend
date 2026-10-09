import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { scopeListFilters } from '../../shared/utils/crmScope';
import { sendSuccess } from '../../shared/utils/response';
import * as eodService from './eodSubmission.service';

export const getAllEodSubmissions = catchAsync(
  async (req: Request, res: Response) => {
    const {
      assignmentId,
      candidateId,
      clientId,
      date,
      dateFrom,
      dateTo,
      page,
      limit,
    } = req.query as Record<string, string | undefined>;
    const user = req.user!;

    // A VA sees only their own EODs, a client only their VAs'
    const scoped = scopeListFilters(user, { candidateId, clientId });

    const result = await eodService.getAllEodSubmissions({
      assignmentId,
      candidateId: scoped.candidateId,
      clientId: scoped.clientId,
      date,
      dateFrom,
      dateTo,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    sendSuccess(res, result.eodSubmissions, 'EOD submissions retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);

export const getEodSubmissionById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = req.user!;
    const eodSubmission = await eodService.getEodSubmissionById(id, {
      roles: user.roles,
      candidateRef: user.candidateRef,
      clientRef: user.clientRef,
    });
    sendSuccess(res, eodSubmission, 'EOD submission retrieved', 200);
  }
);

export const getEodContext = catchAsync(
  async (_req: Request, res: Response) => {
    const context = await eodService.getEodContext();
    sendSuccess(res, context, 'EOD context retrieved', 200);
  }
);

export const createEodSubmission = catchAsync(
  async (req: Request, res: Response) => {
    const body = req.body;
    const eodSubmission = await eodService.createEodSubmission(
      body,
      req.user!._id,
      req.user!
    );
    sendSuccess(res, eodSubmission, 'EOD submitted successfully', 201);
  }
);

export const updateEodSubmission = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;
    const eodSubmission = await eodService.updateEodSubmission(
      id,
      body,
      req.user!
    );
    sendSuccess(res, eodSubmission, 'EOD submission updated', 200);
  }
);

export const deleteEodSubmission = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await eodService.deleteEodSubmission(id, req.user!._id, req.user!);
    sendSuccess(res, null, 'EOD submission deleted', 200);
  }
);
