export interface IJobStage {
  _id: string;
  name: string;
  color: string;
  order: number;
  isActive: boolean;
  icon: string;
}

export interface IJobPipeline {
  templateId: string | null;
  stages: IJobStage[];
}

export interface IJobSalaryRange {
  min: number;
  max: number;
  currency: string;
  period: string;
}

export interface IJob {
  _id: string;
  title: string;
  description: string;
  clientId: string;
  status: string;
  jobType: string;
  locationType: string;
  location: string;
  experienceLevel: string;
  priority: string;
  openings: number;
  requirements: string[];
  responsibilities: string[];
  skills: string[];
  tags: string[];
  salaryRange: IJobSalaryRange | null;
  pipeline: IJobPipeline | null;
  applicationDeadline: Date | null;
  startDate: Date | null;
  benefits: string[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateJobInput {
  title: string;
  description: string;
  clientId: string;
  jobType: string;
  locationType: string;
  location?: string;
  experienceLevel: string;
  priority?: string;
  openings?: number;
  requirements?: string[];
  responsibilities?: string[];
  skills?: string[];
  tags?: string[];
  salaryRange?: IJobSalaryRange | null;
  pipelineTemplateId?: string;
  applicationDeadline?: Date | null;
  startDate?: Date | null;
  benefits?: string[];
}

export interface UpdateJobInput {
  title?: string;
  description?: string;
  jobType?: string;
  locationType?: string;
  location?: string;
  experienceLevel?: string;
  priority?: string;
  openings?: number;
  requirements?: string[];
  responsibilities?: string[];
  skills?: string[];
  tags?: string[];
  salaryRange?: IJobSalaryRange | null;
  applicationDeadline?: Date | null;
  startDate?: Date | null;
  benefits?: string[];
}

export interface AssignPipelineInput {
  templateId: string;
}
