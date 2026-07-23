import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import type { ExportFormat } from './reports.service';
import * as reportsService from './reports.service';

function sendReport(
  res: Response,
  result: { csv: string; xlsx: Buffer; filename: string },
  format: ExportFormat
) {
  if (format === 'xlsx') {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`
    );
    res.send(result.xlsx);
  } else {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`
    );
    res.send(result.csv);
  }
}

export const exportWorkEntries = catchAsync(
  async (req: Request, res: Response) => {
    const { startDate, endDate, candidateId, clientId, format } =
      req.query as Record<string, string>;
    const fmt: ExportFormat = format === 'xlsx' ? 'xlsx' : 'csv';
    const result = await reportsService.getWorkEntriesReport({
      startDate,
      endDate,
      candidateId,
      clientId,
      format: fmt,
    });
    sendReport(res, result, fmt);
  }
);

export const exportEodSubmissions = catchAsync(
  async (req: Request, res: Response) => {
    const { startDate, endDate, candidateId, clientId, format } =
      req.query as Record<string, string>;
    const fmt: ExportFormat = format === 'xlsx' ? 'xlsx' : 'csv';
    const result = await reportsService.getEodSubmissionsReport({
      startDate,
      endDate,
      candidateId,
      clientId,
      format: fmt,
    });
    sendReport(res, result, fmt);
  }
);

export const exportPerformance = catchAsync(
  async (req: Request, res: Response) => {
    const { startDate, endDate, candidateId, clientId, format } =
      req.query as Record<string, string>;
    const fmt: ExportFormat = format === 'xlsx' ? 'xlsx' : 'csv';
    const result = await reportsService.getPerformanceReport({
      startDate,
      endDate,
      candidateId,
      clientId,
      format: fmt,
    });
    sendReport(res, result, fmt);
  }
);
