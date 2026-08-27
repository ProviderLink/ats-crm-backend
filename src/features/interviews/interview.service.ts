import mongoose from 'mongoose';
import { AppError } from '../../shared/utils/AppError';
import {
  deleteGoogleMeetMeeting,
  updateGoogleMeetMeeting,
} from '../../shared/utils/googleMeet';
import logger from '../../shared/utils/logger';
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
import Interview from './interview.model';
import type {
  CreateInterviewInput,
  IInterview,
  IInterviewMeetingDetails,
  SubmitFeedbackInput,
  UpdateInterviewInput,
} from './interview.types';
import { INTERVIEW_MEETING_TYPE_LABELS } from './interview.types';
import {
  sendInterviewCancelledEmails,
  sendInterviewScheduledEmails,
  sendInterviewUpdatedEmails,
} from './interviewEmail.service';

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
    interviews: interviews.map(i => i.toSafeObject()),
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
  return interview.toSafeObject();
};

export const createInterview = async (
  input: CreateInterviewInput
): Promise<IInterview> => {
  let meetingDetails: IInterviewMeetingDetails;

  if (input.type === 'zoom') {
    const candidate = await Candidate.findById(input.candidateId);
    const candidateName = candidate
      ? `${candidate.firstName} ${candidate.lastName}`
      : 'Candidate';

    const zoomResult = await createZoomMeeting({
      topic: `${input.title} - ${candidateName}`,
      scheduledAt: input.scheduledAt as string,
      duration: input.duration,
      timezone: input.timezone,
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
      link: input.meetingDetails?.link ?? null,
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
      phoneNumber: input.meetingDetails?.phoneNumber ?? null,
      address: null,
    };
  } else {
    meetingDetails = {
      link: null,
      meetingId: null,
      password: null,
      phoneNumber: null,
      address: input.meetingDetails?.address ?? null,
    };
  }

  const interview = await Interview.create({
    applicationId: new mongoose.Types.ObjectId(input.applicationId),
    candidateId: new mongoose.Types.ObjectId(input.candidateId),
    jobId: new mongoose.Types.ObjectId(input.jobId),
    clientId: new mongoose.Types.ObjectId(input.clientId),
    title: input.title,
    type: input.type,
    interviewType: input.interviewType ?? 'initial_screening',
    round: input.round,
    scheduledAt: input.scheduledAt,
    duration: input.duration,
    timezone: input.timezone,
    interviewerIds: input.interviewerIds.map(
      id => new mongoose.Types.ObjectId(id)
    ),
    organizerId: new mongoose.Types.ObjectId(input.organizerId),
    meetingDetails,
  });

  const job = await Job.findById(input.jobId);
  const jobTitle = job?.title ?? 'this job';
  const interviewType = input.interviewType ?? ('initial_screening' as const);
  const interviewTypeLabel =
    INTERVIEW_MEETING_TYPE_LABELS[interviewType] ?? interviewType;

  createLog({
    action: 'interview_scheduled',
    resourceType: 'application',
    resourceId: input.applicationId,
    relatedType: 'interview',
    relatedId: interview._id.toString(),
    description: `Interview scheduled: ${interviewTypeLabel} for ${jobTitle}`,
    metadata: {
      interviewId: interview._id.toString(),
      type: input.type,
      interviewType,
      round: input.round,
      jobId: input.jobId,
      jobTitle,
    },
    performedBy: input.organizerId,
  });

  // Push interview ID into Application.interviewIds for history tracking
  await Application.findByIdAndUpdate(input.applicationId, {
    $push: { interviewIds: interview._id },
  });

  const safeInterview = interview.toSafeObject();

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
  if (input.scheduledAt !== undefined) {
    const newDate = new Date(input.scheduledAt);
    if (newDate.getTime() !== interview.scheduledAt.getTime()) {
      changes.push('Date & time updated');
      interview.scheduledAt = newDate;

      // Update meeting if the interview is a video call
      if (interview.meetingDetails?.meetingId) {
        if (interview.type === 'zoom') {
          updateZoomMeeting(interview.meetingDetails.meetingId, {
            topic: interview.title,
            scheduledAt: input.scheduledAt as string,
            duration: input.duration ?? interview.duration,
            timezone: input.timezone ?? interview.timezone,
          }).catch(err => {
            logger.error('Failed to update Zoom meeting on reschedule', err);
          });
        } else if (interview.type === 'google_meet') {
          updateGoogleMeetMeeting(interview.meetingDetails.meetingId, {
            topic: interview.title,
            scheduledAt: input.scheduledAt as string,
            duration: input.duration ?? interview.duration,
            timezone: input.timezone ?? interview.timezone,
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
  if (input.duration !== undefined && input.duration !== interview.duration) {
    changes.push(
      `Duration changed from ${interview.duration} to ${input.duration} minutes`
    );
    interview.duration = input.duration;

    // Also update meeting if duration changed and no date change triggered it above
    if (
      interview.meetingDetails?.meetingId &&
      input.scheduledAt === undefined
    ) {
      if (interview.type === 'zoom') {
        updateZoomMeeting(interview.meetingDetails.meetingId, {
          duration: input.duration,
        }).catch(err => {
          logger.error('Failed to update Zoom meeting duration', err);
        });
      } else if (interview.type === 'google_meet') {
        updateGoogleMeetMeeting(interview.meetingDetails.meetingId, {
          duration: input.duration,
        }).catch(err => {
          logger.error('Failed to update Google Meet meeting duration', err);
        });
      }
    }
  }
  if (input.timezone !== undefined && input.timezone !== interview.timezone) {
    changes.push(
      `Timezone changed from "${interview.timezone}" to "${input.timezone}"`
    );
    interview.timezone = input.timezone;
  }
  if (input.interviewerIds !== undefined) {
    const oldIds = interview.interviewerIds.map(String).sort().join(',');
    const newIds = [...input.interviewerIds].sort().join(',');
    if (oldIds !== newIds) {
      changes.push('Interviewer(s) updated');
    }
    interview.interviewerIds = input.interviewerIds.map(
      id => new mongoose.Types.ObjectId(id)
    ) as unknown as mongoose.Types.ObjectId[];
  }
  if (input.meetingDetails !== undefined && interview.meetingDetails !== null) {
    Object.assign(interview.meetingDetails, input.meetingDetails);
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

  const safeInterview = interview.toSafeObject();

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

  const safeInterview = interview.toSafeObject();

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

  const result = interview.toSafeObject();
  emitToAts('applications', 'interview:updated', result);
  return result;
};
