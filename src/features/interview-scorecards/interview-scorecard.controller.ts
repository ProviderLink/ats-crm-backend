import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import {
  createScorecard,
  getScorecardById,
  getScorecardsByCandidate,
  getTagSuggestions as fetchTagSuggestions,
  updateScorecard,
} from './interview-scorecard.service';

// POST /api/v1/ats/interview-scorecards
export const createInterviewScorecard = catchAsync(
  async (req: Request, res: Response) => {
    const createdBy = req.user!._id;
    // interviewerId defaults to the logged-in user when the client omits it
    // (J2: encoding the "log on behalf of another interviewer" capability).
    const body = req.body;
    const interviewerId = body.interviewerId ?? createdBy;

    const scorecard = await createScorecard(
      {
        ...body,
        interviewerId,
      },
      createdBy
    );

    sendSuccess(res, scorecard, 'Interview scorecard created', 201);
  }
);

// GET /api/v1/ats/interview-scorecards?candidateId=&page=&limit=
// candidateId is REQUIRED — see J4 override; the route validator enforces this.
export const listInterviewScorecards = catchAsync(
  async (req: Request, res: Response) => {
    const { candidateId, page, limit } = req.query as Record<
      string,
      string | undefined
    >;

    const result = await getScorecardsByCandidate(candidateId!, {
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });

    sendSuccess(res, result.scorecards, 'Interview scorecards retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);

// GET /api/v1/ats/interview-scorecards/:id
export const getInterviewScorecard = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const scorecard = await getScorecardById(id);
    sendSuccess(res, scorecard, 'Interview scorecard retrieved', 200);
  }
);

// GET /api/v1/ats/interview-scorecards/tag-suggestions
export const getTagSuggestions = catchAsync(
  async (_req: Request, res: Response) => {
    const suggestions = await fetchTagSuggestions();
    sendSuccess(res, suggestions, 'Tag suggestions retrieved', 200);
  }
);

// PATCH /api/v1/ats/interview-scorecards/:id
// Full re-save of editable fields; the service recomputes weighted scores.
export const updateInterviewScorecard = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const performedBy = req.user!._id;

    const scorecard = await updateScorecard(id, req.body, performedBy);

    sendSuccess(res, scorecard, 'Interview scorecard updated', 200);
  }
);
