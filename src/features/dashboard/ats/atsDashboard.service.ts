import { cachedList } from '../../../shared/utils/listCache';
import Application from '../../applications/application.model';
import Candidate from '../../candidates/candidate.model';
import Client from '../../clients/client.model';
import Interview from '../../interviews/interview.model';
import Job from '../../jobs/job.model';

export const getOverview = async () => {
  const [
    totalCandidates,
    approvedCandidates,
    hiredCandidates,
    totalJobs,
    openJobs,
    totalClients,
    activeClients,
    totalApplications,
    pendingApplications,
    approvedApplications,
    hiredCount,
    totalInterviews,
    scheduledInterviews,
    completedInterviews,
  ] = await Promise.all([
    // Match the candidates list endpoint, which excludes permanently
    // ineligible candidates by default, so dashboard totals stay consistent
    // with the candidates page.
    Candidate.countDocuments({
      eligibilityStatus: { $ne: 'permanently_ineligible' },
    }),
    Candidate.countDocuments({
      status: 'approved',
      eligibilityStatus: { $ne: 'permanently_ineligible' },
    }),
    Candidate.countDocuments({
      status: 'hired',
      eligibilityStatus: { $ne: 'permanently_ineligible' },
    }),
    Job.countDocuments({}),
    Job.countDocuments({ status: 'open' }),
    Client.countDocuments({}),
    Client.countDocuments({ status: 'active' }),
    Application.countDocuments({}),
    Application.countDocuments({ phase: 'pending' }),
    Application.countDocuments({ phase: 'approved' }),
    Application.countDocuments({ phase: 'hired' }),
    Interview.countDocuments({}),
    Interview.countDocuments({ status: 'scheduled' }),
    Interview.countDocuments({ status: 'completed' }),
  ]);

  return {
    totalCandidates,
    approvedCandidates,
    hiredCandidates,
    totalJobs,
    openJobs,
    totalClients,
    activeClients,
    totalApplications,
    pendingApplications,
    approvedApplications,
    // Fields required by frontend dashboard
    hiredCount,
    activeCandidates: approvedCandidates,
    totalInterviews,
    scheduledInterviews,
    completedInterviews,
  };
};

const loadDashboardStats = async () => {
  const overview = await getOverview();

  const recentApplications = await Application.find({})
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const now = new Date();
  const upcomingInterviews = await Interview.find({
    scheduledAt: { $gte: now },
    status: 'scheduled',
  })
    .sort({ scheduledAt: 1 })
    .limit(10)
    .lean();

  const openJobsList = await Job.find({
    status: { $in: ['open', 'on_hold'] },
  }).lean();

  const jobStats = await Promise.all(
    openJobsList.map(async job => {
      const [total, inPipeline, hired, pending] = await Promise.all([
        Application.countDocuments({ jobId: job._id }),
        Application.countDocuments({ jobId: job._id, phase: 'approved' }),
        Application.countDocuments({ jobId: job._id, phase: 'hired' }),
        Application.countDocuments({ jobId: job._id, phase: 'pending' }),
      ]);

      const client = await Client.findById(job.clientId).lean();

      return {
        jobId: String(job._id),
        jobTitle: job.title,
        clientName: client?.companyName ?? 'Unknown',
        status: job.status,
        openings: job.openings,
        totalApplications: total,
        approvedCount: inPipeline,
        hiredCount: hired,
        pendingCount: pending,
      };
    })
  );

  return {
    overview,
    recentApplications,
    upcomingInterviews,
    jobStats,
  };
};

const idOf = (v: unknown): string => String(v);

/**
 * Slim payload for the ATS dashboard: the aggregate counts plus ONLY the
 * fields the dashboard charts read from each entity (see Dash* types in the
 * frontend `dashboard.types.ts` — keep the two in step). The full list
 * endpoints return whole documents (parsed resumes, AI data, feedback…) which
 * made the dashboard download megabytes to draw a handful of charts.
 *
 * Documents are hydrated (not lean) so schema defaults still apply to legacy
 * records, matching what the list endpoints return.
 */
const loadDashboardMetrics = async () => {
  const [overview, clients, jobs, candidates, applications, interviews] =
    await Promise.all([
      getOverview(),
      Client.find({}).select('createdAt companyName'),
      Job.find({}).select('status clientId createdAt title'),
      // Same default as the candidates list: permanently ineligible excluded.
      Candidate.find({
        eligibilityStatus: { $ne: 'permanently_ineligible' },
      }).select('status createdAt inTalentPool eligibilityStatus'),
      Application.find({}).select(
        'phase jobId candidateId appliedAt hiredAt source'
      ),
      Interview.find({}).select('status'),
    ]);

  return {
    overview,
    clients: clients.map(c => ({
      _id: idOf(c._id),
      createdAt: c.createdAt,
      companyName: c.companyName,
    })),
    jobs: jobs.map(j => ({
      _id: idOf(j._id),
      status: j.status,
      clientId: idOf(j.clientId),
      createdAt: j.createdAt,
      title: j.title,
    })),
    candidates: candidates.map(c => ({
      _id: idOf(c._id),
      // Same guards as Candidate.toSafeObject for legacy documents.
      status: c.status || 'pending',
      createdAt: c.createdAt,
      inTalentPool: c.inTalentPool,
      eligibilityStatus: c.eligibilityStatus || 'eligible',
    })),
    applications: applications.map(a => ({
      _id: idOf(a._id),
      phase: a.phase,
      jobId: idOf(a.jobId),
      candidateId: idOf(a.candidateId),
      appliedAt: a.appliedAt,
      hiredAt: a.hiredAt,
      source: a.source,
    })),
    interviews: interviews.map(i => ({
      _id: idOf(i._id),
      status: i.status,
    })),
  };
};

// The dashboard re-counts every collection on each visit; the numbers only move
// when something is written, so serve them from the shared list cache (rebuilt
// on any candidate, application, job or client change).
const DASHBOARD_ROOMS = ['candidates', 'applications', 'jobs', 'clients'];

export const getDashboardStats = (): ReturnType<typeof loadDashboardStats> =>
  cachedList('dashboard-stats', DASHBOARD_ROOMS, {}, loadDashboardStats);

export const getDashboardMetrics = (): ReturnType<
  typeof loadDashboardMetrics
> => cachedList('dashboard-metrics', DASHBOARD_ROOMS, {}, loadDashboardMetrics);
