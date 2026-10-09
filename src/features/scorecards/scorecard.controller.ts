import { Request, Response } from 'express';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import { assertOwnsAssignment, assignmentScope } from '../assignments/assignmentScope';
import * as scorecardService from './scorecard.service';

export const getAllScorecards = catchAsync(
  async (req: Request, res: Response) => {
    const { vaId, page, limit } = req.query as Record<
      string,
      string | undefined
    >;
    const result = await scorecardService.getAllScorecards({
      vaId,
      scope: await assignmentScope(req.user!),
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    sendSuccess(res, result.scorecards, 'Scorecards retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);

export const getScorecardById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const scorecard = await scorecardService.getScorecardById(id);
      await assertOwnsAssignment(req.user!, scorecard.assignmentId);
      sendSuccess(res, scorecard, 'Scorecard retrieved', 200);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(404, 'SCORECARD_NOT_FOUND', 'Scorecard not found');
    }
  }
);

export const generateScorecards = catchAsync(
  async (req: Request, res: Response) => {
    const { vaId } = req.body as { vaId?: string };
    const result = await scorecardService.generateScorecards(
      vaId,
      req.user!._id
    );
    sendSuccess(res, result, `Generated ${result.generated} scorecards`, 201);
  }
);
