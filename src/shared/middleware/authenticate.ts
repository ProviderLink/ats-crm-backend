import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';

const authenticate = catchAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'AUTH_TOKEN_INVALID', 'No token provided');
    }

    const token = authHeader.split(' ')[1];

    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError(401, 'AUTH_TOKEN_EXPIRED', 'Token expired');
      }
      throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Invalid token');
    }

    req.user = {
      _id: decoded._id as string,
      roles: decoded.roles as string[],
      appAccess: decoded.appAccess as string[],
      permissions: decoded.permissions,
    };

    next();
  }
);

export default authenticate;
