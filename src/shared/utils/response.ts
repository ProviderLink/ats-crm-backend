import { Response } from 'express';
import logger from './logger';

/** A single list response this long is a sign a screen should be paged. */
const LARGE_LIST_ROWS = 2000;

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Optional per-tab/status totals for list views. */
  counts?: Record<string, number>;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message: string,
  statusCode = 200,
  meta?: Meta
): Response {
  if (Array.isArray(data) && data.length >= LARGE_LIST_ROWS) {
    // Growth guard: shows up in the server logs long before a screen is slow.
    logger.warn('Large list response', {
      path: res.req?.originalUrl?.split('?')[0],
      rows: data.length,
    });
  }
  return res.status(statusCode).json({
    success: true,
    data,
    message,
    ...(meta && { meta }),
  });
}

export function sendError(
  res: Response,
  code: string,
  message: string,
  statusCode = 400,
  details?: unknown
): Response {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  });
}
