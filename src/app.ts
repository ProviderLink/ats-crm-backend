import * as Sentry from '@sentry/node';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { connectDB } from './config/db';
import './config/env';
import { env } from './config/env';
import activityLogRouter from './features/activity-logs/activityLog.routes';
import applicationRouter from './features/applications/application.routes';
import assignmentRouter from './features/assignments/assignment.routes';
import authRouter from './features/auth/auth.routes';
import candidateRouter from './features/candidates/candidate.routes';
import clientRouter from './features/clients/client.routes';
import atsDashboardRouter from './features/dashboard/ats/atsDashboard.routes';
import crmDashboardRouter from './features/dashboard/crm/crmDashboard.routes';
import emailTemplateRouter from './features/email-templates/emailTemplate.routes';
import emailRouter from './features/emails/email.routes';
import eodReminderRouter from './features/eod-reminders/eodReminder.routes';
import eodSubmissionRouter from './features/eod-submissions/eodSubmission.routes';
import interviewRouter from './features/interviews/interview.routes';
import jobRouter from './features/jobs/job.routes';
import performanceReviewRouter from './features/performance-reviews/performanceReview.routes';
import pipelineTemplateRouter from './features/pipeline-templates/pipelineTemplate.routes';
import reportsRouter from './features/reports/reports.routes';
import settingsRouter from './features/settings/settings.routes';
import surveyReminderRouter from './features/survey-reminders/surveyReminder.routes';
import tagRouter from './features/tags/tag.routes';
import userRouter from './features/users/user.routes';
import workEntryRouter from './features/work-entries/workEntry.routes';
import { startBackgroundJobs } from './jobs';
import errorHandler from './shared/middleware/errorHandler';
import AppError from './shared/utils/AppError';
import logger from './shared/utils/logger';
import { initializeSockets } from './sockets';

Sentry.init({ dsn: env.SENTRY_DSN });

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: [env.ATS_FRONTEND_URL, env.CRM_FRONTEND_URL],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.http(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
      {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration,
        ip: req.ip,
      }
    );
  });
  next();
});

app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
  })
);

app.use(
  '/api/v1/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
  })
);

// Shared routes
app.use('/api/v1/shared/users', userRouter);
app.use('/api/v1/shared/settings', settingsRouter);
app.use('/api/v1/shared/activity-logs', activityLogRouter);

app.use('/api/v1/auth', authRouter);
// ATS routes
app.use('/api/v1/ats/clients', clientRouter);
app.use('/api/v1/ats/tags', tagRouter);
app.use('/api/v1/ats/pipeline-templates', pipelineTemplateRouter);
app.use('/api/v1/ats/jobs', jobRouter);
app.use('/api/v1/ats/candidates', candidateRouter);
app.use('/api/v1/ats/applications', applicationRouter);
app.use('/api/v1/ats/interviews', interviewRouter);
app.use('/api/v1/ats/email-templates', emailTemplateRouter);
app.use('/api/v1/ats/emails', emailRouter);
app.use('/api/v1/ats/dashboard', atsDashboardRouter);

// CRM routes
app.use('/api/v1/crm/assignments', assignmentRouter);
app.use('/api/v1/crm/work-entries', workEntryRouter);
app.use('/api/v1/crm/eod-submissions', eodSubmissionRouter);
app.use('/api/v1/crm/eod-reminders', eodReminderRouter);
app.use('/api/v1/crm/performance-reviews', performanceReviewRouter);
app.use('/api/v1/crm/survey-reminders', surveyReminderRouter);
app.use('/api/v1/crm/dashboard', crmDashboardRouter);
app.use('/api/v1/crm/reports', reportsRouter);

app.use((_req, _res, next) => {
  next(new AppError(404, 'RESOURCE_NOT_FOUND', 'Route not found'));
});

app.use(errorHandler);

connectDB();
startBackgroundJobs();

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);
});

initializeSockets(server);

export { io } from './sockets';
export { app, server };
