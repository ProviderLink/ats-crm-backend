import mongoose from 'mongoose';
import { AppError } from '../../shared/utils/AppError';
import { getCompanyTimezone } from '../../shared/utils/companyTimezone';
import {
  deleteGoogleMeetMeeting,
  updateGoogleMeetMeeting,
} from '../../shared/utils/googleMeet';
import logger from '../../shared/utils/logger';
import { DEFAULT_TIMEZONE, isValidTimeZone } from '../../shared/utils/timezone';
import {
  createZoomMeeting,
  deleteZoomMeeting,
  updateZoomMeeting,
} from '../../shared/utils/zoom';
import { emitToAts } from '../../sockets';
import { createLog } from '../activity-logs/activityLog.service';
import type { ActivityAction } from '../activity-logs/activityLog.types';
import Application from '../applications/application.model';
import Candidate from '../candidates/candidate.model';
import Job from '../jobs/job.model';
import User from '../users/user.model';
import Interview from './interview.model';
import type {
  CreateInterviewInput,
  IInterview,
  IInterviewMeetingDetails,
  SubmitFeedbackInput,
  UpdateInterviewInput,
} from './interview.types';
import {
  sendInterviewCancelledEmails,
  sendInterviewScheduledEmails,
  sendInterviewUpdatedEmails,
} from './interviewEmail.service';

/**
 * Length of every interview.
 *
 * The schedule form no longer asks for a duration, so a single value is applied
 * server-side. Existing records keep whatever they were booked with.
 */
export const INTERVIEW_DURATION_MINUTES = 60;

/** Collapse an optional string to `null` so stored values are never `''`. */
const trimOrNull = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Resolve interviewer display names for one interview.
 *
 * There is no `populate()` in this codebase, so the label is fetched explicitly
 * and spread onto the payload. A user deleted after scheduling simply has no
 * entry, and the client falls back to the raw id for that slot.
 */
const attachInterviewerNames = async (
  interview: IInterview
): Promise<IInterview> => {
  if (interview.interviewerIds.length === 0) {
    interview.interviewerNames = [];
    return interview;
  }
  const users = await User.find({ _id: { $in: interview.interviewerIds } })
    .select('firstName lastName')
    .lean();
  const byId = new Map(
    users.map(u => [String(u._id), `${u.firstName} ${u.lastName}`])
  );
  interview.interviewerNames = interview.interviewerIds.map(
    id => byId.get(String(id)) ?? id
  );
  return interview;
};

/**
 * Resolve names for a batch of interviews with ONE query.
 *
 * List endpoints call this so the calendar never has to reconstruct labels from
 * a client-side user list.
 */
const attachInterviewerNamesBulk = async (
  interviews: IInterview[]
): Promise<IInterview[]> => {
  const ids = new Set<string>();
  for (const interview of interviews) {
    for (const id of interview.interviewerIds) ids.add(String(id));
  }
  if (ids.size === 0) {
    for (const interview of interviews) interview.interviewerNames = [];
    return interviews;
  }

  const users = await User.find({ _id: { $in: [...ids] } })
    .select('firstName lastName')
    .lean();
  const byId = new Map(
    users.map(u => [String(u._id), `${u.firstName} ${u.lastName}`])
  );

  for (const interview of interviews) {
    interview.interviewerNames = interview.interviewerIds.map(
      id => byId.get(String(id)) ?? id
    );
  }
  return interviews;
};

/**
 * Find existing interviews that overlap the proposed time for ANY of the given
 * interviewers.
 *
 * Overlap is half-open — `[start, end)` — so an interview ending at 10:00 and
 * another starting at 10:00 are NOT a conflict, while a zero-length overlap is.
 * The `$lt`/`$gt` pair is expressed against the *stored* end time, which is not
 * a column: `scheduledAt + duration` is computed during the scan because Mongo
 * cannot compare against a derived value. The candidate window is therefore
 * widened by the longest possible duration and then filtered precisely in JS.
 *
 * Only `scheduled` interviews block: a cancelled or completed interview must
 * never prevent re-booking the same slot.
 */
const findConflicts = async (params: {
  interviewerIds: string[];
  scheduledAt: Date;
  duration: number;
  excludeInterviewId?: string;
}): Promise<IInterview[]> => {
  const { interviewerIds, scheduledAt, duration, excludeInterviewId } = params;
  if (interviewerIds.length === 0) return [];

  const MAX_DURATION_MS = 480 * 60_000;
  const start = scheduledAt.getTime();
  const end = start + duration * 60_000;

  const query: Record<string, unknown> = {
    status: 'scheduled',
    interviewerIds: { $in: interviewerIds },
    // Anything ending after `start` and starting before `end`.
    scheduledAt: {
      $gt: new Date(start - MAX_DURATION_MS),
      $lt: new Date(end),
    },
  };
  if (excludeInterviewId) query['_id'] = { $ne: excludeInterviewId };

  const candidates = await Interview.find(query);
  return candidates
    .filter(other => {
      const otherStart = other.scheduledAt.getTime();
      const otherEnd = otherStart + other.duration * 60_000;
      return otherStart < end && otherEnd > start;
    })
    .map(i => i.toSafeObject());
};

/**
 * Throw when the proposed slot clashes for any of the interviewers.
 *
 * Deliberately a hard error rather than a warning: two interviews for the same
 * person at the same time is always a mistake, and the caller has the full
 * interviewer list in hand at that moment.
 */
const assertNoConflicts = async (params: {
  interviewerIds: string[];
  scheduledAt: Date;
  duration: number;
  excludeInterviewId?: string;
}): Promise<void> => {
  const conflicts = await findConflicts(params);
  if (conflicts.length === 0) return;

  const names = await User.find({
    _id: { $in: conflicts.flatMap(c => c.interviewerIds) },
  })
    .select('firstName lastName')
    .lean();
  const byId = new Map(
    names.map(u => [String(u._id), `${u.firstName} ${u.lastName}`])
  );

  const clashing = [
    ...new Set(
      conflicts.flatMap(c =>
        c.interviewerIds
          .filter(id => params.interviewerIds.includes(String(id)))
          .map(id => byId.get(String(id)) ?? 'An interviewer')
      )
    ),
  ];

  // `toLocaleString` THROWS a RangeError on an invalid IANA zone. Historic rows
  // could hold any string, and a crash here would surface as a 500 on a plain
  // "who is busy" check — fall back to the company default instead.
  const conflictZone = isValidTimeZone(conflicts[0]!.timezone)
    ? conflicts[0]!.timezone
    : DEFAULT_TIMEZONE;
  const when = conflicts[0]!.scheduledAt.toLocaleString('en-US', {
    timeZone: conflictZone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  throw new AppError(
    409,
    'INTERVIEW_CONFLICT',
    `${clashing.join(', ')} ${clashing.length === 1 ? 'is' : 'are'} already booked at that time (${when}).`
  );
};

export const getAllInterviews = async (filters: {
  candidateId?: string;
  jobId?: string;
  applicationId?: string;
  status?: string;
  interviewerId?: string;
  page?: number;
  limit?: number;
}): Promise<{
  interviews: IInterview[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const {
    candidateId,
    jobId,
    applicationId,
    status,
    interviewerId,
    page = 1,
    limit = 20,
  } = filters;

  const query: Record<string, unknown> = {};
  if (candidateId !== undefined) query['candidateId'] = candidateId;
  if (jobId !== undefined) query['jobId'] = jobId;
  if (applicationId !== undefined) query['applicationId'] = applicationId;
  if (status !== undefined) query['status'] = status;
  if (interviewerId !== undefined) query['interviewerIds'] = interviewerId;

  const skip = (page - 1) * limit;
  const [interviews, total] = await Promise.all([
    Interview.find(query).sort({ scheduledAt: -1 }).skip(skip).limit(limit),
    Interview.countDocuments(query),
  ]);

  return {
    interviews: await attachInterviewerNamesBulk(
      interviews.map(i => i.toSafeObject())
    ),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getInterviewById = async (id: string): Promise<IInterview> => {
  const interview = await Interview.findById(id);
  if (!interview)
    throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');
  return attachInterviewerNames(interview.toSafeObject());
};

export const createInterview = async (
  input: CreateInterviewInput
): Promise<IInterview> => {
  // Interviewers are optional: the organiser is the implicit interviewer for an
  // ad-hoc invite, so an empty selection must never block scheduling. Deduped
  // because the client can send the organiser explicitly as well.
  const interviewerIds = [
    ...new Set(
      (input.interviewerIds?.length
        ? input.interviewerIds
        : [input.organizerId]
      ).filter(Boolean)
    ),
  ];

  // The company timezone is authoritative and comes from Settings; the client
  // no longer sends it, so a stale browser value can never be stored.
  const timezone = await getCompanyTimezone();
  const scheduledAt = new Date(input.scheduledAt);
  const duration = INTERVIEW_DURATION_MINUTES;

  // Reject a slot that clashes with an existing interview for any of these
  // interviewers. The organiser fallback above means an ad-hoc booking is still
  // checked against the person actually doing the interview.
  await assertNoConflicts({ interviewerIds, scheduledAt, duration });

  let meetingDetails: IInterviewMeetingDetails;

  if (input.type === 'zoom') {
    const candidate = await Candidate.findById(input.candidateId);
    const candidateName = candidate
      ? `${candidate.firstName} ${candidate.lastName}`
      : 'Candidate';

    const zoomResult = await createZoomMeeting({
      topic: `${input.title} - ${candidateName}`,
      scheduledAt: input.scheduledAt as string,
      duration,
      timezone,
    });

    meetingDetails = {
      link: zoomResult.link,
      meetingId: zoomResult.meetingId,
      password: zoomResult.password,
      phoneNumber: null,
      address: null,
    };
  } else if (input.type === 'google_meet') {
    // Google Meet uses manual link — user pastes a link from https://meet.google.com/
    meetingDetails = {
      link: trimOrNull(input.meetingDetails?.link),
      meetingId: null,
      password: null,
      phoneNumber: null,
      address: null,
    };
  } else if (input.type === 'phone_call') {
    meetingDetails = {
      link: null,
      meetingId: null,
      password: null,
      phoneNumber: trimOrNull(input.meetingDetails?.phoneNumber),
      address: null,
    };
  } else {
    meetingDetails = {
      link: null,
      meetingId: null,
      password: null,
      phoneNumber: null,
      address: trimOrNull(input.meetingDetails?.address),
    };
  }

  const interview = await Interview.create({
    applicationId: new mongoose.Types.ObjectId(input.applicationId),
    candidateId: new mongoose.Types.ObjectId(input.candidateId),
    jobId: new mongoose.Types.ObjectId(input.jobId),
    clientId: new mongoose.Types.ObjectId(input.clientId),
    title: input.title,
    type: input.type,
    scheduledAt,
    duration,
    timezone,
    interviewerIds: interviewerIds.map(id => new mongoose.Types.ObjectId(id)),
    organizerId: new mongoose.Types.ObjectId(input.organizerId),
    meetingDetails,
  });

  const job = await Job.findById(input.jobId);
  const jobTitle = job?.title ?? 'this job';

  createLog({
    action: 'interview_scheduled',
    resourceType: 'application',
    resourceId: input.applicationId,
    relatedType: 'interview',
    relatedId: interview._id.toString(),
    description: `Interview scheduled for ${jobTitle}`,
    metadata: {
      interviewId: interview._id.toString(),
      type: input.type,
      scheduledAt: scheduledAt.toISOString(),
      jobId: input.jobId,
      jobTitle,
    },
    performedBy: input.organizerId,
  });

  // Push interview ID into Application.interviewIds for history tracking
  await Application.findByIdAndUpdate(input.applicationId, {
    $push: { interviewIds: interview._id },
  });

  const safeInterview = await attachInterviewerNames(interview.toSafeObject());

  // Fire-and-forget email notifications (don't block the response)
  sendInterviewScheduledEmails(safeInterview).catch(err => {
    logger.error('Failed to send interview scheduled emails', err);
  });

  emitToAts('applications', 'interview:created', safeInterview);
  return safeInterview;
};

export const updateInterview = async (
  id: string,
  input: UpdateInterviewInput,
  updatedBy?: string
): Promise<IInterview> => {
  const interview = await Interview.findById(id);
  if (!interview)
    throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');

  if (interview.status === 'completed' || interview.status === 'cancelled') {
    throw new AppError(
      400,
      'INTERVIEW_ALREADY_COMPLETED',
      'Cannot update a completed or cancelled interview'
    );
  }

  const changes: string[] = [];

  // Handle status change (e.g. scheduled → completed via completeAndFeedback)
  if (input.status !== undefined && input.status !== interview.status) {
    if (
      interview.status === 'scheduled' &&
      (input.status === 'completed' || input.status === 'no_show')
    ) {
      interview.status = input.status;
      changes.push(`Status changed to "${input.status}"`);
    } else if (input.status === 'cancelled') {
      throw new AppError(
        400,
        'INVALID_STATUS_CHANGE',
        'Use the cancel endpoint to cancel an interview'
      );
    } else {
      throw new AppError(
        400,
        'INVALID_STATUS_CHANGE',
        `Cannot change status from "${interview.status}" to "${input.status}"`
      );
    }
  }

  if (input.title !== undefined && input.title !== interview.title) {
    changes.push(`Title changed from "${interview.title}" to "${input.title}"`);
    interview.title = input.title;
  }
  if (input.type !== undefined && input.type !== interview.type) {
    changes.push(`Type changed from "${interview.type}" to "${input.type}"`);
    interview.type = input.type;
  }

  // Interviewers are resolved BEFORE the reschedule so the conflict check below
  // sees the final list. An empty list is allowed (see `createInterview`) but
  // must not silently drop the organiser, or the interview would have nobody
  // attached and the feedback permission check could never pass.
  let nextInterviewerIds: string[] | undefined;
  if (input.interviewerIds !== undefined) {
    nextInterviewerIds =
      input.interviewerIds.length > 0
        ? [...new Set(input.interviewerIds.map(String))]
        : [String(interview.organizerId)];
    const oldIds = interview.interviewerIds.map(String).sort().join(',');
    if (oldIds !== [...nextInterviewerIds].sort().join(',')) {
      changes.push('Interviewer(s) updated');
    }
  }

  if (input.scheduledAt !== undefined) {
    const newDate = new Date(input.scheduledAt);
    if (newDate.getTime() !== interview.scheduledAt.getTime()) {
      // Guard the new slot against the interview's FINAL interviewer list.
      await assertNoConflicts({
        interviewerIds:
          nextInterviewerIds ?? interview.interviewerIds.map(String),
        scheduledAt: newDate,
        duration: interview.duration,
        excludeInterviewId: id,
      });

      changes.push('Date & time updated');
      interview.scheduledAt = newDate;

      // Update meeting if the interview is a video call. Duration and timezone
      // are no longer client-supplied, so the stored values are reused.
      if (interview.meetingDetails?.meetingId) {
        if (interview.type === 'zoom') {
          updateZoomMeeting(interview.meetingDetails.meetingId, {
            topic: interview.title,
            scheduledAt: input.scheduledAt as string,
            duration: interview.duration,
            timezone: interview.timezone,
          }).catch(err => {
            logger.error('Failed to update Zoom meeting on reschedule', err);
          });
        } else if (interview.type === 'google_meet') {
          updateGoogleMeetMeeting(interview.meetingDetails.meetingId, {
            topic: interview.title,
            scheduledAt: input.scheduledAt as string,
            duration: interview.duration,
            timezone: interview.timezone,
          }).catch(err => {
            logger.error(
              'Failed to update Google Meet meeting on reschedule',
              err
            );
          });
        }
      }
    }
  }
  if (input.interviewerIds !== undefined && nextInterviewerIds) {
    interview.interviewerIds = nextInterviewerIds.map(
      id => new mongoose.Types.ObjectId(id)
    ) as unknown as mongoose.Types.ObjectId[];
  }
  if (input.meetingDetails !== undefined && interview.meetingDetails !== null) {
    if (input.meetingDetails.link !== undefined) {
      interview.meetingDetails.link = trimOrNull(input.meetingDetails.link);
    }
    if (input.meetingDetails.phoneNumber !== undefined) {
      interview.meetingDetails.phoneNumber = trimOrNull(
        input.meetingDetails.phoneNumber
      );
    }
    if (input.meetingDetails.address !== undefined) {
      interview.meetingDetails.address = trimOrNull(
        input.meetingDetails.address
      );
    }
    interview.markModified('meetingDetails');
    changes.push('Meeting details updated');
  }

  await interview.save();

  // Log under the APPLICATION so it shows in the app's activity timeline.
  // Include the interview ID in metadata for reference.
  const logAction =
    input.status === 'completed'
      ? 'interview_completed'
      : input.status === 'no_show'
        ? 'interview_no_show'
        : 'interview_updated';

  createLog({
    action: logAction as ActivityAction,
    resourceType: 'application',
    resourceId: interview.applicationId.toString(),
    description:
      input.status === 'completed'
        ? 'Interview completed'
        : input.status === 'no_show'
          ? 'Interview no-show'
          : 'Interview updated',
    metadata: {
      interviewId: id,
      ...(changes.length > 0 ? { changes } : {}),
    },
    performedBy: updatedBy ?? null,
  });

  const safeInterview = await attachInterviewerNames(interview.toSafeObject());

  // Fire-and-forget update emails if there were meaningful changes
  if (changes.length > 0) {
    sendInterviewUpdatedEmails(safeInterview, changes).catch(err => {
      logger.error('Failed to send interview updated emails', err);
    });
  }

  emitToAts('applications', 'interview:updated', safeInterview);
  return safeInterview;
};

export const cancelInterview = async (
  id: string,
  cancelledBy?: string
): Promise<IInterview> => {
  const interview = await Interview.findById(id);
  if (!interview)
    throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');

  if (interview.status === 'cancelled') {
    throw new AppError(
      400,
      'INTERVIEW_ALREADY_COMPLETED',
      'Interview is already cancelled'
    );
  }

  interview.status = 'cancelled';

  if (interview.meetingDetails?.meetingId) {
    if (interview.type === 'zoom') {
      await deleteZoomMeeting(interview.meetingDetails.meetingId);
    } else if (interview.type === 'google_meet') {
      await deleteGoogleMeetMeeting(interview.meetingDetails.meetingId);
    }
  }

  await interview.save();

  createLog({
    action: 'interview_cancelled',
    resourceType: 'application',
    resourceId: interview.applicationId.toString(),
    description: 'Interview cancelled',
    metadata: { interviewId: id },
    performedBy: cancelledBy ?? null,
  });

  const safeInterview = await attachInterviewerNames(interview.toSafeObject());

  // Fire-and-forget cancellation emails
  sendInterviewCancelledEmails(safeInterview).catch(err => {
    logger.error('Failed to send interview cancelled emails', err);
  });

  emitToAts('applications', 'interview:updated', safeInterview);
  return safeInterview;
};

export const submitFeedback = async (
  id: string,
  input: SubmitFeedbackInput
): Promise<IInterview> => {
  const interview = await Interview.findById(id);
  if (!interview)
    throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');

  if (
    !interview.interviewerIds.some(iId => String(iId) === input.interviewerId)
  ) {
    throw new AppError(
      403,
      'AUTH_INSUFFICIENT_PERMISSIONS',
      'You are not assigned to this interview'
    );
  }

  const alreadySubmitted = interview.feedbacks.some(
    f => String(f.interviewerId) === input.interviewerId
  );
  if (alreadySubmitted) {
    throw new AppError(
      409,
      'INTERVIEW_FEEDBACK_ALREADY_SUBMITTED',
      'You have already submitted feedback for this interview'
    );
  }

  interview.feedbacks.push({
    interviewerId: new mongoose.Types.ObjectId(input.interviewerId),
    rating: input.rating,
    notes: input.notes,
    recommendation: input.recommendation,
    submittedAt: new Date(),
  } as unknown as (typeof interview.feedbacks)[0]);

  await interview.save();

  createLog({
    action: 'interview_feedback_submitted',
    resourceType: 'application',
    resourceId: interview.applicationId.toString(),
    description: 'Feedback submitted',
    metadata: {
      interviewId: id,
      rating: input.rating,
      recommendation: input.recommendation,
    },
    performedBy: input.interviewerId,
  });

  const result = await attachInterviewerNames(interview.toSafeObject());
  emitToAts('applications', 'interview:updated', result);
  return result;
};
