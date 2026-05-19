import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
import EodSubmission from '../eod-submissions/eodSubmission.model';
import PerformanceReview from '../performance-reviews/performanceReview.model';
import WorkEntry from '../work-entries/workEntry.model';

function generateCsv(headers: string[], rows: string[][]): string {
  const escape = (value: string) =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;
  const headerLine = headers.map(escape).join(',');
  const rowLines = rows.map(row => row.map(escape).join(','));
  return [headerLine, ...rowLines].join('\n');
}

export const getWorkEntriesReport = async (filters: {
  startDate?: string;
  endDate?: string;
  candidateId?: string;
  clientId?: string;
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

  return {
    csv: generateCsv(headers, rows),
    filename: `work-entries-${Date.now()}.csv`,
  };
};

export const getEodSubmissionsReport = async (filters: {
  startDate?: string;
  endDate?: string;
  candidateId?: string;
  clientId?: string;
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

  return {
    csv: generateCsv(headers, rows),
    filename: `eod-submissions-${Date.now()}.csv`,
  };
};

export const getPerformanceReport = async (filters: {
  startDate?: string;
  endDate?: string;
  candidateId?: string;
  clientId?: string;
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

  return {
    csv: generateCsv(headers, rows),
    filename: `performance-reviews-${Date.now()}.csv`,
  };
};
