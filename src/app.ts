import * as Sentry from '@sentry/node';
import './config/env';
import { env } from './config/env';

// Must init Sentry BEFORE importing express — only once
Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  integrations: [Sentry.expressIntegration()],
});

import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { connectDB } from './config/db';
import { getDashboardMetrics } from './features/dashboard/ats/atsDashboard.service';
import { getAllApplications } from './features/applications/application.service';
import { getAllClients } from './features/clients/client.service';
import { getAllInterviews } from './features/interviews/interview.service';
import { getAllJobs } from './features/jobs/job.service';
import { getAllUsers } from './features/users/user.service';
import { warmUpCandidateTable } from './features/candidates/candidate.table.service';
import activityLogRouter from './features/activity-logs/activityLog.routes';
import applicationRouter from './features/applications/application.routes';
import assignmentRouter from './features/assignments/assignment.routes';
import authRouter from './features/auth/auth.routes';
import candidateRouter from './features/candidates/candidate.routes';
import clientAccountRouter from './features/client-accounts/clientAccount.routes';
import clientRouter from './features/clients/client.routes';
import atsDashboardRouter from './features/dashboard/ats/atsDashboard.routes';
import crmDashboardRouter from './features/dashboard/crm/crmDashboard.routes';
import dispositionReasonRouter from './features/disposition-reasons/dispositionReason.routes';
import emailTemplateRouter from './features/email-templates/emailTemplate.routes';
import emailRouter from './features/emails/email.routes';
import eodReminderRouter from './features/eod-reminders/eodReminder.routes';
import eodSubmissionRouter from './features/eod-submissions/eodSubmission.routes';
import interviewScorecardRouter from './features/interview-scorecards/interview-scorecard.routes';
import externalMeetingRouter from './features/external-meetings/externalMeeting.routes';
import interviewRouter from './features/interviews/interview.routes';
import jobRouter from './features/jobs/job.routes';
import performanceReviewRouter from './features/performance-reviews/performanceReview.routes';
import pipelineTemplateRouter from './features/pipeline-templates/pipelineTemplate.routes';
import reportsRouter from './features/reports/reports.routes';
import scorecardRouter from './features/scorecards/scorecard.routes';
import settingsRouter from './features/settings/settings.routes';
import surveyReminderRouter from './features/survey-reminders/surveyReminder.routes';
import tagRouter from './features/tags/tag.routes';
import userRouter from './features/users/user.routes';
import vaProfileRouter from './features/va-profiles/vaProfile.routes';
import webhookRouter from './features/webhooks/webhook.routes';
import workEntryRouter from './features/work-entries/workEntry.routes';
import { startBackgroundJobs } from './jobs';
import { seedEmailTemplates } from './scripts/seed-email-templates';
import errorHandler from './shared/middleware/errorHandler';
import AppError from './shared/utils/AppError';
import logger from './shared/utils/logger';
import { initializeSockets } from './sockets';

const app = express();

// Heroku and other cloud platforms use reverse proxies —
// trust the X-Forwarded-* headers for rate limiting, cookies, and IP logging.
app.set('trust proxy', 1);

app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: [env.ATS_FRONTEND_URL, env.CRM_FRONTEND_URL],
    credentials: true,
  })
);

// Capture raw body for Resend webhook signature verification.
// The `verify` callback receives the raw Buffer BEFORE JSON.parse —
// this is the standard Express pattern for HMAC verification.
// Use req.originalUrl (not req.path) — path isn't set by the router yet.
app.use(
  express.json({
    verify: (req: Request, _res: Response, buf: Buffer) => {
      if (req.originalUrl.startsWith('/api/webhooks/resend')) {
        (req as any).rawBody = buf;
      }
    },
  })
);
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

if (env.NODE_ENV === 'production') {
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
}

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
app.use('/api/v1/ats/external-meetings', externalMeetingRouter);
app.use('/api/v1/ats/interview-scorecards', interviewScorecardRouter);
app.use('/api/v1/ats/disposition-reasons', dispositionReasonRouter);
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
// ATS disposition reports via /api/v1/reports/ats/dispositions/export
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/crm/scorecards', scorecardRouter);
app.use('/api/v1/crm/client-accounts', clientAccountRouter);
app.use('/api/v1/crm/va-profiles', vaProfileRouter);

// Webhook routes (no auth — called by Resend servers)
app.use('/api/webhooks', webhookRouter);

app.use((_req, _res, next) => {
  next(new AppError(404, 'RESOURCE_NOT_FOUND', 'Route not found'));
});

Sentry.setupExpressErrorHandler(app, {
  shouldHandleError(error): boolean {
    // Don't send 4xx (client errors) to Sentry
    const statusCode = (error as any).statusCode;
    return statusCode >= 500 || !statusCode;
  },
});

app.use(errorHandler);

// Connect first, then start background jobs.
connectDB()
  .then(() => {
    logger.info('Database connected');
    // Build the Candidates-table data now so the first page view is not the
    // one that pays for it. Failure only means the first request loads it.
    void warmUpCandidateTable().catch(error =>
      logger.warn('Candidate table warm-up failed', { error })
    );
    // The lists every login asks for, so the first user does not wait on them.
    const all = { page: 1, limit: 9999 };
    void Promise.allSettled([
      getAllJobs(all),
      getAllClients(all),
      getAllApplications(all),
      getAllInterviews(all),
      getAllUsers(all),
      getDashboardMetrics(),
    ]);
    return seedEmailTemplates();
  })
  .catch(error => {
    logger.error('companySize migration failed', { error });
  });
startBackgroundJobs();

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);
});

initializeSockets(server);

export { io } from './sockets';
export { app, server };
