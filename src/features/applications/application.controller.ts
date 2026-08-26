import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import logger from '../../shared/utils/logger';
import { sendSuccess } from '../../shared/utils/response';
import * as applicationService from './application.service';

export const getAllApplications = catchAsync(
  async (req: Request, res: Response) => {
    const { jobId, candidateId, clientId, phase, page, limit } =
      req.query as Record<string, string | undefined>;

    logger.info('GET /applications query', {
      jobId,
      candidateId,
      clientId,
      phase,
      page,
      limit,
    });

    const result = await applicationService.getAllApplications({
      jobId,
      candidateId,
      clientId,
      phase,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });

    logger.info(
      `GET /applications result: ${result.total} total, returning ${result.applications.length}`
    );

    sendSuccess(res, result.applications, 'Applications retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);

export const getApplicationById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const application = await applicationService.getApplicationById(id);
    sendSuccess(res, application, 'Application retrieved', 200);
  }
);

export const approveApplication = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const approvedBy = req.user!._id;
    const application = await applicationService.approveApplication(id, {
      approvedBy,
    });
    sendSuccess(res, application, 'Application approved', 200);
  }
);

export const rejectApplication = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body ?? {};
    const rejectedBy = req.user!._id;
    const application = await applicationService.rejectApplication(id, {
      rejectedBy,
      reason,
    });
    sendSuccess(res, application, 'Application rejected', 200);
  }
);

export const deleteApplication = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const deletedBy = req.user!._id;
    const result = await applicationService.deleteApplication(id, deletedBy);
    sendSuccess(res, result, 'Application deleted', 200);
  }
);

export const disposeApplication = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { dispositionReasonId, destination, internalNotes } = req.body;
    const performedBy = req.user!._id;
    const application = await applicationService.disposeApplication(id, {
      dispositionReasonId,
      destination,
      internalNotes,
      performedBy,
    });
    sendSuccess(res, application, 'Application disposed', 200);
  }
);

export const moveStage = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { stageId } = req.body;
  const movedBy = req.user!._id;
  const application = await applicationService.moveStage(id, {
    stageId,
    movedBy,
  });
  sendSuccess(res, application, 'Stage updated', 200);
});

export const hireApplication = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const hiredBy = req.user!._id;
    const application = await applicationService.hireApplication(id, {
      hiredBy,
    });
    sendSuccess(res, application, 'Candidate hired successfully', 200);
  }
);

export const updateNotes = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { notes } = req.body;
  const updatedBy = req.user!._id;
  const application = await applicationService.updateApplicationNotes(
    id,
    notes,
    updatedBy
  );
  sendSuccess(res, application, 'Notes updated', 200);
});
