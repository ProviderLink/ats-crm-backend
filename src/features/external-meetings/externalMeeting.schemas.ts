import { z } from 'zod';
import {
  INTERVIEW_DURATIONS,
  meetingDetailsSchema,
} from '../interviews/interview.schemas';
import { EXTERNAL_MEETING_TYPES } from './externalMeeting.types';

/**
 * Same allowed lengths and meeting-detail rules as ATS interviews, so the two
 * forms behave identically. Imported (read-only) rather than copied.
 */
const duration = z
  .number()
  .refine(v => (INTERVIEW_DURATIONS as readonly number[]).includes(v), {
    message: `Duration must be one of ${INTERVIEW_DURATIONS.join(', ')} minutes`,
  })
  .optional();

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable();

const optionalEmail = z
  .union([z.string().trim().max(254).email(), z.literal('')])
  .optional()
  .nullable();

const attendeeIds = z.array(z.string().min(1)).optional();

export const createExternalMeetingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  personName: z.string().trim().min(1).max(120),
  personEmail: optionalEmail,
  personPhone: optionalText(50),
  jobLabel: optionalText(200),
  type: z.enum(EXTERNAL_MEETING_TYPES),
  scheduledAt: z.string().datetime(),
  duration,
  attendeeIds,
  meetingDetails: meetingDetailsSchema,
  notes: optionalText(2000),
});

export const updateExternalMeetingSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  personName: z.string().trim().min(1).max(120).optional(),
  personEmail: optionalEmail,
  personPhone: optionalText(50),
  jobLabel: optionalText(200),
  type: z.enum(EXTERNAL_MEETING_TYPES).optional(),
  scheduledAt: z.string().datetime().optional(),
  duration,
  attendeeIds,
  meetingDetails: meetingDetailsSchema,
  notes: optionalText(2000),
  status: z.enum(['scheduled', 'completed']).optional(),
});
