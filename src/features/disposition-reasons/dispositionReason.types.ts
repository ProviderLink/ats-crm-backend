export type DispositionReasonCategory =
  | 'experience_and_qualifications'
  | 'interview_performance'
  | 'availability_and_employment'
  | 'recruiter_or_client_selection'
  | 'candidate_actions'
  | 'permanently_ineligible_reasons'
  | 'other';

export interface IDispositionReason {
  _id: string;
  label: string;
  category: DispositionReasonCategory;
  isActive: boolean;
  order: number;
  applicableStages: string[];
  defaultEligibility: 'eligible' | 'permanently_ineligible';
  requireInternalNotes: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDispositionReasonInput {
  label: string;
  category: DispositionReasonCategory;
  isActive?: boolean;
  order?: number;
  applicableStages?: string[];
  defaultEligibility?: 'eligible' | 'permanently_ineligible';
  requireInternalNotes?: boolean;
  createdBy?: string | null;
}

export interface UpdateDispositionReasonInput {
  label?: string;
  category?: DispositionReasonCategory;
  isActive?: boolean;
  order?: number;
  applicableStages?: string[];
  defaultEligibility?: 'eligible' | 'permanently_ineligible';
  requireInternalNotes?: boolean;
  updatedBy?: string | null;
}
