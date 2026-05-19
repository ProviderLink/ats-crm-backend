import { Response } from 'express';

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message: string,
  statusCode = 200,
  meta?: Meta
): Response {
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
