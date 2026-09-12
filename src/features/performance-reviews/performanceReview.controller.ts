import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { getCompanyTimezone } from '../../shared/utils/companyTimezone';
import { buildReviewPdf } from '../../shared/utils/pdf';
import { sendSuccess } from '../../shared/utils/response';
import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
import Job from '../jobs/job.model';
import * as reviewService from './performanceReview.service';

export const getAllReviews = catchAsync(async (req: Request, res: Response) => {
  const { candidateId, vaId, clientId, reviewType, status, page, limit } =
    req.query as Record<string, string | undefined>;

  const result = await reviewService.getAllReviews({
    candidateId,
    vaId,
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

  const [candidate, client, job] = await Promise.all([
    Candidate.findById(review.candidateId).lean(),
    Client.findById(review.clientId).lean(),
    review.jobId ? Job.findById(review.jobId).lean() : Promise.resolve(null),
  ]);

  const reviewWithNames = {
    ...review,
    candidateName: candidate
      ? `${candidate.firstName} ${candidate.lastName}`
      : undefined,
    clientName: client?.companyName,
    jobTitle: job?.title,
  };

  sendSuccess(res, reviewWithNames, 'Performance review retrieved', 200);
});

export const generateReview = catchAsync(
  async (req: Request, res: Response) => {
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
  }
);

export const updateReview = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body;
  const updatedBy = req.user!._id;
  const review = await reviewService.updateReview(id, body, updatedBy);
  sendSuccess(res, review, 'Performance review updated', 200);
});

export const completeReview = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const completedBy = req.user!._id;
    const review = await reviewService.completeReview(id, completedBy);
    sendSuccess(res, review, 'Performance review completed', 200);
  }
);

export const deleteReview = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  await reviewService.deleteReview(id);
  sendSuccess(res, null, 'Performance review deleted', 200);
});

export const regenerateSection = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { section } = req.body;
    const review = await reviewService.regenerateSection(id, section);
    sendSuccess(res, review, `${section} regenerated successfully`, 200);
  }
);

export const exportReviewPdf = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const review = await reviewService.getReviewById(id);

    // Populate names for the PDF
    const [candidate, client, job, timezone] = await Promise.all([
      Candidate.findById(review.candidateId).lean(),
      Client.findById(review.clientId).lean(),
      Job.findById(review.jobId).lean(),
      getCompanyTimezone(),
    ]);

    const pdfBuffer = await buildReviewPdf(
      {
        ...review,
        candidateName: candidate
          ? `${candidate.firstName} ${candidate.lastName}`
          : undefined,
        clientName: client?.companyName,
        jobTitle: job?.title,
      },
      timezone
    );

    const filename = `performance-review-${id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.status(200).end(pdfBuffer);
  }
);
