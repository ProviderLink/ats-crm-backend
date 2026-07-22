# ATS-CRM-Backend — Deep Audit (CRM Focus)

> **Project**: `ats-crm-backend-v2`
> **Generated**: 2026-07-09
> **Root**: `/ats-crm-workspace/ats-crm-backend/`

---

## 1. Tech Stack & Config

| Layer            | Technology                               | Version                   |
| ---------------- | ---------------------------------------- | ------------------------- |
| Runtime          | Node.js                                  | >=20                      |
| Framework        | Express                                  | ^4.18.2                   |
| Language         | TypeScript                               | ^5.3.0                    |
| Database         | MongoDB (Mongoose)                       | ^8.0.0                    |
| Auth             | JWT (access + refresh, HttpOnly cookies) | ^9.0.0                    |
| Email            | Resend SDK                               | ^6.4.0                    |
| File Storage     | Cloudinary                               | ^2.0.0                    |
| Realtime         | Socket.IO                                | ^4.7.0                    |
| Validation       | Zod                                      | ^3.22.0                   |
| Cron Jobs        | node-cron                                | ^3.0.3                    |
| Error Monitoring | Sentry                                   | ^8.0.0                    |
| Logging          | Winston                                  | ^3.19.0                   |
| Security         | Helmet + cors + express-rate-limit       | ^7.0.0 / ^2.8.5 / ^7.0.0  |
| AI               | Claude (Anthropic)                       | custom `shared/utils/ai/` |
| Webhooks         | Svix                                     | ^1.96.1                   |

### Environment Variables (required)

`PORT`, `NODE_ENV`, `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES`, `CLOUDINARY_*` (3 vars), `RESEND_API_KEY`, `ZOOM_*` (3 vars), `COMPANY_TIMEZONE`, `COMPANY_EMAIL`, `COMPANY_NAME`, `SENTRY_DSN`, `ATS_FRONTEND_URL`, `CRM_FRONTEND_URL`. Optional: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_WEBHOOK_SECRET`.

### Package manager

pnpm >= 10, `packageManager` field set to `pnpm@10.28.2`.

---

## 2. Project Structure

```
src/
├── app.ts                      # Express app: middleware, route mounting, DB connect, jobs, sockets
├── config/
│   ├── env.ts                  # Env validation (22 required vars)
│   ├── db.ts                   # Mongoose connection
│   └── cloudinary.ts           # Cloudinary upload/delete helpers
├── features/                   # Domain modules (21 total, each with .routes.ts, .controller.ts, .service.ts, .model.ts, .types.ts)
│   ├── auth/                   # Login, logout, refresh, password reset, email verify
│   ├── users/                  # User CRUD, permissions, roles, avatar, provisionClient
│   ├── assignments/            # CRM: VA↔client assignment management
│   ├── work-entries/           # CRM: daily work logging
│   ├── eod-submissions/        # CRM: end-of-day reports
│   ├── eod-reminders/          # CRM: EOD compliance tracking (system-generated)
│   ├── performance-reviews/    # CRM: AI-generated reviews + manual editing
│   ├── survey-reminders/       # CRM: scheduled client/VA surveys
│   ├── dashboard/crm/          # CRM: admin dashboard stats
│   ├── reports/                # CRM: CSV export (work entries, EOD, performance)
│   ├── activity-logs/          # Shared: audit trail
│   ├── settings/               # Shared: app settings
│   ├── clients/                # ATS: client companies
│   ├── candidates/             # ATS: candidates/VAs
│   ├── jobs/                   # ATS: job postings
│   ├── applications/           # ATS: candidate applications
│   ├── interviews/             # ATS: interview scheduling
│   ├── tags/                   # ATS: tagging system
│   ├── pipeline-templates/     # ATS: pipeline stage templates
│   ├── email-templates/        # ATS: email templates
│   ├── emails/                 # ATS: email sending + tracking
│   └── webhooks/               # Resend webhook receiver
├── jobs/                       # Background cron jobs
│   ├── index.ts                # Scheduler entry point
│   ├── eodCompliance.job.ts    # Daily at 5 PM — check missing EODs, send reminders
│   ├── surveyDispatcher.job.ts # Daily at 9 AM — dispatch due survey reminders
│   ├── aiCandidacyValidation.job.ts  # ATS
│   ├── aiCandidateScoring.job.ts     # ATS
│   ├── aiResumeParsing.job.ts        # ATS
│   └── aiResumeValidation.job.ts     # ATS
├── sockets/
│   ├── index.ts                # Socket.IO init (ATS + CRM namespaces)
│   ├── ats.socket.ts           # /ats namespace — rooms: applications, candidates, jobs, etc.
│   └── crm.socket.ts           # /crm namespace — rooms: assignments, user:<id>
├── scripts/
│   ├── seed-admin.ts           # Creates initial admin user
│   ├── seed-demo.ts            # Seeds demo data
│   └── seed-email-templates.ts # Seeds default email templates (runs on startup)
└── shared/
    ├── middleware/
    │   ├── authenticate.ts     # JWT verification → req.user
    │   ├── authorize.ts        # requireRoles, requirePermission, requireAppAccess
    │   ├── errorHandler.ts     # Global error handler
    │   └── upload.ts           # Multer config
    ├── validators/
    │   └── common.validator.ts # Zod validation middleware
    ├── types/
    │   └── express.d.ts        # Express Request augmentation
    └── utils/
        ├── AppError.ts         # Operational error class
        ├── catchAsync.ts       # Async error wrapper
        ├── email.ts            # Resend email sender
        ├── logger.ts           # Winston logger
        ├── response.ts         # Standardized API response
        ├── ai/                 # Claude/OpenAI helpers
        ├── googleMeet.ts
        ├── zoom.ts
        └── extract-resume-text.ts / parseResumeWithAI.ts
```

---

## 3. CRM Route Map (all under `/api/v1/crm`)

All CRM routes require `authenticate` + `requireAppAccess('crm')`.

### Auth (mounted at `/api/v1/auth`, shared with ATS)

| Method | Path               | Auth   | Roles | Description                                     |
| ------ | ------------------ | ------ | ----- | ----------------------------------------------- |
| POST   | `/login`           | Public | —     | Login (app=crm → sets `refreshTokenCrm` cookie) |
| POST   | `/logout`          | Bearer | any   | Logout (clears app-specific refresh cookie)     |
| POST   | `/refresh-token`   | Public | —     | Refresh access token from HttpOnly cookie       |
| POST   | `/forgot-password` | Public | —     | Send reset email                                |
| POST   | `/reset-password`  | Public | —     | Reset password with token                       |
| POST   | `/change-password` | Bearer | any   | Change own password                             |
| POST   | `/verify-email`    | Public | —     | Verify email                                    |
| POST   | `/set-password`    | Public | —     | First-time password set via invite              |

**Key auth design**: Separate `refreshTokenAts` and `refreshTokenCrm` per user. Login with `app: 'crm'` sets `refreshTokenCrm` cookie. Refresh reads the appropriate cookie. This allows a user to be logged into both apps independently.

### Users (mounted at `/api/v1/shared/users`, shared with ATS)

| Method | Path               | Auth   | Roles                          | Description                               |
| ------ | ------------------ | ------ | ------------------------------ | ----------------------------------------- |
| GET    | `/`                | Bearer | admin only (perm: team.read)   | List all users (filter by role, isActive) |
| POST   | `/`                | Bearer | admin only (perm: team.write)  | Create user + send invite email           |
| GET    | `/:id`             | Bearer | admin only (perm: team.read)   | Get user by ID                            |
| PATCH  | `/:id`             | Bearer | admin only (perm: team.write)  | Update user                               |
| DELETE | `/:id`             | Bearer | admin only (perm: team.manage) | Deactivate user                           |
| PATCH  | `/:id/permissions` | Bearer | admin only (perm: team.manage) | Update fine-grained permissions           |
| PATCH  | `/me`              | Bearer | any                            | Update own profile                        |
| POST   | `/me/avatar`       | Bearer | any                            | Upload avatar (Cloudinary)                |

**User model roles** (8): `admin`, `hiring_manager`, `recruiter`, `coordinator`, `interviewer` (ATS), `account_manager`, `client`, `va` (CRM).

**App access**: Derived from roles. `admin` → `['ats', 'crm']`. ATS roles → `['ats']`. CRM roles → `['crm']`.

**Permission model**: Granular RBAC — `{ candidates: { read, write, manage }, assignments: { read, write, manage }, eod: { read, write, approve }, performanceReview: { read, write, approve }, ... }` for 16 resources. Permission hierarchy: `manage > write > read`, `schedule > write > read`, `approve > write > read`.

**`provisionClient()`**: Called during assignment creation. If the client doesn't have a CRM user yet, auto-creates one with role `client`, links via `clientRef`, generates invite token.

### Assignments (`/api/v1/crm/assignments`)

| Method | Path   | Auth   | Roles                              | Description                                                                         |
| ------ | ------ | ------ | ---------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/`    | Bearer | admin, account_manager             | List all (paginated, filterable by candidateId, clientId, status, accountManagerId) |
| POST   | `/`    | Bearer | admin, account_manager             | Create assignment (validates candidate + client exist)                              |
| GET    | `/:id` | Bearer | admin, account_manager, client, va | Get by ID                                                                           |
| PATCH  | `/:id` | Bearer | admin, account_manager             | Update (cannot update ended assignments)                                            |
| DELETE | `/:id` | Bearer | admin, account_manager             | End assignment (sets status=ended)                                                  |

**Schema**: `candidateId`, `clientId`, `status` (active/on_hold/ended), `serviceType`, `startDate`, `endDate`, `accountManagerId`, `notes`, `createdBy`, `updatedBy`.

**Side effects on create**:

1. Provisions a CRM client user via `provisionClient()` if none exists — sends invite email.
2. Auto-creates survey reminders at 30, 60, 90 days from start via `createAssignmentReminders()`.
3. Logs activity (`activity-logs`).
4. Emits `assignment:created` via Socket.IO to CRM `/crm` namespace room `assignments`.

### Work Entries (`/api/v1/crm/work-entries`)

| Method | Path   | Auth   | Roles                              | Description                                         |
| ------ | ------ | ------ | ---------------------------------- | --------------------------------------------------- |
| GET    | `/`    | Bearer | admin, account_manager, client, va | List (filterable by assignmentId, dateFrom, dateTo) |
| POST   | `/`    | Bearer | admin, account_manager, va         | Create work entry                                   |
| GET    | `/:id` | Bearer | admin, account_manager, client, va | Get by ID                                           |
| PATCH  | `/:id` | Bearer | admin, account_manager, va         | Update                                              |
| DELETE | `/:id` | Bearer | admin, account_manager             | Delete                                              |

**Schema**: `assignmentId`, `candidateId`, `clientId` (denormalized for queries), `entryDate`, `entryTime` (HH:MM), `taskCategory`, `taskDescription`, `timeSpent` (minutes, 1–480), `status` (completed/in_progress/pending), `notes`.

**Indexes**: `assignmentId`, `candidateId`, `clientId`, `entryDate`, compound `(assignmentId, entryDate)`.

### EOD Submissions (`/api/v1/crm/eod-submissions`)

| Method | Path   | Auth   | Roles                              | Description                                         |
| ------ | ------ | ------ | ---------------------------------- | --------------------------------------------------- |
| GET    | `/`    | Bearer | admin, account_manager, client, va | List (filterable by assignmentId, dateFrom, dateTo) |
| POST   | `/`    | Bearer | admin, account_manager, va         | Create EOD submission                               |
| GET    | `/:id` | Bearer | admin, account_manager, client, va | Get by ID                                           |
| PATCH  | `/:id` | Bearer | admin, account_manager, va         | Update                                              |

**Schema**: `assignmentId`, `candidateId`, `clientId`, `date`, `shiftStart`, `shiftEnd`, `hoursWorked`, `summaryOfWork`, `pendingTasks`, `blockers`, `notes`.

**Unique constraint**: `(assignmentId, date)` — one EOD per assignment per day.

### EOD Reminders (`/api/v1/crm/eod-reminders`)

| Method | Path   | Auth   | Roles                  | Description        |
| ------ | ------ | ------ | ---------------------- | ------------------ |
| GET    | `/`    | Bearer | admin, account_manager | List all reminders |
| GET    | `/:id` | Bearer | admin, account_manager | Get by ID          |

**Read-only**. Populated by the EOD Compliance cron job. Tracks every reminder sent to VAs for missing EODs.

**Schema**: `assignmentId`, `candidateId`, `reminderDate`, `reminderType`, `status` (sent/failed).

### Performance Reviews (`/api/v1/crm/performance-reviews`)

| Method | Path              | Auth   | Roles                      | Description                                          |
| ------ | ----------------- | ------ | -------------------------- | ---------------------------------------------------- |
| GET    | `/`               | Bearer | admin, account_manager, va | List all (paginated, filterable)                     |
| POST   | `/`               | Bearer | admin, account_manager     | **AI-generate** a review (Claude API)                |
| GET    | `/:id`            | Bearer | admin, account_manager, va | Get by ID                                            |
| PATCH  | `/:id`            | Bearer | admin, account_manager     | Update review (categories, ratings, comments)        |
| PATCH  | `/:id/complete`   | Bearer | admin, account_manager     | Mark as completed                                    |
| POST   | `/:id/regenerate` | Bearer | admin, account_manager     | Regenerate section (categories/goals/summary) via AI |

**Schema**: `candidateId`, `clientId`, `jobId`, `reviewType` (30_day/60_day/90_day/annual/client_satisfaction/corrective_coaching), `reviewPeriodStart/End`, `status` (draft/ai_generated/completed), `aiGenerated` (roleSummary, coreResponsibilities, strengths, areasForImprovement, goals[], finalRecommendation), `categories[]` (categoryName, description, questions, KPIs, rating, comments), `overallRating`, `clientSatisfactionScore`, `managerRatingInputs`, `finalRecommendation`, `generatedByUserId`, `reviewedByUserId`.

**AI generation flow**: Collects candidate, client, and job data → builds prompt → calls `callClaude()` → parses JSON → creates review with status `ai_generated` → emits Socket.IO event.

**Regeneration**: Can regenerate `categories`, `goals`, or `summary` sections individually.

### Survey Reminders (`/api/v1/crm/survey-reminders`)

| Method | Path   | Auth   | Roles                  | Description                                                         |
| ------ | ------ | ------ | ---------------------- | ------------------------------------------------------------------- |
| GET    | `/`    | Bearer | admin, account_manager | List all (filterable by relatedType, relatedId, status, assignedTo) |
| POST   | `/`    | Bearer | admin, account_manager | Create reminder                                                     |
| GET    | `/:id` | Bearer | admin, account_manager | Get by ID                                                           |
| PATCH  | `/:id` | Bearer | admin, account_manager | Update (status, completedDate, etc.)                                |

**Schema**: `relatedType` (client/va/assignment), `relatedId`, `surveyType` (3_day/1_week/30_day/60_day/90_day/monthly), `dueDate`, `completedDate`, `status` (pending/sent/completed/skipped), `assignedTo`.

**Auto-creation**: When an assignment is created, `createAssignmentReminders()` inserts 3 reminders at 30, 60, and 90 days from start.

### CRM Dashboard (`/api/v1/crm/dashboard`)

| Method | Path | Auth   | Roles                  | Description         |
| ------ | ---- | ------ | ---------------------- | ------------------- |
| GET    | `/`  | Bearer | admin, account_manager | Get dashboard stats |

**Returns**:

- **Overview**: totalAssignments, activeAssignments, onHoldAssignments, endedAssignments, totalEodSubmissionsToday, totalWorkEntriesToday, missingEodsToday.
- **EOD Compliance**: complianceRate (submittedToday ÷ activeAssignments × 100).
- **Recent EODs**: last 10 submissions.
- **Assignment Health**: active/on_hold/ended breakdown.
- **Weekly Work Hours**: totalMinutes, totalHours, entriesCount (last 7 days).

### Reports (`/api/v1/crm/reports`)

| Method | Path                      | Auth   | Roles                  | Description                                                    |
| ------ | ------------------------- | ------ | ---------------------- | -------------------------------------------------------------- |
| GET    | `/work-entries/export`    | Bearer | admin, account_manager | CSV export (filter: startDate, endDate, candidateId, clientId) |
| GET    | `/eod-submissions/export` | Bearer | admin, account_manager | CSV export (same filters)                                      |
| GET    | `/performance/export`     | Bearer | admin, account_manager | CSV export (same filters)                                      |

Generates CSV on-the-fly, streams as file download.

---

## 4. Background Jobs (CRM-related)

Both CRM jobs use `node-cron`.

### EOD Compliance Job (`jobs/eodCompliance.job.ts`)

- **Schedule**: `0 17 * * *` (daily at 5 PM, server timezone).
- **Logic**: Finds all active assignments → checks if EOD exists for today → if missing, emails the VA → creates an `EodReminder` record → logs activity.
- **Email recipient**: Uses candidate's email from the `Candidate` collection.

### Survey Dispatcher Job (`jobs/surveyDispatcher.job.ts`)

- **Schedule**: `0 9 * * *` (daily at 9 AM).
- **Logic**: Finds all `SurveyReminder` with `status: 'pending'` and `dueDate <= today` → emails the assigned account manager → marks reminder as `sent` → logs activity.

### Other ATS-only jobs (exported but not CRM)

- `aiCandidacyValidation`, `aiCandidateScoring`, `aiResumeParsing`, `aiResumeValidation` (not active via cron, available for manual invocation).

---

## 5. WebSockets (CRM)

**Namespace**: `/crm`

**Auth**: JWT token via `handshake.auth.token` or `Authorization` header. User must have `appAccess: ['crm']` or be admin.

**Auto-join rooms on connect**:

- `assignments` — global assignments channel.
- `user:<userId>` — personal channel.

**Events emitted from services**:
| Event | Room | Trigger |
|-------|------|---------|
| `assignment:created` | `assignments` | New assignment created |
| `performanceReview:created` | `assignments` | AI review generated |

**ATS namespace** (`/ats`): Separate namespace with rooms for `applications`, `candidates`, `jobs`, `clients`, `tags`, `pipeline-templates`, `email-templates`, plus dynamic `job:<jobId>` rooms.

---

## 6. Shared Infrastructure

### Middleware

- **`authenticate`**: Extracts Bearer token → verifies JWT → sets `req.user` with `_id`, `firstName`, `lastName`, `roles`, `appAccess`, `permissions`. Throws 401 on expiry/invalid.
- **`requireRoles(...roles)`**: Checks `req.user.roles` intersection. Admins always pass.
- **`requireAppAccess(app)`**: Checks `req.user.appAccess`. Admins always pass.
- **`requirePermission(resource, action)`**: Fine-grained permission check with hierarchy (manage > write > read). Admins always pass.
- **`errorHandler`**: Global Express error handler. Operational errors (`AppError`) → structured JSON. Unexpected errors → 500 with Sentry capture.
- **`upload.ts`**: Multer middleware factory for avatar uploads.

### Utils

- **`AppError`**: `{ statusCode, code, message }` with `isOperational = true`.
- **`catchAsync`**: Wraps async route handlers, forwards errors to `next()`.
- **`sendSuccess(res, data, message, statusCode, meta?)`**: Standardized `{ success: true, message, data, meta }`.
- **`email.ts`**: `sendEmail({ to, subject, html, text })` — wraps Resend SDK.
- **`logger.ts`**: Winston with `http` level route logging + structured JSON.
- **`ai/index.ts`**: `callClaude(prompt, maxTokens)` and `parseJsonResponse<T>(text)` — used by performance review generation.

### Response envelope pattern

All API responses follow: `{ success: true, message, data, meta? }`. Errors follow: `{ success: false, code, message }`.

---

## 7. CRM Domain Models Summary

| Model             | Collection         | Key Indexes                                                                              | Relationships                               |
| ----------------- | ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| User              | users              | roles, isActive                                                                          | clientRef→Client, candidateRef→Candidate    |
| Assignment        | assignments        | candidateId, clientId, status, accountManagerId, compound (candidate+client)             | →Candidate, →Client, →User (accountManager) |
| WorkEntry         | workentries        | assignmentId, candidateId, clientId, entryDate, compound (assignment+date)               | →Assignment, →Candidate, →Client            |
| EodSubmission     | eodsubmissions     | assignmentId, candidateId, clientId, date, compound (assignment+date, unique)            | →Assignment, →Candidate, →Client            |
| EodReminder       | eodreminders       | candidateId, assignmentId, status, reminderDate                                          | →Assignment, →Candidate                     |
| PerformanceReview | performancereviews | (standard \_id only)                                                                     | →Candidate, →Client, →Job, →User            |
| SurveyReminder    | surveyreminders    | compound (relatedType+relatedId), status, dueDate, assignedTo, compound (status+dueDate) | →User (assignedTo)                          |
| ActivityLog       | activitylogs       | (standard \_id only)                                                                     | Polymorphic (resourceType + resourceId)     |
| Settings          | settings           | singleton                                                                                | —                                           |

---

## 8. CRM Flow Summary

1. **Assignment creation**: Admin/AM links a Candidate (VA) to a Client → auto-provisions client CRM user → sends invite → creates 30/60/90-day survey reminders → emits Socket.IO event.
2. **Daily VA work**: VA logs `WorkEntry` (task category, description, time). VA submits `EodSubmission` (shift hours, summary, pending tasks, blockers).
3. **EOD compliance**: Cron at 5 PM checks all active assignments for today's EOD → sends email reminders to VAs who haven't submitted → records in `EodReminder`.
4. **Survey workflow**: Cron at 9 AM sends pending survey reminder emails to account managers. Account managers update status (pending→sent→completed/skipped).
5. **Performance reviews**: Admin/AM triggers AI generation (Claude) → system creates review with categories, questions, KPIs → manager fills ratings/comments → completes review.
6. **Dashboard & reporting**: Admin dashboard shows real-time assignment health, EOD compliance rate, weekly work hours. CSV exports for work entries, EODs, and performance.
7. **Realtime**: Socket.IO `/crm` namespace notifies connected clients of new assignments and reviews.

---

## 9. Key Observations

1. **Unified ATS+CRM backend**: Single Express app serving both products. Auth, users, settings, and activity logs are shared. Domain features are namespaced under `/api/v1/ats/` or `/api/v1/crm/`.
2. **App-specific refresh tokens**: `refreshTokenAts` and `refreshTokenCrm` are separate fields on User. Login/logout/refresh respect the `app` parameter. This allows dual-login to both apps.
3. **Role → appAccess derivation**: `deriveAppAccess()` maps roles to `['ats']`, `['crm']`, or `['ats', 'crm']`. Admin gets both. Middleware `requireAppAccess()` gates all routes.
4. **Fine-grained permissions**: Beyond role-based checks, a 16-resource permission matrix supports custom overrides via `PATCH /users/:id/permissions`.
5. **No soft-delete**: `DELETE /assignments/:id` sets `status: 'ended'` (logical end). `DELETE /users/:id` sets `isActive: false`. Work entries are hard-deleted.
6. **Denormalized IDs**: WorkEntry and EodSubmission store `candidateId` and `clientId` in addition to `assignmentId` for query efficiency.
7. **AI integration**: Performance reviews are the only CRM feature using AI (Claude). Generates a full review template with categories, questions, KPIs, and recommendations. Supports per-section regeneration.
8. **Cron jobs are hardcoded**: EOD compliance at 17:00, survey dispatcher at 09:00. No dynamic scheduling UI.
9. **Socket.IO rooms are coarse**: CRM namespace has only `assignments` and `user:<id>` rooms. No per-assignment or per-client rooms.
10. **Email templates seeded on startup**: `seed-email-templates.ts` runs automatically after DB connect.
11. **Sentry double-init**: `Sentry.init()` is called twice in `app.ts` (lines 6 and 50) — likely a bug.
12. **No input sanitization library**: Relies on Zod validation + Mongoose schema enforcement only.
