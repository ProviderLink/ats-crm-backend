import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import type { ExportFormat } from './reports.service';
import { assignmentScope, pairScope } from '../assignments/assignmentScope';
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

function parseReportFilters(req: Request) {
  const { startDate, endDate, candidateId, clientId, jobId, format } =
    req.query as Record<string, string | undefined>;

  return {
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(candidateId && { candidateId }),
    ...(clientId && { clientId }),
    ...(jobId && { jobId }),
    format: (format === 'xlsx' ? 'xlsx' : 'csv') as ExportFormat,
  };
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
      scope: await assignmentScope(req.user!),
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
      scope: await assignmentScope(req.user!),
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
      scope: await pairScope(req.user!),
      format: fmt,
    });
    sendReport(res, result, fmt);
  }
);

export const exportDispositions = catchAsync(
  async (req: Request, res: Response) => {
    const filters = parseReportFilters(req);
    const result = await reportsService.getDispositionsReport(filters);
    sendReport(res, result, filters.format);
  }
);
