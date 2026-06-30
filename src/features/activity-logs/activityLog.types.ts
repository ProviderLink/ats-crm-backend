export type ActivityLogResourceType =
  | 'candidate'
  | 'job'
  | 'client'
  | 'application'
  | 'interview'
  | 'email'
  | 'user'
  | 'assignment'
  | 'eod'
  | 'performance_review'
  | 'survey'
  | 'tag'
  | 'work_entry'
  | 'settings';

export interface IActivityLog {
  _id: string;
  type: string;
  resourceType: ActivityLogResourceType;
  resourceId: string;
  relatedType: string | null;
  relatedId: string | null;
  metadata: Record<string, unknown>;
  performedBy: string | null;
  createdAt: Date;
}

export interface CreateActivityLogInput {
  type: string;
  resourceType: ActivityLogResourceType;
  resourceId: string;
  relatedType?: string | null;
  relatedId?: string | null;
  metadata?: Record<string, unknown>;
  performedBy?: string | null;
}
