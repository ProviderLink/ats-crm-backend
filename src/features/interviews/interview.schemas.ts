import { z } from 'zod';

/**
 * Shared zod schemas for interview mutations.
 *
 * These live in their own module because TWO routers mount interview routes:
 * `interview.routes.ts` (flat `/interviews`) and `application.routes.ts`
 * (nested `/applications/:applicationId/interviews`). Keeping one copy means a
 * field can never be accepted by one route and silently stripped by the other.
 *
 * Deliberately absent, because the schedule form does not ask for them and the
 * server owns the value:
 * - `timezone`  → always the company timezone from Settings.
 * - `duration` on UPDATE → create-only; reschedule reuses the stored value.
 * - `round` / `interviewType` → interviews are not numbered or staged.
 */

export const INTERVIEW_TYPES = [
  'zoom',
  'google_meet',
  'phone_call',
  'in_person',
] as const;

/** Allowed interview lengths in minutes. Omitted on create → 60. */
export const INTERVIEW_DURATIONS = [10, 15, 30, 60] as const;

const duration = z
  .number()
  .refine(v => (INTERVIEW_DURATIONS as readonly number[]).includes(v), {
    message: `Duration must be one of ${INTERVIEW_DURATIONS.join(', ')} minutes`,
  })
  .optional();

const MEETING_LINK_MAX = 2000;

/**
 * A meeting link may be absent, null, or an EMPTY STRING.
 *
 * Empty is accepted because the client sends `link: null` for every non-link
 * interview type anyway, and a half-cleared input should be a no-op rather than
 * a 400. Anything non-empty must be a real URL. The service trims and coerces
 * blank values to `null` so the stored value is never `''`.
 */
const meetingLink = z
  .union([z.string().trim().max(MEETING_LINK_MAX).url(), z.literal('')])
  .optional()
  .nullable();

export const meetingDetailsSchema = z
  .object({
    link: meetingLink,
    phoneNumber: z.string().trim().max(50).optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
  })
  .optional();

/**
 * Interviewers may legitimately be empty: the organiser is implicitly the
 * interviewer, and ad-hoc scheduling should never be blocked on a chip click.
 * The client defaults the field to the signed-in user and the backend keeps
 * that default when nothing is sent.
 */
const interviewerIds = z.array(z.string().min(1)).optional();

export const createInterviewSchema = z.object({
  applicationId: z.string().min(1),
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  clientId: z.string().min(1),
  title: z.string().min(1).max(200),
  type: z.enum(INTERVIEW_TYPES),
  scheduledAt: z.string().datetime(),
  duration,
  interviewerIds,
  meetingDetails: meetingDetailsSchema,
});

export const createNestedInterviewSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(INTERVIEW_TYPES),
  jobId: z.string().min(1).optional(),
  scheduledAt: z.string().datetime(),
  duration,
  interviewerIds,
  meetingDetails: meetingDetailsSchema,
});

export const updateInterviewSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  type: z.enum(INTERVIEW_TYPES).optional(),
  scheduledAt: z.string().datetime().optional(),
  interviewerIds: z.array(z.string().min(1)).optional(),
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']).optional(),
  meetingDetails: meetingDetailsSchema,
});

export const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  notes: z.string(),
  recommendation: z.enum(['strong_yes', 'yes', 'neutral', 'no', 'strong_no']),
});
