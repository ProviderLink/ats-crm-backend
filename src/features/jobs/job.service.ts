import mongoose from 'mongoose';
import { AppError } from '../../shared/utils/AppError';
import Application from '../applications/application.model';
import Client from '../clients/client.model';
import PipelineTemplate from '../pipeline-templates/pipelineTemplate.model';
import Job from './job.model';
import {
  AssignPipelineInput,
  CreateJobInput,
  IJob,
  UpdateJobInput,
} from './job.types';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['open'],
  open: ['on_hold', 'closed'],
  on_hold: ['open', 'closed'],
  closed: [],
};

export const getAllJobs = async (filters: {
  clientId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{
  jobs: IJob[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { clientId, status, search, page = 1, limit = 20 } = filters;
  const query: Record<string, unknown> = {};

  if (clientId) query['clientId'] = clientId;
  if (status) query['status'] = status;
  if (search) query['$text'] = { $search: search };

  const skip = (page - 1) * limit;
  const [jobs, total] = await Promise.all([
    Job.find(query).skip(skip).limit(limit).lean(false),
    Job.countDocuments(query),
  ]);

  return {
    jobs: jobs.map(j => j.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getJobById = async (id: string): Promise<IJob> => {
  const job = await Job.findById(id);
  if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
  return job.toSafeObject();
};

export const createJob = async (
  input: CreateJobInput,
  createdBy: string
): Promise<IJob> => {
  const client = await Client.findById(input.clientId);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  const job = await Job.create({
    ...input,
    status: 'draft',
    createdBy,
  });
  return job.toSafeObject();
};

export const updateJob = async (
  id: string,
  input: UpdateJobInput,
  updatedBy: string
): Promise<IJob> => {
  const job = await Job.findById(id);
  if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');

  const fields = Object.keys(input) as (keyof UpdateJobInput)[];
  for (const field of fields) {
    if (input[field] !== undefined) {
      (job as unknown as Record<string, unknown>)[field] = input[field];
    }
  }
  job.updatedBy = new mongoose.Types.ObjectId(
    updatedBy
  ) as unknown as mongoose.Types.ObjectId;

  await job.save();
  return job.toSafeObject();
};

export const deleteJob = async (id: string): Promise<{ deleted: boolean }> => {
  const job = await Job.findById(id);
  if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');

  const activeApps = await Application.countDocuments({
    jobId: id,
    phase: { $in: ['pending', 'approved'] },
  });
  if (activeApps > 0) {
    throw new AppError(
      400,
      'JOB_HAS_ACTIVE_APPLICATIONS',
      'Cannot delete job with active applications'
    );
  }

  await job.deleteOne();
  return { deleted: true };
};

export const assignPipeline = async (
  jobId: string,
  input: AssignPipelineInput,
  updatedBy: string
): Promise<IJob> => {
  const job = await Job.findById(jobId);
  if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');

  const template = await PipelineTemplate.findById(input.templateId);
  if (!template) {
    throw new AppError(
      404,
      'PIPELINE_TEMPLATE_NOT_FOUND',
      'Pipeline template not found'
    );
  }

  const copiedStages = template.stages.map(stage => ({
    _id: new mongoose.Types.ObjectId(),
    name: stage.name,
    color: stage.color,
    order: stage.order,
    isActive: stage.isActive,
    icon: stage.icon ?? 'ClipboardList',
  }));

  job.pipeline = {
    templateId: template._id as mongoose.Types.ObjectId,
    stages: copiedStages,
  };
  job.updatedBy = new mongoose.Types.ObjectId(
    updatedBy
  ) as unknown as mongoose.Types.ObjectId;

  await job.save();
  return job.toSafeObject();
};

export const updateJobStatus = async (
  id: string,
  status: string,
  updatedBy: string
): Promise<IJob> => {
  const job = await Job.findById(id);
  if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');

  const allowed = ALLOWED_TRANSITIONS[job.status] ?? [];
  if (!allowed.includes(status)) {
    throw new AppError(
      400,
      'INVALID_STATUS_TRANSITION',
      `Cannot transition job from ${job.status} to ${status}`
    );
  }

  job.status = status;
  job.updatedBy = new mongoose.Types.ObjectId(
    updatedBy
  ) as unknown as mongoose.Types.ObjectId;

  await job.save();
  return job.toSafeObject();
};
