import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as dispositionReasonService from './dispositionReason.service';

export const listReasons = catchAsync(async (req: Request, res: Response) => {
  const { isActive, category } = req.query as Record<
    string,
    string | undefined
  >;
  const reasons = await dispositionReasonService.listReasons({
    isActive: isActive !== undefined ? isActive === 'true' : undefined,
    category,
  });
  sendSuccess(res, reasons, 'Disposition reasons retrieved');
});

export const getActiveReasons = catchAsync(
  async (req: Request, res: Response) => {
    const { stageName } = req.query as Record<string, string | undefined>;
    const reasons = await dispositionReasonService.getActiveReasons(stageName);
    sendSuccess(res, reasons, 'Active disposition reasons retrieved');
  }
);

export const getReasonById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const reason = await dispositionReasonService.getReasonById(id);
  sendSuccess(res, reason, 'Disposition reason retrieved');
});

export const createReason = catchAsync(async (req: Request, res: Response) => {
  const body = req.body;
  const reason = await dispositionReasonService.createReason({
    ...body,
    createdBy: req.user!._id,
  });
  sendSuccess(res, reason, 'Disposition reason created', 201);
});

export const updateReason = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body;
  const reason = await dispositionReasonService.updateReason(id, {
    ...body,
    updatedBy: req.user!._id,
  });
  sendSuccess(res, reason, 'Disposition reason updated');
});

export const deactivateReason = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const reason = await dispositionReasonService.deactivateReason(
      id,
      req.user!._id
    );
    sendSuccess(res, reason, 'Disposition reason deactivated');
  }
);

export const reorderReason = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { order } = req.body;
  const reason = await dispositionReasonService.reorderReason(
    id,
    order,
    req.user!._id
  );
  sendSuccess(res, reason, 'Disposition reason reordered');
});
