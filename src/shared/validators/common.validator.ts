import { NextFunction, Request, Response } from 'express';
import { z, ZodSchema } from 'zod';
import AppError from '../utils/AppError';

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid ID format');

/**
 * A web link. `z.string().url()` alone accepts any scheme, including
 * `javascript:` and `data:`; links entered by applicants end up as clickable
 * anchors in the staff app, so only http(s) is allowed.
 */
export const httpUrlSchema = z
  .string()
  .url()
  .refine(value => /^https?:\/\//i.test(value), {
    message: 'Only http(s) links are allowed',
  });

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const dateRangeSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const validate = (
  schema: ZodSchema,
  source: 'body' | 'query' | 'params' = 'body'
) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      next(new AppError(400, 'VALIDATION_ERROR', 'Validation failed', errors));
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any)[source] = result.data;
    next();
  };
};
