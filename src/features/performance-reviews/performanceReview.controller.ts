import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as reviewService from './performanceReview.service';

export const getAllReviews = catchAsync(async (req: Request, res: Response) => {
  const { candidateId, clientId, reviewType, status, page, limit } =
    req.query as Record<string, string | undefined>;

  const result = await reviewService.getAllReviews({
    candidateId,
    clientId,
    reviewType,
    status,
    page: page !== undefined ? Number(page) : undefined,
    limit: limit !== undefined ? Number(limit) : undefined,
  });

  sendSuccess(res, result.reviews, 'Performance reviews retrieved', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

export const getReviewById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const review = await reviewService.getReviewById(id);
  sendSuccess(res, review, 'Performance review retrieved', 200);
});

export const generateReview = catchAsync(async (req: Request, res: Response) => {
  const body = req.body;
  const generatedByUserId = req.user!._id;
  const review = await reviewService.generateReview({
    ...body,
    generatedByUserId,
  });
  sendSuccess(
    res,
    review,
    'Performance review generated. Please review and edit before finalizing.',
    201
  );
});

export const updateReview = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body;
  const updatedBy = req.user!._id;
  const review = await reviewService.updateReview(id, body, updatedBy);
  sendSuccess(res, review, 'Performance review updated', 200);
});

export const completeReview = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const completedBy = req.user!._id;
  const review = await reviewService.completeReview(id, completedBy);
  sendSuccess(res, review, 'Performance review completed', 200);
});

export const regenerateSection = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { section } = req.body;
  const review = await reviewService.regenerateSection(id, section);
  sendSuccess(res, review, `${section} regenerated successfully`, 200);
});
