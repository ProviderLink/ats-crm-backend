import * as Sentry from '@sentry/node';
import { ErrorRequestHandler } from 'express';
import AppError from '../utils/AppError';
import { sendError } from '../utils/response';

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    sendError(res, err.code, err.message, err.statusCode, err.details);
    return;
  }

  if (err.name === 'ValidationError') {
    sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, err.errors);
    return;
  }

  if (err.code === 11000) {
    sendError(
      res,
      'DUPLICATE_KEY',
      'Resource already exists',
      409,
      err.keyValue
    );
    return;
  }

  if (err.name === 'CastError') {
    sendError(res, 'INVALID_ID', 'Invalid ID format', 400);
    return;
  }

  if (err.name === 'JsonWebTokenError') {
    sendError(res, 'AUTH_TOKEN_INVALID', 'Invalid token', 401);
    return;
  }

  if (err.name === 'TokenExpiredError') {
    sendError(res, 'AUTH_TOKEN_EXPIRED', 'Token expired', 401);
    return;
  }

  // Unexpected error — capture in Sentry for alerting
  Sentry.captureException(err);
  console.error(err);
  sendError(res, 'INTERNAL_SERVER_ERROR', 'Something went wrong', 500);
};

export default errorHandler;
