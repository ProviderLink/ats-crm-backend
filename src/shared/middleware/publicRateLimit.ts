import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { AppError } from '../utils/AppError';

/**
 * Stricter per-IP limit for public routes that cost money or create records.
 * Runs before file parsing, so a blocked request never reaches the AI.
 */
export const publicApplyLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  skip: req => env.NODE_ENV !== 'production' || Boolean(req.user),
  handler: (_req, _res, next) =>
    next(
      new AppError(
        429,
        'TOO_MANY_REQUESTS',
        'Too many attempts from this connection. Please try again in an hour.'
      )
    ),
});
