import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as settingsService from './settings.service';

export const getSettings = catchAsync(async (_req: Request, res: Response) => {
  const settings = await settingsService.getSettings();
  sendSuccess(res, settings, 'Settings retrieved', 200);
});

export const updateSettings = catchAsync(
  async (req: Request, res: Response) => {
    const body = req.body;
    const settings = await settingsService.updateSettings(body);
    sendSuccess(res, settings, 'Settings updated', 200);
  }
);
