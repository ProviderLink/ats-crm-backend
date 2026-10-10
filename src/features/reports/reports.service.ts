import * as XLSX from 'xlsx';
import ActivityLog from '../activity-logs/activityLog.model';
import Application from '../applications/application.model';
import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
import DispositionReason from '../disposition-reasons/dispositionReason.model';
import EodSubmission from '../eod-submissions/eodSubmission.model';
import Job from '../jobs/job.model';
import PerformanceReview from '../performance-reviews/performanceReview.model';
import User from '../users/user.model';
import WorkEntry from '../work-entries/workEntry.model';

export type ExportFormat = 'csv' | 'xlsx';

const EOD_WORK_STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In Progress',
  pending: 'Pending Client Input',
};

const Q2_LABELS: Record<string, string> = {
  yes: 'Yes',
  no: 'No',
  other: 'Other',
};

/**
 * Build the Q1 cell value for an EOD submission following the boss's
 * Google-Forms export reference: the entire task list is contained in ONE
 * cell, with one block per work entry. Legacy EODs (no workEntries) fall back
 * to the original free-text summaryOfWork.
 */
function buildEodQ1Cell(submission: any): string {
  const entries = Array.isArray(submission.workEntries)
    ? submission.workEntries
    : [];
  if (entries.length > 0) {
    return entries
      .map((e: any, idx: number) => {
        const lines = [
          `Task ${idx + 1}: ${e.task ?? ''}`,
          `Description: ${e.description ?? ''}`,
          `Quantity: ${e.quantity ?? 0}`,
          `Status: ${EOD_WORK_STATUS_LABELS[e.status] ?? e.status ?? ''}`,
          `Time Spent: ${e.timeSpent ?? 0} min`,
        ];
        return lines.join('\n');
      })
      .join('\n\n');
  }
  return submission.summaryOfWork ?? '';
}

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
  /** Extra Mongo condition, e.g. an account manager's own assignments. */
  scope?: Record<string, unknown>;
  format?: ExportFormat;
}) => {
  const query: Record<string, any> = { isDeleted: { $ne: true } };
  if (filters.scope) query.$and = [filters.scope];

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
  /** Extra Mongo condition, e.g. an account manager's own assignments. */
  scope?: Record<string, unknown>;
  format?: ExportFormat;
}) => {
  const query: Record<string, any> = {};
  if (filters.scope) query.$and = [filters.scope];

  if (filters.startDate || filters.endDate) {
    // `dateKey` is the company business day, so a plain inclusive string range
    // is exactly the requested day range — no timezone shifting required.
    query.dateKey = {};
    if (filters.startDate) query.dateKey.$gte = filters.startDate;
    if (filters.endDate) query.dateKey.$lte = filters.endDate;
  }
  if (filters.candidateId) query.candidateId = filters.candidateId;
  if (filters.clientId) query.clientId = filters.clientId;

  const submissions = await EodSubmission.find(query).sort({ date: -1 });

  // Prefetch related Candidate, Client, and User (VA login account) records
  // to avoid N+1 queries inside the row loop. User.email is preferred for the
  // "Email Address" column (matches the Google Forms respondent email);
  // Candidate.email is used as a fallback when no User account is linked.
  const candidateIds = [
    ...new Set(submissions.map(s => String(s.candidateId))),
  ];
  const clientIds = [...new Set(submissions.map(s => String(s.clientId)))];

  const [candidateDocs, clientDocs, userDocs] = await Promise.all([
    candidateIds.length > 0
      ? Candidate.find({ _id: { $in: candidateIds } }).select(
          'firstName lastName email'
        )
      : [],
    clientIds.length > 0
      ? Client.find({ _id: { $in: clientIds } }).select('companyName')
      : [],
    candidateIds.length > 0
      ? User.find({ candidateRef: { $in: candidateIds } }).select(
          'email candidateRef'
        )
      : [],
  ]);

  const candidateMap: Record<string, any> = Object.fromEntries(
    candidateDocs.map(c => [String(c._id), c])
  );
  const clientNameMap: Record<string, string> = Object.fromEntries(
    clientDocs.map(c => [String(c._id), String((c as any).companyName ?? '')])
  );
  const userEmailByCandidateMap: Record<string, string> = Object.fromEntries(
    userDocs
      .filter(u => u.candidateRef)
      .map(u => [String(u.candidateRef), String((u as any).email ?? '')])
  );

  // Boss-provided export-format reference: one row per EOD submission,
  // eight columns, exact names and order below.
  const headers = [
    'Timestamp',
    'Email Address',
    'VA Name',
    'Client Name',
    'Q1. What tasks did you complete today?',
    'Q2. Did you communicate with the client today?',
    'Q3. Additional notes or updates that you want your client to know?',
    'I submitted EOD today',
  ];

  const rows = submissions.map((submission: any) => {
    const candidate = candidateMap[String(submission.candidateId)];
    const vaName = candidate
      ? `${(candidate as any).firstName ?? ''} ${
          (candidate as any).lastName ?? ''
        }`.trim()
      : '';
    const email =
      userEmailByCandidateMap[String(submission.candidateId)] ||
      (candidate ? String((candidate as any).email ?? '') : '');

    return [
      submission.createdAt ? new Date(submission.createdAt).toISOString() : '',
      email,
      vaName,
      clientNameMap[String(submission.clientId)] ?? '',
      buildEodQ1Cell(submission),
      submission.communicatedWithClient
        ? (Q2_LABELS[submission.communicatedWithClient] ??
          submission.communicatedWithClient)
        : '',
      submission.clientNote ?? '',
      'Yes',
    ];
  });

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
  /** Extra Mongo condition, e.g. an account manager's own assignments. */
  scope?: Record<string, unknown>;
  format?: ExportFormat;
}) => {
  const query: Record<string, any> = {};
  if (filters.scope) query.$and = [filters.scope];

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
    'Rejection Date',
    'Candidate Name',
    'Candidate Email',
    'Job Title',
    'Last Stage',
    'Rejection Category',
    'Rejection Reason',
    'Destination',
    'Internal Notes',
    'Rejected By',
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

  // ── Candidate-level rejections ──
  // A candidate rejected from In Review has no application, so nothing above
  // matches and the whole event was previously missing from this report. Those
  // rejections are recorded as an activity log on the candidate, so read them
  // here.
  //
  // No de-duplication is needed: `rejectCandidate` refuses when the candidate
  // holds a live application, so a candidate-level reject can never also
  // produce an application row for the same event. Any application row for that
  // candidate is a separate rejection of a job, and both are worth reporting.

  // Date bounds mirror the application query above, including the end-of-day
  // extension so an endDate includes that whole day.
  const rejectLogDateFilter: Record<string, Date> = {};
  if (filters.startDate) rejectLogDateFilter.$gte = new Date(filters.startDate);
  if (filters.endDate) {
    const end = new Date(filters.endDate);
    end.setHours(23, 59, 59, 999);
    rejectLogDateFilter.$lte = end;
  }

  const candidateRejectLogs = await ActivityLog.find({
    action: 'rejected',
    resourceType: 'candidate',
    ...(Object.keys(rejectLogDateFilter).length > 0
      ? { createdAt: rejectLogDateFilter }
      : {}),
  }).sort({ createdAt: -1 });

  for (const log of candidateRejectLogs) {
    const candidateId = String(log.resourceId);
    const candidate = await Candidate.findById(candidateId);
    const m = (log.metadata ?? {}) as Record<string, unknown>;
    const reasonId = typeof m['reasonId'] === 'string' ? m['reasonId'] : null;
    const reason = reasonId ? await DispositionReason.findById(reasonId) : null;

    rows.push([
      log.createdAt.toISOString().split('T')[0],
      candidate ? `${candidate.firstName} ${candidate.lastName}` : '',
      candidate?.email ?? '',
      // No job — this rejection happened before any application existed.
      '',
      '',
      reason?.category ?? '',
      reason?.label ?? String(m['reason'] ?? ''),
      typeof m['destination'] === 'string' ? m['destination'] : '',
      typeof m['internalNotes'] === 'string' ? m['internalNotes'] : '',
      String(log.performedBy ?? ''),
      candidate?.eligibilityStatus ?? '',
    ]);
  }

  return formatResult(filters.format ?? 'csv', headers, rows, 'dispositions');
};
