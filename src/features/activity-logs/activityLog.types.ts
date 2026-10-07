export type ActivityLogResourceType =
  | 'candidate'
  | 'job'
  | 'client'
  | 'application'
  | 'interview'
  | 'user'
  | 'assignment'
  | 'eod'
  | 'performance_review'
  | 'survey'
  | 'tag'
  | 'work_entry'
  | 'settings'
  | 'scorecards'
  | 'vaProfile'
  | 'client_account';

export type ActivityAction =
  // ── Generic ────────────────────────────────────────────
  | 'created'
  | 'updated'
  | 'deleted'
  // ── Candidate ──────────────────────────────────────────
  | 'talent_pool_added'
  | 'talent_pool_removed'
  | 'status_changed'
  | 'eligibility_changed'
  | 'ai_score_updated'
  | 'ai_validation_updated'
  | 'parsed_data_updated'
  // ── Application ────────────────────────────────────────
  | 'applied'
  | 'rejected'
  | 'hired'
  | 'approved'
  | 'stage_changed'
  | 'notes_updated'
  | 'disposition'
  // A candidate moved from one job to another. Distinct from 'rejected' so a
  // move never renders as a rejection on the application card or job board.
  | 'job_changed'
  // ── Interview (logged under application resource) ──────
  | 'interview_scheduled'
  | 'interview_updated'
  | 'interview_cancelled'
  | 'interview_completed'
  | 'interview_no_show'
  | 'interview_feedback_submitted'
  // ── Job ────────────────────────────────────────────────
  | 'pipeline_changed'
  // ── Client ─────────────────────────────────────────────
  | 'contact_added'
  | 'contact_updated'
  | 'contact_removed'
  | 'crm_profile_updated'
  | 'note_added'
  | 'note_updated'
  | 'note_deleted'
  // ── User ───────────────────────────────────────────────
  | 'deactivated'
  | 'reactivated'
  | 'permissions_updated'
  | 'provisioned_va'
  | 'provisioned_client'
  // ── Assignment ─────────────────────────────────────────
  | 'ended'
  // ── Performance Review ─────────────────────────────────
  | 'review_generated'
  | 'review_completed'
  // ── Scorecard ──────────────────────────────────────────
  | 'scorecard_generated'
  // ── EOD / Survey / Settings ────────────────────────────
  | 'eod_compliance_checked'
  | 'eod_submitted'
  | 'eod_deleted'
  | 'survey_dispatched'
  | 'settings_updated'
  // ── CRM ────────────────────────────────────────────────
  | 'revoked_crm'
  | 'crm_client_account_updated'
  | 'va_profile_updated'
  // ── Performance Review ─────────────────────────────────
  | 'review_deleted'
  // ── Disposition ────────────────────────────────────────
  | 'ineligible_reapply_blocked'
  | 'legal_hold_toggled';

export interface IActivityLog {
  _id: string;
  action: ActivityAction;
  resourceType: ActivityLogResourceType;
  resourceId: string;
  relatedType: string | null;
  relatedId: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  performedBy: string | null;
  createdAt: Date;
}

export interface CreateActivityLogInput {
  action: ActivityAction;
  resourceType: ActivityLogResourceType;
  resourceId: string;
  relatedType?: string | null;
  relatedId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  performedBy?: string | null;
}
