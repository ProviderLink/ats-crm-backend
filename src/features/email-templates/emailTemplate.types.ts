export type EmailTemplateType =
  | 'interview'
  | 'offer'
  | 'rejection'
  | 'follow_up'
  | 'eod_reminder'
  | 'survey_reminder'
  | 'general'
  | 'application_confirmation';

export const SYSTEM_VARIABLES = [
  'candidateName',
  'candidateEmail',
  'candidatePhone',
  'jobTitle',
  'clientName',
  'interviewDate',
  'interviewTime',
  'interviewType',
  'meetingLink',
  'interviewerName',
  'companyName',
  'currentStage',
  'senderName',
] as const;

export type SystemVariable = (typeof SYSTEM_VARIABLES)[number];

export interface IEmailTemplate {
  _id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  type: EmailTemplateType;
  variables: SystemVariable[];
  isDefault: boolean;
  isActive: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEmailTemplateInput {
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  type: EmailTemplateType;
  variables?: SystemVariable[];
  isDefault?: boolean;
}

export interface UpdateEmailTemplateInput {
  name?: string;
  subject?: string;
  bodyHtml?: string;
  bodyText?: string;
  type?: EmailTemplateType;
  variables?: SystemVariable[];
  isDefault?: boolean;
  isActive?: boolean;
}
