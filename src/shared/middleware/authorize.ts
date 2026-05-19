import { NextFunction, Request, Response } from 'express';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';

const assertUser = (req: Request): void => {
  if (!req.user) {
    throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Authentication required');
  }
};

export const requireRoles = (...roles: string[]) =>
  catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
    assertUser(req);
    const user = req.user!;

    if (
      user.roles.includes('admin') ||
      roles.some(r => user.roles.includes(r))
    ) {
      return next();
    }

    throw new AppError(
      403,
      'AUTH_INSUFFICIENT_PERMISSIONS',
      'You do not have permission to perform this action'
    );
  });

export const requirePermission = (resource: string, action: string) =>
  catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
    assertUser(req);
    const user = req.user!;

    if (user.roles.includes('admin')) return next();

    const perms = user.permissions as Record<
      string,
      Record<string, boolean | undefined> | undefined
    >;
    if (perms[resource]?.[action] === true) return next();

    throw new AppError(
      403,
      'AUTH_INSUFFICIENT_PERMISSIONS',
      'You do not have permission to perform this action'
    );
  });

export const requireAppAccess = (app: 'ats' | 'crm') =>
  catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
    assertUser(req);
    const user = req.user!;

    if (user.roles.includes('admin') || user.appAccess.includes(app))
      return next();

    throw new AppError(
      403,
      'AUTH_INSUFFICIENT_PERMISSIONS',
      'You do not have access to this application'
    );
  });
