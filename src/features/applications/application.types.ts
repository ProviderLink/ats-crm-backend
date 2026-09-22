export interface IApplicationCurrentStage {
  stageId: string;
  stageName: string;
  assignedAt: Date;
  assignedBy: string;
}

export interface IApplicationAiValidation {
  isValid: boolean;
  score: number;
  reason: string;
  completedAt: Date;
}

export interface IApplicationAiScore {
  score: number;
  recommendation: string;
  summary: string;
  strengths: string[];
  concerns: string[];
}

export interface IApplication {
  _id: string;
  candidateId: string;
  jobId: string;
  clientId: string;
  phase: string;
  currentStage: IApplicationCurrentStage | null;
  lastStage: IApplicationCurrentStage | null;
  source: string;
  aiValidation: IApplicationAiValidation | null;
  aiScore: IApplicationAiScore | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  closedAt: Date | null;
  closedBy: string | null;
  dispositionDate: Date | null;
  dispositionReasonId: string | null;
  dispositionDestination: 'candidate_pool' | 'permanently_ineligible' | null;
  internalNotes: string | null;
  isBlocked: boolean;
  interviewIds: string[];
  notes: string | null;
  hiredAt: Date | null;
  hiredBy: string | null;
  appliedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateApplicationInput {
  candidateId: string;
  jobId: string;
  clientId: string;
  source: 'direct_apply' | 'internal_upload' | 'assigned';
  createdBy?: string;
  appliedAt?: Date;
}

export interface ApproveApplicationInput {
  approvedBy: string;
}

export interface RejectApplicationInput {
  rejectedBy: string;
  /** Legacy free-text reason — still accepted and stored as rejectionReason. */
  reason?: string;
  /** Structured reason. When supplied, the application is closed with the full
   * disposition payload and the candidate is routed to the chosen destination. */
  rejectionReasonId?: string;
  destination?: 'candidate_pool' | 'permanently_ineligible';
  internalNotes?: string;
}

export interface DisposeApplicationInput {
  dispositionReasonId: string;
  destination: 'candidate_pool' | 'permanently_ineligible';
  internalNotes?: string;
  performedBy: string;
}

export interface MoveStageInput {
  stageId: string;
  movedBy: string;
}

export interface HireApplicationInput {
  hiredBy: string;
}
