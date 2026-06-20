import Application from '../../applications/application.model';
import Candidate from '../../candidates/candidate.model';
import Client from '../../clients/client.model';
import Interview from '../../interviews/interview.model';
import Job from '../../jobs/job.model';

export const getDashboardStats = async () => {
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
  ] = await Promise.all([
    Candidate.countDocuments({}),
    Candidate.countDocuments({ status: 'approved' }),
    Candidate.countDocuments({ status: 'hired' }),
    Job.countDocuments({}),
    Job.countDocuments({ status: 'open' }),
    Client.countDocuments({}),
    Client.countDocuments({ status: 'active' }),
    Application.countDocuments({}),
    Application.countDocuments({ phase: 'pending' }),
    Application.countDocuments({ phase: 'approved' }),
  ]);

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
    overview: {
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
    },
    recentApplications,
    upcomingInterviews,
    jobStats,
  };
};
