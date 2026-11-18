import { Request, Response, Router } from 'express';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import { getUsdPhpRate } from './exchangeRate.service';

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('ats'));

/**
 * @route   GET /api/v1/ats/exchange-rates/usd-php
 * @desc    Today's USD->PHP rate, used to convert candidate salaries.
 * @access  ATS users who can read candidates
 */
router.get(
  '/usd-php',
  requirePermission('candidates', 'read'),
  catchAsync(async (_req: Request, res: Response) => {
    const rate = await getUsdPhpRate();
    sendSuccess(res, rate, 'Exchange rate retrieved', 200);
  })
);

export default router;
