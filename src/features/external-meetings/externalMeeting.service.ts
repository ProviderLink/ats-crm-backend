import mongoose from 'mongoose';
import { AppError } from '../../shared/utils/AppError';
import { getCompanyTimezone } from '../../shared/utils/companyTimezone';
import logger from '../../shared/utils/logger';
import { getPersonalMeetingRoom } from '../../shared/utils/zoom';
import { safeEmitToAts } from '../../sockets';
import User from '../users/user.model';
import {
  sendExternalMeetingCancelledEmails,
  sendExternalMeetingScheduledEmails,
  sendExternalMeetingUpdatedEmails,
} from './externalMeetingEmail.service';
import ExternalMeeting from './externalMeeting.model';
import type {
  CreateExternalMeetingInput,
  IExternalMeeting,
  IExternalMeetingDetails,
  UpdateExternalMeetingInput,
} from './externalMeeting.types';

/** Default length when the client sends none, matching ATS interviews. */
const DEFAULT_DURATION_MINUTES = 60;

/** Collapse an optional string to `null` so stored values are never `''`. */
const trimOrNull = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Team attendee display names for a batch, resolved with ONE query (there is
 * no `populate()` in this codebase). A deleted user falls back to the raw id.
 */
const attachAttendeeNames = async (
  meetings: IExternalMeeting[]
): Promise<IExternalMeeting[]> => {
  const ids = new Set<string>();
  for (const m of meetings) for (const id of m.attendeeIds) ids.add(id);

  const byId = new Map<string, string>();
  if (ids.size > 0) {
    const users = await User.find({ _id: { $in: [...ids] } })
      .select('firstName lastName')
      .lean();
    for (const u of users)
      byId.set(String(u._id), `${u.firstName} ${u.lastName}`);
  }
  for (const m of meetings) {
    m.attendeeNames = m.attendeeIds.map(id => byId.get(id) ?? id);
  }
  return meetings;
};

const attachOne = async (m: IExternalMeeting): Promise<IExternalMeeting> =>
  (await attachAttendeeNames([m]))[0]!;

const buildDetails = (
  input?: Partial<IExternalMeetingDetails>
): IExternalMeetingDetails => ({
  link: trimOrNull(input?.link),
  meetingId: trimOrNull(input?.meetingId),
  password: trimOrNull(input?.password),
  phoneNumber: trimOrNull(input?.phoneNumber),
  address: trimOrNull(input?.address),
});

/**
 * A video meeting with no pasted link uses the company's Zoom personal room,
 * exactly like ATS Zoom interviews. Best-effort: if Zoom is unreachable the
 * meeting is still saved, just without a link.
 */
const withDefaultVideoLink = async (
  type: string,
  details: IExternalMeetingDetails
): Promise<IExternalMeetingDetails> => {
  if (type !== 'video' || details.link) return details;
  try {
    const room = await getPersonalMeetingRoom();
    return {
      ...details,
      link: room.link,
      meetingId: trimOrNull(room.meetingId),
      password: trimOrNull(room.password),
    };
  } catch (err) {
    logger.error('Could not auto-fill Zoom link for external meeting', err);
    return details;
  }
};

export const getAllExternalMeetings = async (filters: {
  status?: string;
  attendeeId?: string;
  page?: number;
  limit?: number;
}): Promise<{
  meetings: IExternalMeeting[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { status, attendeeId, page = 1, limit = 20 } = filters;

  const query: Record<string, unknown> = {};
  if (status !== undefined) query['status'] = status;
  if (attendeeId !== undefined) query['attendeeIds'] = attendeeId;

  const skip = (page - 1) * limit;
  const [meetings, total] = await Promise.all([
    ExternalMeeting.find(query)
      .sort({ scheduledAt: -1 })
      .skip(skip)
      .limit(limit),
    ExternalMeeting.countDocuments(query),
  ]);

  return {
    meetings: await attachAttendeeNames(meetings.map(m => m.toSafeObject())),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getExternalMeetingById = async (
  id: string
): Promise<IExternalMeeting> => {
  const meeting = await ExternalMeeting.findById(id);
  if (!meeting) {
    throw new AppError(
      404,
      'EXTERNAL_MEETING_NOT_FOUND',
      'External meeting not found'
    );
  }
  return attachOne(meeting.toSafeObject());
};

export const createExternalMeeting = async (
  input: CreateExternalMeetingInput
): Promise<IExternalMeeting> => {
  // The organiser is the implicit attendee, as with ATS interviews.
  const attendeeIds = [
    ...new Set(
      (input.attendeeIds?.length
        ? input.attendeeIds
        : [input.organizerId]
      ).filter(Boolean)
    ),
  ];

  const meeting = await ExternalMeeting.create({
    title: input.title,
    personName: input.personName,
    personEmail: trimOrNull(input.personEmail),
    personPhone: trimOrNull(input.personPhone),
    jobLabel: trimOrNull(input.jobLabel),
    type: input.type,
    scheduledAt: new Date(input.scheduledAt),
    duration: input.duration ?? DEFAULT_DURATION_MINUTES,
    timezone: await getCompanyTimezone(),
    meetingDetails: await withDefaultVideoLink(
      input.type,
      buildDetails(input.meetingDetails)
    ),
    notes: trimOrNull(input.notes),
    attendeeIds: attendeeIds.map(id => new mongoose.Types.ObjectId(id)),
    organizerId: new mongoose.Types.ObjectId(input.organizerId),
  });

  const safe = await attachOne(meeting.toSafeObject());

  // Fire-and-forget: a mail problem must never fail the booking.
  sendExternalMeetingScheduledEmails(safe).catch(err => {
    logger.error('Failed to send external meeting scheduled emails', err);
  });

  safeEmitToAts('applications', 'external_meeting:created', safe);
  return safe;
};

export const updateExternalMeeting = async (
  id: string,
  input: UpdateExternalMeetingInput
): Promise<IExternalMeeting> => {
  const meeting = await ExternalMeeting.findById(id);
  if (!meeting) {
    throw new AppError(
      404,
      'EXTERNAL_MEETING_NOT_FOUND',
      'External meeting not found'
    );
  }
  if (meeting.status !== 'scheduled') {
    throw new AppError(
      400,
      'EXTERNAL_MEETING_CLOSED',
      'Cannot update a completed or cancelled meeting'
    );
  }

  const changes: string[] = [];

  if (input.status === 'completed') {
    meeting.status = 'completed';
    changes.push('Marked as completed');
  }
  if (input.title !== undefined && input.title !== meeting.title) {
    changes.push(`Title changed from "${meeting.title}" to "${input.title}"`);
    meeting.title = input.title;
  }
  if (
    input.personName !== undefined &&
    input.personName !== meeting.personName
  ) {
    changes.push('Contact name updated');
    meeting.personName = input.personName;
  }
  if (input.personEmail !== undefined) {
    meeting.personEmail = trimOrNull(input.personEmail);
  }
  if (input.personPhone !== undefined) {
    meeting.personPhone = trimOrNull(input.personPhone);
  }
  if (input.jobLabel !== undefined) {
    meeting.jobLabel = trimOrNull(input.jobLabel);
  }
  if (input.notes !== undefined) meeting.notes = trimOrNull(input.notes);
  if (input.type !== undefined && input.type !== meeting.type) {
    changes.push('Meeting type updated');
    meeting.type = input.type;
  }
  if (input.duration !== undefined && input.duration !== meeting.duration) {
    changes.push(
      `Duration changed from ${meeting.duration} to ${input.duration} minutes`
    );
    meeting.duration = input.duration;
  }
  if (input.scheduledAt !== undefined) {
    const next = new Date(input.scheduledAt);
    if (next.getTime() !== meeting.scheduledAt.getTime()) {
      changes.push('Date & time updated');
      meeting.scheduledAt = next;
    }
  }
  if (input.attendeeIds !== undefined) {
    const next =
      input.attendeeIds.length > 0
        ? [...new Set(input.attendeeIds.map(String))]
        : [String(meeting.organizerId)];
    const before = meeting.attendeeIds.map(String).sort().join(',');
    if (before !== [...next].sort().join(',')) {
      changes.push('Attendee(s) updated');
    }
    meeting.attendeeIds = next.map(
      a => new mongoose.Types.ObjectId(a)
    ) as unknown as mongoose.Types.ObjectId[];
  }
  {
    const before = JSON.stringify(meeting.meetingDetails ?? {});
    const current = buildDetails({
      link: meeting.meetingDetails?.link,
      meetingId: meeting.meetingDetails?.meetingId,
      password: meeting.meetingDetails?.password,
      phoneNumber: meeting.meetingDetails?.phoneNumber,
      address: meeting.meetingDetails?.address,
    });
    const merged = { ...current };
    const given = input.meetingDetails;
    if (given?.link !== undefined) {
      merged.link = trimOrNull(given.link);
      // A link typed by hand replaces the auto Zoom room, so its ID/passcode
      // no longer apply.
      if (merged.link !== current.link) {
        merged.meetingId = null;
        merged.password = null;
      }
    }
    if (given?.phoneNumber !== undefined)
      merged.phoneNumber = trimOrNull(given.phoneNumber);
    if (given?.address !== undefined)
      merged.address = trimOrNull(given.address);
    const next = await withDefaultVideoLink(meeting.type, merged);
    if (JSON.stringify(next) !== before) {
      changes.push('Meeting details updated');
      meeting.meetingDetails = next;
    }
  }

  await meeting.save();
  const safe = await attachOne(meeting.toSafeObject());

  // Only a reschedule is emailed. Completing, editing notes/title/details or
  // changing attendees stays silent: the only emails are scheduled,
  // rescheduled and cancelled.
  if (changes.includes('Date & time updated')) {
    sendExternalMeetingUpdatedEmails(safe, changes).catch(err => {
      logger.error('Failed to send external meeting updated emails', err);
    });
  }

  safeEmitToAts('applications', 'external_meeting:updated', safe);
  return safe;
};

export const cancelExternalMeeting = async (
  id: string
): Promise<IExternalMeeting> => {
  const meeting = await ExternalMeeting.findById(id);
  if (!meeting) {
    throw new AppError(
      404,
      'EXTERNAL_MEETING_NOT_FOUND',
      'External meeting not found'
    );
  }
  if (meeting.status === 'cancelled') {
    throw new AppError(
      400,
      'EXTERNAL_MEETING_CLOSED',
      'Meeting is already cancelled'
    );
  }

  meeting.status = 'cancelled';
  await meeting.save();
  const safe = await attachOne(meeting.toSafeObject());

  sendExternalMeetingCancelledEmails(safe).catch(err => {
    logger.error('Failed to send external meeting cancelled emails', err);
  });

  safeEmitToAts('applications', 'external_meeting:updated', safe);
  return safe;
};
