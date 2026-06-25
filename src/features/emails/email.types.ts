export interface IEmailAttachment {
  filename: string;
  url: string;
  contentType: string;
  size: number;
}

export interface IEmailContext {
  type: string;
  candidateId: string | null;
  applicationId: string | null;
  jobId: string | null;
  interviewId: string | null;
}

export interface IEmail {
  _id: string;
  direction: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  status: string;
  threadId: string | null;
  inReplyTo: string | null;
  messageId: string | null;
  templateId: string | null;
  context: IEmailContext;
  resendId: string | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  attachments: IEmailAttachment[];
  sentBy: string | null;
  sentAt: Date | null;
  receivedAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  bouncedAt: Date | null;
  openCount: number;
  clickCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SendEmailInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  templateId?: string;
  context?: Partial<IEmailContext>;
  inReplyTo?: string;
  threadId?: string;
  sentBy?: string;
  variables?: Record<string, string>;
}
