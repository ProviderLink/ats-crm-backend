export const EXTERNAL_MEETING_TYPES = [
  'video',
  'phone_call',
  'in_person',
] as const;
export type ExternalMeetingType = (typeof EXTERNAL_MEETING_TYPES)[number];

export const EXTERNAL_MEETING_STATUSES = [
  'scheduled',
  'completed',
  'cancelled',
] as const;
export type ExternalMeetingStatus = (typeof EXTERNAL_MEETING_STATUSES)[number];

export interface IExternalMeetingDetails {
  link: string | null;
  /** Set only when the Zoom link was auto-filled from the company room. */
  meetingId: string | null;
  password: string | null;
  phoneNumber: string | null;
  address: string | null;
}

/**
 * A meeting with someone who is NOT in the ATS. Deliberately standalone: no
 * candidate, application, job or client reference, so nothing here can leak
 * into candidate lists, job pipelines, reports or the activity timeline.
 */
export interface IExternalMeeting {
  _id: string;
  /** Discriminator the calendar uses to tell these apart from interviews. */
  kind: 'external';
  title: string;
  personName: string;
  personEmail: string | null;
  personPhone: string | null;
  /** Free-text label only ("Other" or an open job's title). Never a reference. */
  jobLabel: string | null;
  type: ExternalMeetingType;
  status: ExternalMeetingStatus;
  scheduledAt: Date;
  duration: number;
  timezone: string;
  meetingDetails: IExternalMeetingDetails;
  notes: string | null;
  attendeeIds: string[];
  attendeeNames?: string[];
  organizerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExternalMeetingInput {
  title: string;
  personName: string;
  personEmail?: string | null;
  personPhone?: string | null;
  jobLabel?: string | null;
  type: ExternalMeetingType;
  scheduledAt: Date | string;
  duration?: number;
  attendeeIds?: string[];
  meetingDetails?: Partial<IExternalMeetingDetails>;
  notes?: string | null;
  organizerId: string;
}

export interface UpdateExternalMeetingInput {
  title?: string;
  personName?: string;
  personEmail?: string | null;
  personPhone?: string | null;
  jobLabel?: string | null;
  type?: ExternalMeetingType;
  scheduledAt?: Date | string;
  duration?: number;
  attendeeIds?: string[];
  meetingDetails?: Partial<IExternalMeetingDetails>;
  notes?: string | null;
  status?: 'scheduled' | 'completed';
}
