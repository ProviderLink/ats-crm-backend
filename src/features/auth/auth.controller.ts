import { Request, Response } from 'express';
import { env } from '../../config/env';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as authService from './auth.service';

export const login = catchAsync(async (req: Request, res: Response) => {
  const { user, accessToken, refreshToken, app } = await authService.login(
    req.body,
    req.ip
  );
  const cookieName = app === 'crm' ? 'refreshTokenCrm' : 'refreshTokenAts';
  const isProd = env.NODE_ENV === 'production';
  res.cookie(cookieName, refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  sendSuccess(res, { user, accessToken }, 'Login successful', 200);
});

export const logout = catchAsync(async (req: Request, res: Response) => {
  const app =
    (req.query.app as 'ats' | 'crm') ?? (req.body.app as 'ats' | 'crm');
  await authService.logout(req.user!._id, app);
  if (app === 'crm') {
    res.clearCookie('refreshTokenCrm');
  } else if (app === 'ats') {
    res.clearCookie('refreshTokenAts');
  } else {
    res.clearCookie('refreshTokenAts');
    res.clearCookie('refreshTokenCrm');
  }
  sendSuccess(res, {}, 'Logged out', 200);
});

export const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const app: 'ats' | 'crm' =
    (req.query.app as 'ats' | 'crm') ??
    (req.body.app as 'ats' | 'crm') ??
    'ats';
  const cookieName = app === 'crm' ? 'refreshTokenCrm' : 'refreshTokenAts';
  const token = req.cookies[cookieName] as string | undefined;
  if (!token) {
    throw new AppError(401, 'AUTH_TOKEN_INVALID', 'No refresh token');
  }
  const { user, accessToken } = await authService.refreshToken(token, app);
  sendSuccess(res, { user, accessToken }, 'Token refreshed', 200);
});

export const forgotPassword = catchAsync(
  async (req: Request, res: Response) => {
    await authService.forgotPassword(req.body.email);
    sendSuccess(res, {}, 'Reset link sent if email exists', 200);
  }
);

export const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body.token, req.body.password);
  sendSuccess(res, {}, 'Password reset successfully', 200);
});

export const changePassword = catchAsync(
  async (req: Request, res: Response) => {
    await authService.changePassword(
      req.user!._id,
      req.body.currentPassword,
      req.body.newPassword
    );
    sendSuccess(res, { success: true }, 'Password changed successfully', 200);
  }
);

export const verifyEmail = catchAsync(async (req: Request, res: Response) => {
  await authService.verifyEmail(req.body.token);
  sendSuccess(res, {}, 'Email verified successfully', 200);
});

export const setPassword = catchAsync(async (req: Request, res: Response) => {
  await authService.setPassword(req.body.token, req.body.password);
  sendSuccess(res, {}, 'Password set successfully', 200);
});
