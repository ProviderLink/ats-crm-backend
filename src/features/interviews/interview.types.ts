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
