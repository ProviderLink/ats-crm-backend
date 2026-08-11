import * as XLSX from 'xlsx';
import Application from '../applications/application.model';
import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
import DispositionReason from '../disposition-reasons/dispositionReason.model';
import EodSubmission from '../eod-submissions/eodSubmission.model';
import Job from '../jobs/job.model';
import PerformanceReview from '../performance-reviews/performanceReview.model';
import WorkEntry from '../work-entries/workEntry.model';

export type ExportFormat = 'csv' | 'xlsx';

function generateCsv(headers: string[], rows: string[][]): string {
  const escape = (value: string) =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;
  const headerLine = headers.map(escape).join(',');
  const rowLines = rows.map(row => row.map(escape).join(','));
  return [headerLine, ...rowLines].join('\n');
}

function generateXlsx(headers: string[], rows: string[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Report');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

type ReportResult = { csv: string; xlsx: Buffer; filename: string };

function formatResult(
  format: ExportFormat,
  headers: string[],
  rows: string[][],
  baseName: string
): ReportResult {
  const ext = format === 'xlsx' ? 'xlsx' : 'csv';
  return {
    csv: generateCsv(headers, rows),
    xlsx: generateXlsx(headers, rows),
    filename: `${baseName}-${Date.now()}.${ext}`,
  };
}

export const getWorkEntriesReport = async (filters: {
  startDate?: string;
  endDate?: string;
  candidateId?: string;
  clientId?: string;
  format?: ExportFormat;
}) => {
  const query: Record<string, any> = {};

  if (filters.startDate || filters.endDate) {
    query.entryDate = {};
    if (filters.startDate) query.entryDate.$gte = new Date(filters.startDate);
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      query.entryDate.$lte = end;
    }
  }
  if (filters.candidateId) query.candidateId = filters.candidateId;
  if (filters.clientId) query.clientId = filters.clientId;

  const entries = await WorkEntry.find(query).sort({ entryDate: -1 });

  const headers = [
    'Date',
    'VA Name',
    'Client',
    'Category',
    'Description',
    'Time Spent (mins)',
    'Status',
    'Notes',
  ];
  const rows = await Promise.all(
    entries.map(async (entry: any) => {
      const candidate = await Candidate.findById(entry.candidateId);
      const client = await Client.findById(entry.clientId);
      return [
        entry.entryDate.toISOString().split('T')[0],
        `${candidate?.firstName} ${candidate?.lastName}`,
        client?.companyName ?? '',
        entry.taskCategory,
        entry.taskDescription,
        String(entry.timeSpent),
        entry.status,
        entry.notes ?? '',
      ];
    })
  );

  return formatResult(filters.format ?? 'csv', headers, rows, 'work-entries');
};

export const getEodSubmissionsReport = async (filters: {
  startDate?: string;
  endDate?: string;
  candidateId?: string;
  clientId?: string;
  format?: ExportFormat;
}) => {
  const query: Record<string, any> = {};

  if (filters.startDate || filters.endDate) {
    query.date = {};
    if (filters.startDate) query.date.$gte = new Date(filters.startDate);
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      query.date.$lte = end;
    }
  }
  if (filters.candidateId) query.candidateId = filters.candidateId;
  if (filters.clientId) query.clientId = filters.clientId;

  const submissions = await EodSubmission.find(query).sort({ date: -1 });

  const headers = [
    'Date',
    'VA Name',
    'Client',
    'Shift Start',
    'Shift End',
    'Hours Worked',
    'Summary',
    'Pending Tasks',
    'Blockers',
    'Notes',
  ];
  const rows = await Promise.all(
    submissions.map(async (submission: any) => {
      const candidate = await Candidate.findById(submission.candidateId);
      const client = await Client.findById(submission.clientId);
      return [
        submission.date.toISOString().split('T')[0],
        `${candidate?.firstName} ${candidate?.lastName}`,
        client?.companyName ?? '',
        submission.shiftStart,
        submission.shiftEnd,
        String(submission.hoursWorked),
        submission.summaryOfWork,
        submission.pendingTasks,
        submission.blockers ?? '',
        submission.notes ?? '',
      ];
    })
  );

  return formatResult(
    filters.format ?? 'csv',
    headers,
    rows,
    'eod-submissions'
  );
};

export const getPerformanceReport = async (filters: {
  startDate?: string;
  endDate?: string;
  candidateId?: string;
  clientId?: string;
  format?: ExportFormat;
}) => {
  const query: Record<string, any> = {};

  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }
  if (filters.candidateId) query.candidateId = filters.candidateId;
  if (filters.clientId) query.clientId = filters.clientId;
  query.status = 'completed';

  const reviews = await PerformanceReview.find(query).sort({ createdAt: -1 });

  const headers = [
    'Date',
    'VA Name',
    'Client',
    'Review Type',
    'Period Start',
    'Period End',
    'Overall Rating',
    'Final Recommendation',
    'Status',
  ];
  const rows = await Promise.all(
    reviews.map(async (review: any) => {
      const candidate = await Candidate.findById(review.candidateId);
      const client = await Client.findById(review.clientId);
      return [
        review.createdAt.toISOString().split('T')[0],
        `${candidate?.firstName} ${candidate?.lastName}`,
        client?.companyName ?? '',
        review.reviewType,
        review.reviewPeriodStart.toISOString().split('T')[0],
        review.reviewPeriodEnd.toISOString().split('T')[0],
        String(review.overallRating ?? ''),
        review.finalRecommendation ?? '',
        review.status,
      ];
    })
  );

  return formatResult(
    filters.format ?? 'csv',
    headers,
    rows,
    'performance-reviews'
  );
};

export const getDispositionsReport = async (filters: {
  startDate?: string;
  endDate?: string;
  jobId?: string;
  clientId?: string;
  format?: ExportFormat;
}) => {
  const query: Record<string, any> = {
    phase: 'rejected',
    closedAt: { $ne: null },
  };

  if (filters.startDate || filters.endDate) {
    query.closedAt = {};
    if (filters.startDate) query.closedAt.$gte = new Date(filters.startDate);
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      query.closedAt.$lte = end;
    }
  }
  if (filters.jobId) query.jobId = filters.jobId;
  if (filters.clientId) query.clientId = filters.clientId;

  const apps = await Application.find(query).sort({ closedAt: -1 });

  const headers = [
    'Disposition Date',
    'Candidate Name',
    'Candidate Email',
    'Job Title',
    'Last Stage',
    'Disposition Category',
    'Disposition Reason',
    'Destination',
    'Internal Notes',
    'Disposed By',
    'Eligibility Status',
  ];

  const rows: string[][] = [];
  for (const app of apps) {
    const candidate = await Candidate.findById(app.candidateId);
    const job = await Job.findById(app.jobId);
    const reason = app.dispositionReasonId
      ? await DispositionReason.findById(app.dispositionReasonId)
      : null;

    rows.push([
      app.closedAt?.toISOString().split('T')[0] ?? '',
      candidate ? `${candidate.firstName} ${candidate.lastName}` : '',
      candidate?.email ?? '',
      job?.title ?? '',
      app.lastStage?.stageName ?? app.rejectionReason ?? '',
      reason?.category ?? '',
      reason?.label ?? app.rejectionReason ?? '',
      app.dispositionDestination ?? '',
      app.internalNotes ?? '',
      String(app.closedBy ?? ''),
      candidate?.eligibilityStatus ?? '',
    ]);
  }

  return formatResult(filters.format ?? 'csv', headers, rows, 'dispositions');
};
