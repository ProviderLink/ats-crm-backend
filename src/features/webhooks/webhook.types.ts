export interface ResendWebhookEvent {
  type: ResendWebhookEventType;
  created_at: string;
  data: ResendWebhookData;
}

export type ResendWebhookEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.complained'
  | 'email.bounced'
  | 'email.opened'
  | 'email.clicked'
  | 'email.received';

export interface ResendWebhookData {
  email_id: string;
  from?: string;
  to?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  message_id?: string;
  created_at?: string;
}

export interface ResendEmailContent {
  id: string;
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  message_id?: string;
  headers?: Record<string, string>;
  attachments?: ResendAttachmentMetadata[];
}

export interface ResendAttachmentMetadata {
  id: string;
  filename: string;
  content_type: string;
  content_disposition: string;
  content_id?: string;
  size: number;
}

export interface ResendAttachment {
  id: string;
  filename: string;
  content_type: string;
  content_disposition: string;
  content_id?: string;
  size: number;
  download_url: string;
  expires_at: string;
}

export interface ProcessedAttachment {
  id: string;
  filename: string;
  contentType: string;
  contentDisposition: string;
  contentId?: string;
  size: number;
  downloadUrl: string;
  expiresAt: string;
}
