import { Resend } from 'resend';
import { env } from '../../config/env';
import AppError from './AppError';
import { getEmailSenderIdentity } from './emailSender';
import logger from './logger';

const resend = new Resend(env.RESEND_API_KEY);

export const substituteVariables = (
  template: string,
  variables: Record<string, string>
): string => {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
};

export const sendEmail = async (params: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: { filename: string; url: string }[];
}): Promise<{ id: string }> => {
  const { fromEmail, fromName, replyTo } = await getEmailSenderIdentity();
  const from = `${fromName} <${fromEmail}>`;

  const { data, error } = await resend.emails.send({
    from,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    html: params.html,
    text: params.text,
    attachments: params.attachments?.length
      ? params.attachments.map(a => ({ filename: a.filename, path: a.url }))
      : undefined,
    // Always reply to the workspace mailbox so the inbound webhook keeps
    // matching candidate replies against their thread. An explicit caller
    // value still wins.
    replyTo: params.replyTo ?? replyTo,
  });

  if (error || !data) {
    logger.error('Failed to send email via Resend', {
      error,
      to: params.to,
      subject: params.subject,
      from,
    });
    throw new AppError(
      500,
      'EMAIL_SEND_FAILED',
      error?.message || 'Failed to send email'
    );
  }

  return { id: data.id };
};
