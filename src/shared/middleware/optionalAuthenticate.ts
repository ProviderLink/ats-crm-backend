import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';

/**
 * For routes that are public but return more to signed-in staff.
 *
 * - No token or an unverifiable token: continue anonymously.
 * - Expired token: 401 AUTH_TOKEN_EXPIRED, exactly like `authenticate`, so the
 *   staff app's refresh-and-retry flow runs instead of silently receiving the
 *   anonymous payload.
 * - Valid token: `req.user` is set.
 */
const optionalAuthenticate = catchAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError(401, 'AUTH_TOKEN_EXPIRED', 'Token expired');
      }
      return next();
    }

    req.user = {
      _id: decoded._id as string,
      firstName: (decoded.firstName as string) ?? '',
      lastName: (decoded.lastName as string) ?? '',
      roles: decoded.roles as string[],
      appAccess: decoded.appAccess as string[],
      permissions: decoded.permissions,
      candidateRef: (decoded.candidateRef as string | null) ?? null,
      clientRef: (decoded.clientRef as string | null) ?? null,
    };
    next();
  }
);

export default optionalAuthenticate;
