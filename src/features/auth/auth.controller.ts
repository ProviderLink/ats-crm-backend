import { Request, Response } from 'express';
import { env } from '../../config/env';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as authService from './auth.service';

export const login = catchAsync(async (req: Request, res: Response) => {
  const { user, accessToken, refreshToken } = await authService.login(req.body);
  res.cookie('refreshTokenAts', refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  sendSuccess(res, { user, accessToken }, 'Login successful', 200);
});

export const logout = catchAsync(async (req: Request, res: Response) => {
  await authService.logout(req.user!._id);
  res.clearCookie('refreshTokenAts');
  sendSuccess(res, {}, 'Logged out', 200);
});

export const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const token = req.cookies.refreshTokenAts as string | undefined;
  if (!token) {
    throw new AppError(401, 'AUTH_TOKEN_INVALID', 'No refresh token');
  }
  const { user, accessToken } = await authService.refreshToken(token);
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
