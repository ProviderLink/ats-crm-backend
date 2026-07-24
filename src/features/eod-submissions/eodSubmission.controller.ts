import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
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

    // Auto-scope: VA sees only their own EODs, client sees only their VAs
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

    const result = await eodService.getAllEodSubmissions({
      assignmentId,
      candidateId: resolvedCandidateId,
      clientId: resolvedClientId,
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
    const eodSubmission = await eodService.getEodSubmissionById(id);
    sendSuccess(res, eodSubmission, 'EOD submission retrieved', 200);
  }
);

export const createEodSubmission = catchAsync(
  async (req: Request, res: Response) => {
    const body = req.body;
    const eodSubmission = await eodService.createEodSubmission(body);
    sendSuccess(res, eodSubmission, 'EOD submitted successfully', 201);
  }
);

export const updateEodSubmission = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;
    const eodSubmission = await eodService.updateEodSubmission(id, body);
    sendSuccess(res, eodSubmission, 'EOD submission updated', 200);
  }
);

export const deleteEodSubmission = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await eodService.deleteEodSubmission(id);
    sendSuccess(res, null, 'EOD submission deleted', 200);
  }
);
