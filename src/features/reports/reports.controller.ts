import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import * as reportsService from './reports.service';

export const exportWorkEntries = catchAsync(
  async (req: Request, res: Response) => {
    const { startDate, endDate, candidateId, clientId } = req.query as Record<
      string,
      string
    >;
    const result = await reportsService.getWorkEntriesReport({
      startDate,
      endDate,
      candidateId,
      clientId,
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`
    );
    res.send(result.csv);
  }
);

export const exportEodSubmissions = catchAsync(
  async (req: Request, res: Response) => {
    const { startDate, endDate, candidateId, clientId } = req.query as Record<
      string,
      string
    >;
    const result = await reportsService.getEodSubmissionsReport({
      startDate,
      endDate,
      candidateId,
      clientId,
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`
    );
    res.send(result.csv);
  }
);

export const exportPerformance = catchAsync(
  async (req: Request, res: Response) => {
    const { startDate, endDate, candidateId, clientId } = req.query as Record<
      string,
      string
    >;
    const result = await reportsService.getPerformanceReport({
      startDate,
      endDate,
      candidateId,
      clientId,
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`
    );
    res.send(result.csv);
  }
);
