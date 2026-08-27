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

export const INTERVIEW_MEETING_TYPE_LABELS: Record<
  InterviewMeetingType,
  string
> = {
  initial_screening: 'Initial Screening',
  group_interview: 'Group Interview',
  technical_interview: 'Technical Interview',
  panel_interview: 'Panel Interview',
  final_interview: 'Final Interview',
  hr_interview: 'HR Interview',
  culture_fit: 'Culture Fit',
  other: 'Other',
};

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
  interviewType: InterviewMeetingType;
  round: number;
  status: string;
  scheduledAt: Date;
  duration: number;
  timezone: string;
  meetingDetails: IInterviewMeetingDetails | null;
  interviewerIds: string[];
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
  interviewType?: InterviewMeetingType;
  type: 'zoom' | 'google_meet' | 'phone_call' | 'in_person';
  round: number;
  scheduledAt: Date | string;
  duration: number;
  timezone: string;
  interviewerIds: string[];
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
  scheduledAt?: Date | string;
  duration?: number;
  timezone?: string;
  interviewerIds?: string[];
  status?: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  meetingDetails?: Partial<IInterviewMeetingDetails>;
}
