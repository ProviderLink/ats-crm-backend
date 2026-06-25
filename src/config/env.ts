import dotenv from 'dotenv';
dotenv.config();

const required = [
  'PORT',
  'NODE_ENV',
  'MONGODB_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ACCESS_EXPIRES',
  'JWT_REFRESH_EXPIRES',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'RESEND_API_KEY',
  'ANTHROPIC_API_KEY',
  'ZOOM_ACCOUNT_ID',
  'ZOOM_CLIENT_ID',
  'ZOOM_CLIENT_SECRET',
  'COMPANY_TIMEZONE',
  'COMPANY_EMAIL',
  'COMPANY_NAME',
  'SENTRY_DSN',
  'ATS_FRONTEND_URL',
  'CRM_FRONTEND_URL',
] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  PORT: process.env.PORT!,
  NODE_ENV: process.env.NODE_ENV!,
  MONGODB_URI: process.env.MONGODB_URI!,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET!,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET!,
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES!,
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES!,
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME!,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY!,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET!,
  RESEND_API_KEY: process.env.RESEND_API_KEY!,
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET || '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
  ZOOM_ACCOUNT_ID: process.env.ZOOM_ACCOUNT_ID!,
  ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID!,
  ZOOM_CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET!,
  COMPANY_TIMEZONE: process.env.COMPANY_TIMEZONE!,
  COMPANY_EMAIL: process.env.COMPANY_EMAIL!,
  COMPANY_NAME: process.env.COMPANY_NAME!,
  SENTRY_DSN: process.env.SENTRY_DSN!,
  ATS_FRONTEND_URL: process.env.ATS_FRONTEND_URL!,
  CRM_FRONTEND_URL: process.env.CRM_FRONTEND_URL!,
};
