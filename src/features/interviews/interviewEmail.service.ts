import { env } from '../../config/env';
import { sendEmail } from '../../shared/utils/email';
import logger from '../../shared/utils/logger';
import Candidate from '../candidates/candidate.model';
import Job from '../jobs/job.model';
import User from '../users/user.model';
import type { IInterview, IInterviewMeetingDetails } from './interview.types';

/**
 * Format a date for display in email.
 */
const formatDateTime = (date: Date | string, timezone?: string): string => {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone || env.COMPANY_TIMEZONE,
    timeZoneName: 'short',
  });
};

/**
 * Format interview type for display.
 */
const formatInterviewType = (type: string): string => {
  switch (type) {
    case 'zoom':
      return 'Video Interview (Zoom)';
    case 'google_meet':
      return 'Video Interview (Google Meet)';
    case 'phone_call':
      return 'Phone Call';
    case 'in_person':
      return 'In-Person Interview';
    default:
      return 'Interview';
  }
};

/**
 * Build the meeting details section for email body.
 */
const buildMeetingDetailsHtml = (
  type: string,
  meetingDetails: IInterviewMeetingDetails | null
): string => {
  if (!meetingDetails) return '';

  const lines: string[] = [];

  if (meetingDetails.link) {
    lines.push(
      `<p style="margin:8px 0"><strong>Meeting Link:</strong> <a href="${meetingDetails.link}" style="color:#2563eb">${meetingDetails.link}</a></p>`
    );
  }
  if (meetingDetails.meetingId && type === 'zoom') {
    lines.push(
      `<p style="margin:8px 0"><strong>Meeting ID:</strong> ${meetingDetails.meetingId}</p>`
    );
  }
  if (meetingDetails.password && type === 'zoom') {
    lines.push(
      `<p style="margin:8px 0"><strong>Passcode:</strong> ${meetingDetails.password}</p>`
    );
  }
  if (meetingDetails.phoneNumber) {
    lines.push(
      `<p style="margin:8px 0"><strong>Phone:</strong> ${meetingDetails.phoneNumber}</p>`
    );
  }
  if (meetingDetails.address) {
    lines.push(
      `<p style="margin:8px 0"><strong>Address:</strong> ${meetingDetails.address}</p>`
    );
  }

  if (lines.length === 0) return '';
  return `
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:20px 0">
      <h3 style="margin:0 0 12px 0;color:#1e293b;font-size:16px">📹 Meeting Details</h3>
      ${lines.join('\n')}
    </div>
  `;
};

/**
 * Build interviewer names string.
 */
const buildInterviewerNames = (
  interviewers: Array<{ firstName: string; lastName: string }>
): string => {
  if (interviewers.length === 0) return '';
  return interviewers.map(i => `${i.firstName} ${i.lastName}`).join(', ');
};

/**
 * Base email wrapper with professional styling.
 */
const wrapEmail = (content: string, companyName: string): string => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;margin:0;padding:0">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1)">
          <tr>
            <td style="background:#1e293b;padding:32px 40px;text-align:center">
              <h1 style="color:#ffffff;font-size:22px;margin:0;font-weight:600">${companyName}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0">
              <p style="color:#94a3b8;font-size:12px;margin:0">
                This is an automated message from ${companyName} ATS. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// Candidate emails
// ---------------------------------------------------------------------------

interface CandidateEmailContext {
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  interview: IInterview;
  interviewerNames: string;
  companyName: string;
}

/**
 * Send interview invitation to the candidate.
 */
export const sendCandidateInvitation = async (
  ctx: CandidateEmailContext
): Promise<void> => {
  const {
    candidateName,
    candidateEmail,
    jobTitle,
    interview,
    interviewerNames,
    companyName,
  } = ctx;
  const dateTimeStr = formatDateTime(interview.scheduledAt, interview.timezone);

  const meetingHtml = buildMeetingDetailsHtml(
    interview.type,
    interview.meetingDetails
  );

  const body = `
    <h2 style="color:#1e293b;font-size:20px;margin:0 0 8px 0">📅 Interview Scheduled</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px 0">
      Hello ${candidateName},<br><br>
      Great news! Your interview for the <strong>${jobTitle}</strong> position has been scheduled.
      Please review the details below and confirm your availability.
    </p>

    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:0 0 20px 0">
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:120px">Position</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${jobTitle}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Interview</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${interview.title}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Type</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${formatInterviewType(interview.type)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Date &amp; Time</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${dateTimeStr}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Duration</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${interview.duration} minutes</td></tr>
        ${interviewerNames ? `<tr><td style="padding:6px 0;color:#64748b;font-size:13px">Interviewer(s)</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${interviewerNames}</td></tr>` : ''}
      </table>
    </div>

    ${meetingHtml}

    ${
      interview.type === 'zoom' || interview.type === 'google_meet'
        ? `
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:20px 0">
      <p style="color:#1e40af;font-size:14px;margin:0">
        <strong>💡 Tip:</strong> Make sure you have a stable internet connection and your camera/microphone are working before the interview.
      </p>
    </div>
    `
        : ''
    }
  `;

  const html = wrapEmail(body, companyName);

  await sendEmail({
    to: [candidateEmail],
    subject: `Interview Scheduled: ${jobTitle} - ${interview.title}`,
    html,
  }).catch(err => {
    logger.error('Failed to send candidate interview invitation', {
      error: err,
      candidateEmail,
    });
  });
};

/**
 * Send interview update notification to the candidate.
 */
export const sendCandidateUpdate = async (
  ctx: CandidateEmailContext,
  changes: string[]
): Promise<void> => {
  const {
    candidateName,
    candidateEmail,
    jobTitle,
    interview,
    interviewerNames,
    companyName,
  } = ctx;
  const dateTimeStr = formatDateTime(interview.scheduledAt, interview.timezone);

  const meetingHtml = buildMeetingDetailsHtml(
    interview.type,
    interview.meetingDetails
  );
  const changesList = changes
    .map(c => `<li style="margin:4px 0">${c}</li>`)
    .join('');

  const body = `
    <h2 style="color:#1e293b;font-size:20px;margin:0 0 8px 0">📝 Interview Updated</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px 0">
      Hello ${candidateName},<br><br>
      Your interview for the <strong>${jobTitle}</strong> position has been updated.
      ${changes.length > 0 ? 'The following details have changed:' : 'Please review the updated details below.'}
    </p>

    ${changes.length > 0 ? `<ul style="color:#475569;font-size:14px;margin:0 0 24px 0;padding-left:20px">${changesList}</ul>` : ''}

    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:0 0 20px 0">
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:120px">Position</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${jobTitle}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Interview</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${interview.title}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Type</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${formatInterviewType(interview.type)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Date &amp; Time</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${dateTimeStr}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Duration</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${interview.duration} minutes</td></tr>
        ${interviewerNames ? `<tr><td style="padding:6px 0;color:#64748b;font-size:13px">Interviewer(s)</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${interviewerNames}</td></tr>` : ''}
      </table>
    </div>

    ${meetingHtml}
  `;

  const html = wrapEmail(body, companyName);

  await sendEmail({
    to: [candidateEmail],
    subject: `Interview Updated: ${jobTitle} - ${interview.title}`,
    html,
  }).catch(err => {
    logger.error('Failed to send candidate interview update', {
      error: err,
      candidateEmail,
    });
  });
};

/**
 * Send interview cancellation notification to the candidate.
 */
export const sendCandidateCancellation = async (
  ctx: CandidateEmailContext
): Promise<void> => {
  const { candidateName, candidateEmail, jobTitle, interview, companyName } =
    ctx;
  const dateTimeStr = formatDateTime(interview.scheduledAt, interview.timezone);

  const body = `
    <h2 style="color:#dc2626;font-size:20px;margin:0 0 8px 0">❌ Interview Cancelled</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px 0">
      Hello ${candidateName},<br><br>
      The following interview for the <strong>${jobTitle}</strong> position has been cancelled.
      A member of our team will reach out to you if further steps are needed.
    </p>

    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:0 0 20px 0">
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:6px 0;color:#991b1b;font-size:13px;width:120px">Position</td><td style="padding:6px 0;color:#7f1d1d;font-size:14px;font-weight:500">${jobTitle}</td></tr>
        <tr><td style="padding:6px 0;color:#991b1b;font-size:13px">Interview</td><td style="padding:6px 0;color:#7f1d1d;font-size:14px;font-weight:500">${interview.title}</td></tr>
        <tr><td style="padding:6px 0;color:#991b1b;font-size:13px">Date &amp; Time</td><td style="padding:6px 0;color:#7f1d1d;font-size:14px;font-weight:500">${dateTimeStr}</td></tr>
        <tr><td style="padding:6px 0;color:#991b1b;font-size:13px">Status</td><td style="padding:6px 0;color:#dc2626;font-size:14px;font-weight:600">Cancelled</td></tr>
      </table>
    </div>
  `;

  const html = wrapEmail(body, companyName);

  await sendEmail({
    to: [candidateEmail],
    subject: `Interview Cancelled: ${jobTitle} - ${interview.title}`,
    html,
  }).catch(err => {
    logger.error('Failed to send candidate interview cancellation', {
      error: err,
      candidateEmail,
    });
  });
};

// ---------------------------------------------------------------------------
// Interviewer emails
// ---------------------------------------------------------------------------

interface InterviewerEmailContext extends CandidateEmailContext {
  interviewerEmail: string;
  interviewerName: string;
}

/**
 * Send interview assignment notification to an interviewer.
 */
export const sendInterviewerInvitation = async (
  ctx: InterviewerEmailContext
): Promise<void> => {
  const { candidateName, jobTitle, interview, interviewerName, companyName } =
    ctx;
  const dateTimeStr = formatDateTime(interview.scheduledAt, interview.timezone);

  const meetingHtml = buildMeetingDetailsHtml(
    interview.type,
    interview.meetingDetails
  );

  const body = `
    <h2 style="color:#1e293b;font-size:20px;margin:0 0 8px 0">📅 Interview Assignment</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px 0">
      Hello ${interviewerName},<br><br>
      You have been assigned as an interviewer for a <strong>${jobTitle}</strong> candidate interview.
      Please review the details below and prepare accordingly.
    </p>

    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:0 0 20px 0">
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:140px">Candidate</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${candidateName}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Position</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${jobTitle}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Interview</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${interview.title}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Type</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${formatInterviewType(interview.type)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Date &amp; Time</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${dateTimeStr}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Duration</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${interview.duration} minutes</td></tr>
      </table>
    </div>

    ${meetingHtml}
  `;

  const html = wrapEmail(body, companyName);

  await sendEmail({
    to: [ctx.interviewerEmail],
    subject: `Interview Assignment: ${candidateName} - ${jobTitle}`,
    html,
  }).catch(err => {
    logger.error('Failed to send interviewer invitation', {
      error: err,
      interviewerEmail: ctx.interviewerEmail,
    });
  });
};

/**
 * Send interview update notification to an interviewer.
 */
export const sendInterviewerUpdate = async (
  ctx: InterviewerEmailContext,
  changes: string[]
): Promise<void> => {
  const { candidateName, jobTitle, interview, interviewerName, companyName } =
    ctx;
  const dateTimeStr = formatDateTime(interview.scheduledAt, interview.timezone);

  const meetingHtml = buildMeetingDetailsHtml(
    interview.type,
    interview.meetingDetails
  );
  const changesList = changes
    .map(c => `<li style="margin:4px 0">${c}</li>`)
    .join('');

  const body = `
    <h2 style="color:#1e293b;font-size:20px;margin:0 0 8px 0">📝 Interview Updated</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px 0">
      Hello ${interviewerName},<br><br>
      An interview you are assigned to has been updated.
      ${changes.length > 0 ? 'The following details have changed:' : 'Please review the updated details below.'}
    </p>

    ${changes.length > 0 ? `<ul style="color:#475569;font-size:14px;margin:0 0 24px 0;padding-left:20px">${changesList}</ul>` : ''}

    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:0 0 20px 0">
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:140px">Candidate</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${candidateName}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Position</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${jobTitle}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Interview</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${interview.title}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Date &amp; Time</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${dateTimeStr}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Duration</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">${interview.duration} minutes</td></tr>
      </table>
    </div>

    ${meetingHtml}
  `;

  const html = wrapEmail(body, companyName);

  await sendEmail({
    to: [ctx.interviewerEmail],
    subject: `Interview Updated: ${candidateName} - ${jobTitle}`,
    html,
  }).catch(err => {
    logger.error('Failed to send interviewer update', {
      error: err,
      interviewerEmail: ctx.interviewerEmail,
    });
  });
};

/**
 * Send interview cancellation notification to an interviewer.
 */
export const sendInterviewerCancellation = async (
  ctx: InterviewerEmailContext
): Promise<void> => {
  const { candidateName, jobTitle, interview, interviewerName, companyName } =
    ctx;
  const dateTimeStr = formatDateTime(interview.scheduledAt, interview.timezone);

  const body = `
    <h2 style="color:#dc2626;font-size:20px;margin:0 0 8px 0">❌ Interview Cancelled</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px 0">
      Hello ${interviewerName},<br><br>
      The following interview you were assigned to has been cancelled.
    </p>

    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:0 0 20px 0">
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:6px 0;color:#991b1b;font-size:13px;width:140px">Candidate</td><td style="padding:6px 0;color:#7f1d1d;font-size:14px;font-weight:500">${candidateName}</td></tr>
        <tr><td style="padding:6px 0;color:#991b1b;font-size:13px">Position</td><td style="padding:6px 0;color:#7f1d1d;font-size:14px;font-weight:500">${jobTitle}</td></tr>
        <tr><td style="padding:6px 0;color:#991b1b;font-size:13px">Interview</td><td style="padding:6px 0;color:#7f1d1d;font-size:14px;font-weight:500">${interview.title}</td></tr>
        <tr><td style="padding:6px 0;color:#991b1b;font-size:13px">Date &amp; Time</td><td style="padding:6px 0;color:#7f1d1d;font-size:14px;font-weight:500">${dateTimeStr}</td></tr>
        <tr><td style="padding:6px 0;color:#991b1b;font-size:13px">Status</td><td style="padding:6px 0;color:#dc2626;font-size:14px;font-weight:600">Cancelled</td></tr>
      </table>
    </div>
  `;

  const html = wrapEmail(body, companyName);

  await sendEmail({
    to: [ctx.interviewerEmail],
    subject: `Interview Cancelled: ${candidateName} - ${jobTitle}`,
    html,
  }).catch(err => {
    logger.error('Failed to send interviewer cancellation', {
      error: err,
      interviewerEmail: ctx.interviewerEmail,
    });
  });
};

// ---------------------------------------------------------------------------
// Orchestration helpers
// ---------------------------------------------------------------------------

/**
 * Gather all context needed for interview emails.
 */
const gatherEmailContext = async (
  interview: IInterview
): Promise<{
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  interviewerNames: string;
  interviewers: Array<{
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  }>;
  companyName: string;
}> => {
  const [candidate, job, users] = await Promise.all([
    Candidate.findById(interview.candidateId).select(
      'firstName lastName email'
    ),
    Job.findById(interview.jobId).select('title'),
    User.find({ _id: { $in: interview.interviewerIds } }).select(
      'firstName lastName email'
    ),
  ]);

  const candidateName = candidate
    ? `${candidate.firstName} ${candidate.lastName}`
    : 'Candidate';
  const candidateEmail = candidate?.email ?? '';
  const jobTitle = job?.title ?? 'Unknown Position';

  const interviewers = users.map(u => ({
    _id: String(u._id),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
  }));
  const interviewerNames = buildInterviewerNames(interviewers);

  return {
    candidateName,
    candidateEmail,
    jobTitle,
    interviewerNames,
    interviewers,
    companyName: env.COMPANY_NAME,
  };
};

/**
 * Send invitation emails to candidate and all interviewers when
 * a new interview is scheduled.
 */
export const sendInterviewScheduledEmails = async (
  interview: IInterview
): Promise<void> => {
  try {
    const ctx = await gatherEmailContext(interview);
    if (!ctx.candidateEmail) {
      logger.warn('Cannot send interview invitation: candidate has no email');
      return;
    }

    const candidateCtx = {
      candidateName: ctx.candidateName,
      candidateEmail: ctx.candidateEmail,
      jobTitle: ctx.jobTitle,
      interview,
      interviewerNames: ctx.interviewerNames,
      companyName: ctx.companyName,
    };

    // Send to candidate
    await sendCandidateInvitation(candidateCtx);

    // Send to each interviewer
    for (const interviewer of ctx.interviewers) {
      await sendInterviewerInvitation({
        ...candidateCtx,
        interviewerEmail: interviewer.email,
        interviewerName: `${interviewer.firstName} ${interviewer.lastName}`,
      });
    }
  } catch (err) {
    logger.error('Error sending interview scheduled emails', err);
  }
};

/**
 * Send update emails when an interview is modified.
 */
export const sendInterviewUpdatedEmails = async (
  interview: IInterview,
  changes: string[]
): Promise<void> => {
  try {
    const ctx = await gatherEmailContext(interview);

    const candidateCtx = {
      candidateName: ctx.candidateName,
      candidateEmail: ctx.candidateEmail,
      jobTitle: ctx.jobTitle,
      interview,
      interviewerNames: ctx.interviewerNames,
      companyName: ctx.companyName,
    };

    // Send to candidate
    if (ctx.candidateEmail) {
      await sendCandidateUpdate(candidateCtx, changes);
    }

    // Send to each interviewer
    for (const interviewer of ctx.interviewers) {
      await sendInterviewerUpdate(
        {
          ...candidateCtx,
          interviewerEmail: interviewer.email,
          interviewerName: `${interviewer.firstName} ${interviewer.lastName}`,
        },
        changes
      );
    }
  } catch (err) {
    logger.error('Error sending interview updated emails', err);
  }
};

/**
 * Send cancellation emails when an interview is cancelled.
 */
export const sendInterviewCancelledEmails = async (
  interview: IInterview
): Promise<void> => {
  try {
    const ctx = await gatherEmailContext(interview);

    const candidateCtx = {
      candidateName: ctx.candidateName,
      candidateEmail: ctx.candidateEmail,
      jobTitle: ctx.jobTitle,
      interview,
      interviewerNames: ctx.interviewerNames,
      companyName: ctx.companyName,
    };

    // Send to candidate
    if (ctx.candidateEmail) {
      await sendCandidateCancellation(candidateCtx);
    }

    // Send to each interviewer
    for (const interviewer of ctx.interviewers) {
      await sendInterviewerCancellation({
        ...candidateCtx,
        interviewerEmail: interviewer.email,
        interviewerName: `${interviewer.firstName} ${interviewer.lastName}`,
      });
    }
  } catch (err) {
    logger.error('Error sending interview cancelled emails', err);
  }
};
