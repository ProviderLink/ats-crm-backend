import mongoose from 'mongoose';
import { AppError } from '../../shared/utils/AppError';
import { createZoomMeeting, deleteZoomMeeting } from '../../shared/utils/zoom';
import { createLog } from '../activity-logs/activityLog.service';
import Candidate from '../candidates/candidate.model';
import Interview from './interview.model';
import type {
  CreateInterviewInput,
  IInterview,
  IInterviewMeetingDetails,
  SubmitFeedbackInput,
  UpdateInterviewInput,
} from './interview.types';

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

  createLog({
    type: 'interview_scheduled',
    resourceType: 'interview',
    resourceId: interview._id.toString(),
    relatedType: 'candidate',
    relatedId: input.candidateId,
    metadata: { type: input.type, round: input.round },
    performedBy: input.organizerId,
  });

  return interview.toSafeObject();
};

export const updateInterview = async (
  id: string,
  input: UpdateInterviewInput
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

  if (input.title !== undefined) interview.title = input.title;
  if (input.scheduledAt !== undefined) {
    interview.scheduledAt = new Date(input.scheduledAt);
    if (interview.type === 'zoom') {
      console.log(
        'TODO: update Zoom meeting when Zoom update API is integrated'
      );
    }
  }
  if (input.duration !== undefined) interview.duration = input.duration;
  if (input.timezone !== undefined) interview.timezone = input.timezone;
  if (input.interviewerIds !== undefined) {
    interview.interviewerIds = input.interviewerIds.map(
      id => new mongoose.Types.ObjectId(id)
    ) as unknown as mongoose.Types.ObjectId[];
  }
  if (input.meetingDetails !== undefined && interview.meetingDetails !== null) {
    Object.assign(interview.meetingDetails, input.meetingDetails);
    interview.markModified('meetingDetails');
  }

  await interview.save();

  createLog({
    type: 'interview_updated',
    resourceType: 'interview',
    resourceId: id,
  });

  return interview.toSafeObject();
};

export const cancelInterview = async (id: string): Promise<IInterview> => {
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

  if (interview.type === 'zoom' && interview.meetingDetails?.meetingId) {
    await deleteZoomMeeting(interview.meetingDetails.meetingId);
  }

  await interview.save();

  createLog({
    type: 'interview_cancelled',
    resourceType: 'interview',
    resourceId: id,
  });

  return interview.toSafeObject();
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
    type: 'interview_feedback_submitted',
    resourceType: 'interview',
    resourceId: id,
    metadata: { rating: input.rating, recommendation: input.recommendation },
    performedBy: input.interviewerId,
  });

  return interview.toSafeObject();
};
