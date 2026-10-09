import { NextFunction, Request, Response } from 'express';
import authenticate from './authenticate';

/**
 * For routes that serve both anonymous visitors and signed-in users.
 *
 * No Bearer token: continue as an anonymous request (`req.user` stays unset).
 * A Bearer token: it is validated exactly like `authenticate`, so an expired or
 * invalid token is rejected with 401 (letting the client refresh and retry)
 * instead of silently downgrading a signed-in user to the anonymous view.
 */
const optionalAuthenticate = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }
  authenticate(req, res, next);
};

export default optionalAuthenticate;
