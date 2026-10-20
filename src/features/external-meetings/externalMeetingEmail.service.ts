import { env } from '../../config/env';
import { sendEmail } from '../../shared/utils/email';
import logger from '../../shared/utils/logger';
import {
  buildMeetingDetailsHtml,
  formatDateTime,
  wrapEmail,
} from '../interviews/interviewEmail.service';
import User from '../users/user.model';
import type { IExternalMeeting } from './externalMeeting.types';

/**
 * Emails for external meetings. Same layout and the same who-hears-what rules
 * as ATS interviews:
 *  - scheduled  → the external person (if they have an email) + team attendees
 *  - rescheduled → the external person + team attendees (only a change of
 *                  date/time sends this; no other edit or status change does)
 *  - cancelled  → team attendees only
 * Every send is best-effort: failures are logged and never thrown.
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const TYPE_LABELS: Record<string, string> = {
  video: 'Video Meeting',
  phone_call: 'Phone Call',
  in_person: 'In-Person Meeting',
};

const ROW =
  '<tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:140px">LABEL</td><td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:500">VALUE</td></tr>';
const row = (label: string, value: string): string =>
  ROW.replace('LABEL', label).replace('VALUE', () => value);

/** Meeting-details block: the shared builder expects the interview shape. */
const detailsHtml = (m: IExternalMeeting): string =>
  buildMeetingDetailsHtml(
    // The builder prints Zoom ID/passcode only for type "zoom".
    m.meetingDetails.meetingId ? 'zoom' : m.type,
    {
      link: m.meetingDetails.link,
      meetingId: m.meetingDetails.meetingId,
      password: m.meetingDetails.password,
      phoneNumber: m.meetingDetails.phoneNumber,
      address: m.meetingDetails.address,
    }
  );

const summaryTable = (m: IExternalMeeting, withContact: boolean): string => `
  <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:0 0 20px 0">
    <table cellpadding="0" cellspacing="0" width="100%">
      ${withContact ? row('With', escapeHtml(m.personName)) : ''}
      ${m.jobLabel ? row('Regarding', escapeHtml(m.jobLabel)) : ''}
      ${row('Meeting', escapeHtml(m.title))}
      ${row('Type', TYPE_LABELS[m.type] ?? 'Meeting')}
      ${row('Date &amp; Time', formatDateTime(m.scheduledAt, m.timezone))}
      ${row('Duration', `${m.duration} minutes`)}
      ${m.attendeeNames?.length ? row('Our team', m.attendeeNames.map(escapeHtml).join(', ')) : ''}
    </table>
  </div>
`;

const send = async (
  to: string,
  subject: string,
  body: string,
  what: string
): Promise<void> => {
  await sendEmail({
    to: [to],
    subject,
    // No "automated message" footer on external emails.
    html: wrapEmail(body, env.COMPANY_NAME, { footer: false }),
  }).catch(err => {
    logger.error(`Failed to send external meeting ${what}`, { error: err, to });
  });
};

const attendeeRecipients = async (
  m: IExternalMeeting
): Promise<Array<{ name: string; email: string }>> => {
  const users = await User.find({ _id: { $in: m.attendeeIds } }).select(
    'firstName lastName email'
  );
  return users
    .filter(u => u.email)
    .map(u => ({ name: `${u.firstName} ${u.lastName}`, email: u.email }));
};

const changesList = (changes: string[]): string =>
  changes.length > 0
    ? `<ul style="color:#475569;font-size:14px;margin:0 0 24px 0;padding-left:20px">${changes
        .map(c => `<li style="margin:4px 0">${escapeHtml(c)}</li>`)
        .join('')}</ul>`
    : '';

export const sendExternalMeetingScheduledEmails = async (
  m: IExternalMeeting
): Promise<void> => {
  try {
    if (m.personEmail) {
      await send(
        m.personEmail,
        `Meeting Scheduled: ${m.title}`,
        `
        <h2 style="color:#1e293b;font-size:20px;margin:0 0 8px 0">📅 Meeting Scheduled</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px 0">
          Hello ${escapeHtml(m.personName)},<br><br>
          A meeting has been scheduled with you. Please review the details below.
        </p>
        ${summaryTable(m, false)}
        ${detailsHtml(m)}
      `,
        'invitation'
      );
    }

    for (const a of await attendeeRecipients(m)) {
      await send(
        a.email,
        `External Meeting: ${m.personName} - ${m.title}`,
        `
        <h2 style="color:#1e293b;font-size:20px;margin:0 0 8px 0">📅 External Meeting Scheduled</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px 0">
          Hello ${escapeHtml(a.name)},<br><br>
          You have been added to a meeting with someone outside the ATS.
        </p>
        ${summaryTable(m, true)}
        ${detailsHtml(m)}
      `,
        'attendee invitation'
      );
    }
  } catch (err) {
    logger.error('Error sending external meeting scheduled emails', err);
  }
};

export const sendExternalMeetingUpdatedEmails = async (
  m: IExternalMeeting,
  changes: string[]
): Promise<void> => {
  try {
    // Callers only invoke this for a reschedule.
    if (m.personEmail) {
      await send(
        m.personEmail,
        `Meeting Updated: ${m.title}`,
        `
        <h2 style="color:#1e293b;font-size:20px;margin:0 0 8px 0">📝 Meeting Updated</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px 0">
          Hello ${escapeHtml(m.personName)},<br><br>
          Your meeting has been rescheduled. The following details have changed:
        </p>
        ${changesList(changes)}
        ${summaryTable(m, false)}
        ${detailsHtml(m)}
      `,
        'update'
      );
    }

    for (const a of await attendeeRecipients(m)) {
      await send(
        a.email,
        `External Meeting Updated: ${m.personName} - ${m.title}`,
        `
        <h2 style="color:#1e293b;font-size:20px;margin:0 0 8px 0">📝 External Meeting Updated</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px 0">
          Hello ${escapeHtml(a.name)},<br><br>
          A meeting you are part of has been updated. The following details have changed:
        </p>
        ${changesList(changes)}
        ${summaryTable(m, true)}
        ${detailsHtml(m)}
      `,
        'attendee update'
      );
    }
  } catch (err) {
    logger.error('Error sending external meeting updated emails', err);
  }
};

export const sendExternalMeetingCancelledEmails = async (
  m: IExternalMeeting
): Promise<void> => {
  try {
    // Cancellations go to the team only, never to the external person.
    for (const a of await attendeeRecipients(m)) {
      await send(
        a.email,
        `External Meeting Cancelled: ${m.personName} - ${m.title}`,
        `
        <h2 style="color:#dc2626;font-size:20px;margin:0 0 8px 0">❌ External Meeting Cancelled</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px 0">
          Hello ${escapeHtml(a.name)},<br><br>
          The following meeting has been cancelled.
        </p>
        ${summaryTable(m, true)}
      `,
        'attendee cancellation'
      );
    }
  } catch (err) {
    logger.error('Error sending external meeting cancelled emails', err);
  }
};
