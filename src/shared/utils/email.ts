import { Resend } from 'resend';
import { env } from '../../config/env';
import AppError from './AppError';

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
}): Promise<{ id: string }> => {
  const { data, error } = await resend.emails.send({
    from: `${env.COMPANY_NAME} <${env.COMPANY_EMAIL}>`,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    html: params.html,
    text: params.text,
    reply_to: params.replyTo,
  });

  if (error || !data) {
    throw new AppError(500, 'EMAIL_SEND_FAILED', 'Failed to send email');
  }

  return { id: data.id };
};
