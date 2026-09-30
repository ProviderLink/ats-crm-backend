export const INTERVIEW_MEETING_TYPES = [
  'initial_screening',
  'group_interview',
  'technical_interview',
  'panel_interview',
  'final_interview',
  'hr_interview',
  'culture_fit',
  'other',
] as const;
export type InterviewMeetingType = (typeof INTERVIEW_MEETING_TYPES)[number];

export interface IInterviewFeedback {
  _id: string;
  interviewerId: string;
  rating: number;
  notes: string;
  recommendation: string;
  submittedAt: Date;
}

export interface IInterviewMeetingDetails {
  link: string | null;
  meetingId: string | null;
  password: string | null;
  phoneNumber: string | null;
  address: string | null;
}

export interface IInterview {
  _id: string;
  applicationId: string;
  candidateId: string;
  jobId: string;
  clientId: string;
  title: string;
  type: string;
  /**
   * Always the company timezone from Settings.
   *
   * Retained on the document (rather than resolved on read) because the value
   * an interview was booked under is part of its record — and emails render the
   * stored value.
   */
  timezone: string;
  /**
   * Kept for existing records and the calendar/email rendering, but no longer
   * settable: a fixed 60-minute default is applied server-side.
   */
  duration: number;
  status: string;
  scheduledAt: Date;
  meetingDetails: IInterviewMeetingDetails | null;
  interviewerIds: string[];
  /**
   * Display names for `interviewerIds`, resolved server-side.
   *
   * The client used to look these up in the boot-loaded user list, which is
   * incomplete for non-admin roles (`team:read` is not granted everywhere) and
   * printed raw ObjectIds for anyone missing. Optional because older/partial
   * payloads may not carry it — and a user deleted after the interview was
   * scheduled legitimately has no name to show.
   */
  interviewerNames?: string[];
  feedbacks: IInterviewFeedback[];
  organizerId: string;
  reminderSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInterviewInput {
  applicationId: string;
  candidateId: string;
  jobId: string;
  clientId: string;
  title: string;
  type: 'zoom' | 'google_meet' | 'phone_call' | 'in_person';
  scheduledAt: Date | string;
  /** Optional — defaults to the organiser when empty. */
  interviewerIds?: string[];
  organizerId: string;
  meetingDetails?: Partial<IInterviewMeetingDetails>;
}

export interface SubmitFeedbackInput {
  interviewerId: string;
  rating: number;
  notes: string;
  recommendation: 'strong_yes' | 'yes' | 'neutral' | 'no' | 'strong_no';
}

export interface UpdateInterviewInput {
  title?: string;
  type?: 'zoom' | 'google_meet' | 'phone_call' | 'in_person';
  scheduledAt?: Date | string;
  interviewerIds?: string[];
  status?: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  meetingDetails?: Partial<IInterviewMeetingDetails>;
}
