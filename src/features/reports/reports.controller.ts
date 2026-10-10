import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import type { ExportFormat } from './reports.service';
import { assignmentScope, pairScope } from '../assignments/assignmentScope';
import * as reportsService from './reports.service';
import { createLog } from '../activity-logs/activityLog.service';
import mongoose from 'mongoose';

/** Record who exported which report; a data export is worth an audit entry. */
function logExport(
  req: Request,
  report: string,
  format: ExportFormat,
  range: { startDate?: string; endDate?: string }
) {
  createLog({
    action: 'report_exported',
    resourceType: 'report',
    // A report is not a stored record, so each export gets its own id.
    resourceId: new mongoose.Types.ObjectId().toString(),
    metadata: {
      report,
      format,
      ...(range.startDate ? { startDate: range.startDate } : {}),
      ...(range.endDate ? { endDate: range.endDate } : {}),
    },
    performedBy: req.user!._id,
  });
}

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
    logExport(req, 'work_entries', fmt, { startDate, endDate });
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
    logExport(req, 'eod_submissions', fmt, { startDate, endDate });
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
    logExport(req, 'performance', fmt, { startDate, endDate });
    sendReport(res, result, fmt);
  }
);

export const exportDispositions = catchAsync(
  async (req: Request, res: Response) => {
    const filters = parseReportFilters(req);
    const result = await reportsService.getDispositionsReport(filters);
    logExport(req, 'dispositions', filters.format, filters);
    sendReport(res, result, filters.format);
  }
);
