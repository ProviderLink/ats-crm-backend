import type { IJob } from './job.types';

/**
 * The fields of a job that anonymous visitors (the careers portal) may see.
 * Internal fields — client, owner/editor ids, pipeline, tags, priority — are
 * left out; signed-in staff still receive the full job.
 */
export const toPublicJob = (job: IJob) => ({
  _id: job._id,
  title: job.title,
  description: job.description,
  status: job.status,
  jobType: job.jobType,
  locationType: job.locationType,
  location: job.location,
  experienceLevel: job.experienceLevel,
  openings: job.openings,
  requirements: job.requirements,
  responsibilities: job.responsibilities,
  skills: job.skills,
  benefits: job.benefits,
  salaryRange: job.salaryRange,
  applicationDeadline: job.applicationDeadline,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});
