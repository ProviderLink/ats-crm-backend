import mongoose from 'mongoose';
import { AppError } from '../../shared/utils/AppError';
import { emitToAts } from '../../sockets';
import { createLog } from '../activity-logs/activityLog.service';
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

  // --- Pipeline assignment (§5.9) ---
  let pipelineTemplate;
  if (input.pipelineTemplateId) {
    // User explicitly selected a template
    pipelineTemplate = await PipelineTemplate.findById(
      input.pipelineTemplateId
    );
    if (!pipelineTemplate) {
      throw new AppError(
        404,
        'PIPELINE_TEMPLATE_NOT_FOUND',
        'Selected pipeline template not found'
      );
    }
  } else {
    // No template selected — auto-assign the default
    pipelineTemplate = await PipelineTemplate.findOne({ isDefault: true });
    if (!pipelineTemplate) {
      throw new AppError(
        422,
        'PIPELINE_REQUIRED',
        'No default pipeline template exists. Please create one or select a template.'
      );
    }
  }

  const copiedStages = pipelineTemplate.stages.map(stage => ({
    _id: new mongoose.Types.ObjectId(),
    name: stage.name,
    color: stage.color,
    order: stage.order,
    isActive: stage.isActive,
    icon: stage.icon ?? 'ClipboardList',
  }));

  const { pipelineTemplateId: _unused, ...restInput } = input;

  const job = await Job.create({
    ...restInput,
    status: 'draft',
    pipeline: {
      templateId: pipelineTemplate._id as mongoose.Types.ObjectId,
      stages: copiedStages,
    },
    createdBy,
  });

  createLog({
    action: 'created',
    resourceType: 'job',
    resourceId: job._id.toString(),
    performedBy: createdBy,
  });

  const result = job.toSafeObject();
  emitToAts('jobs', 'job:created', result);
  return result;
};

export const updateJob = async (
  id: string,
  input: UpdateJobInput,
  updatedBy: string
): Promise<IJob> => {
  const job = await Job.findById(id);
  if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');

  const fieldLabels: Partial<Record<keyof UpdateJobInput, string>> = {
    title: 'Title',
    description: 'Description',
    jobType: 'Job type',
    locationType: 'Location type',
    location: 'Location',
    experienceLevel: 'Experience level',
    priority: 'Priority',
    openings: 'Number of openings',
    requirements: 'Requirements',
    responsibilities: 'Responsibilities',
    skills: 'Required skills',
    tags: 'Tags',
    salaryRange: 'Salary range',
    applicationDeadline: 'Application deadline',
    startDate: 'Start date',
    benefits: 'Benefits',
  };

  const changes: string[] = [];
  const fields = Object.keys(input) as (keyof UpdateJobInput)[];

  for (const field of fields) {
    if (input[field] !== undefined) {
      const oldVal = (job as unknown as Record<string, unknown>)[field];
      const newVal = input[field];
      const label = fieldLabels[field] ?? field;
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        if (Array.isArray(newVal) || typeof newVal === 'object') {
          changes.push(`${label} updated`);
        } else {
          changes.push(
            `${label} changed from "${String(oldVal)}" to "${String(newVal)}"`
          );
        }
      }
      (job as unknown as Record<string, unknown>)[field] = input[field];
    }
  }
  job.updatedBy = new mongoose.Types.ObjectId(
    updatedBy
  ) as unknown as mongoose.Types.ObjectId;

  await job.save();

  createLog({
    action: 'updated',
    resourceType: 'job',
    resourceId: id,
    metadata: changes.length > 0 ? { changes } : {},
    performedBy: updatedBy,
  });

  const result = job.toSafeObject();
  emitToAts('jobs', 'job:updated', result);
  return result;
};

export const deleteJob = async (
  id: string,
  deletedBy?: string
): Promise<{ deleted: boolean }> => {
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

  createLog({
    action: 'deleted',
    resourceType: 'job',
    resourceId: id,
    performedBy: deletedBy ?? null,
  });

  emitToAts('jobs', 'job:deleted', { _id: id });
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

  // --- Remap applications to new stages ---
  const applications = await Application.find({ jobId });

  if (applications.length > 0) {
    // Build lookup: new stage name (lowercased) → new stage
    const newStageByName = new Map<string, (typeof copiedStages)[number]>();
    for (const stage of copiedStages) {
      newStageByName.set(stage.name.toLowerCase(), stage);
    }

    // First stage (lowest order) as fallback
    const firstStage = copiedStages.reduce((min, s) =>
      s.order < min.order ? s : min
    );

    // Resolve the target new stage name for a given old stage name
    const resolveNewStageName = (oldStageName: string): string | undefined => {
      if (input.stageMapping) {
        // Use explicit mapping: oldStageName → newStageName
        return input.stageMapping[oldStageName];
      }
      // Auto name-match: keep the same name
      return oldStageName;
    };

    const bulkOps = applications.map(app => {
      const oldStageName = app.currentStage?.stageName;
      let targetStage: (typeof copiedStages)[number] | undefined;

      if (oldStageName) {
        const newStageName = resolveNewStageName(oldStageName);
        if (newStageName) {
          targetStage = newStageByName.get(newStageName.toLowerCase());
        }
      }

      // Fallback to first stage if no match found
      const resolvedStage = targetStage ?? firstStage;

      return {
        updateOne: {
          filter: { _id: app._id },
          update: {
            $set: {
              'currentStage.stageId': resolvedStage._id,
              'currentStage.stageName': resolvedStage.name,
              'currentStage.assignedAt': new Date(),
              'currentStage.assignedBy': new mongoose.Types.ObjectId(updatedBy),
            },
          },
        },
      };
    });

    await Application.bulkWrite(bulkOps);
  }

  job.pipeline = {
    templateId: template._id as mongoose.Types.ObjectId,
    stages: copiedStages,
  };
  job.updatedBy = new mongoose.Types.ObjectId(
    updatedBy
  ) as unknown as mongoose.Types.ObjectId;

  await job.save();

  createLog({
    action: 'pipeline_changed',
    resourceType: 'job',
    resourceId: jobId,
    metadata: {
      templateName: template.name,
      applicationsRemapped: applications.length,
    },
    performedBy: updatedBy,
  });

  const result = job.toSafeObject();
  emitToAts('jobs', 'job:updated', result);
  return result;
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

  const previousStatus = job.status;
  job.status = status;
  job.updatedBy = new mongoose.Types.ObjectId(
    updatedBy
  ) as unknown as mongoose.Types.ObjectId;

  await job.save();

  createLog({
    action: 'status_changed',
    resourceType: 'job',
    resourceId: id,
    metadata: { from: previousStatus, to: status },
    performedBy: updatedBy,
  });

  const result = job.toSafeObject();
  emitToAts('jobs', 'job:updated', result);
  emitToAts('jobs', 'job:statusChanged', { _id: result._id, status });
  return result;
};
