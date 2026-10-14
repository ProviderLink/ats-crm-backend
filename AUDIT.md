# Arista Unified Backend (ATS + CRM API) — Full Codebase Audit

**Repo:** `ats-crm/backend` · **Audited:** 14 Oct 2026 · **Method:** read-only, every file in `src/` read top to bottom (207 files incl. config and docs, ~27,800 lines of TS), `dist/` compared against `src/`. Nothing was built, run, edited or pushed. Production was not contacted.

**How to read this document**

- **Part A** is the synthesis: architecture, request lifecycle, auth and permissions, module map, data model, how each frontend uses the API, external services, crons, and the ranked issue list. It also records which findings of the 8–9 Oct security audits are now fixed in `src`.
- **Part B** is the detailed audit in two areas, each with files read and line counts, per-file notes, flows, roles, every route with its guard, socket events, models, dependencies and numbered issues with `path:line`:
  - **Area A** — ATS-side and shared modules (auth, users, candidates, applications, jobs, interviews, clients, emails, templates, dispositions, scorecards, settings, tags, activity logs, ATS dashboard, webhooks) plus middleware: 75 issues.
  - **Area B** — CRM modules (assignments, client accounts, CRM dashboard, EOD reminders/submissions, performance reviews, reports, scorecards, survey reminders, VA profiles, work entries) plus core (`app.ts`, config, shared utils incl. AI, crons, sockets, scripts, docs, `dist/`): 46 issues.
- References like **[A-3]** / **[B-12]** point to those issue lists.
- "Inferred" means reasoned from code or library semantics, not executed.

**Limitations:** no `.env`, `.env.example`, `.gitignore` or `.git` in the copy, so secrets, ignore rules and commit history (including the reverted 7 Oct hardening commits mentioned in earlier audits) were not checked.

---

# Part A — Synthesis

## A1. What it is

One Express 4 + Mongoose 8 API that serves both SPAs:

- **ATS** (`/api/v1/ats/*`, public careers endpoints, Resend webhooks) — candidates, applications/pipeline, jobs, interviews (Zoom), clients, emails, templates, rejection reasons, interview scorecards, tags, dashboard.
- **CRM** (`/api/v1/crm/*`) — assignments, client accounts, VA profiles, work entries, EOD submissions and reminders, survey reminders, scorecards, AI performance reviews, CSV/XLSX reports, dashboard.
- **Shared** (`/api/v1/auth`, `/api/v1/shared/{users,settings,activity-logs}`) — one user collection, per-app refresh cookies, role→permission matrix, settings singleton, audit trail.
- **Background:** two company-timezone crons (EOD compliance 17:00, survey dispatcher 09:00) and four in-process AI jobs (resume parsing, resume validation, candidacy validation, candidate scoring).
- **Realtime:** Socket.IO namespaces `/ats` and `/crm`.

Deploy target: Heroku-style (`Procfile: web: node dist/app.js`).

## A2. Stack and dependencies

express ^4.18, mongoose ^8, zod ^3.22, jsonwebtoken, bcryptjs (cost 12), cookie-parser, cors, helmet, express-rate-limit, multer (memory), cloudinary ^2, **resend ^6.4.0-canary.0** (canary in prod deps [B-33]), svix (webhook signatures), socket.io ^4.8, node-cron, winston, @sentry/node ^8, pdf-parse 2 + mammoth (resume text), pdfkit (review PDF), sanitize-html, **xlsx 0.18.5** (known advisories, write-only use). AI is called with `fetch` to Anthropic (`claude-sonnet-4-20250514`, hard-coded) or OpenAI (`gpt-4o`), chosen in Settings. Dev: ts-node(-dev), TypeScript ^5.3, `@types/mongoose` (obsolete for Mongoose 8). **No tests and no test script.** Details: Area B §9.

## A3. Structure

```
backend/src
├── app.ts                    bootstrap, middleware, route mounting, startup
├── config/                   env (20 required vars, throws at import), db, cloudinary
├── features/<module>/        <x>.routes.ts (zod + guards) → controller → service → model, types
│   ├── ATS/shared: activity-logs, applications, auth, candidates, clients, dashboard/ats,
│   │   disposition-reasons, email-templates, emails, interview-scorecards, interviews,
│   │   jobs, pipeline-templates, settings, tags, users, webhooks
│   └── CRM: assignments, client-accounts, dashboard/crm, eod-reminders, eod-submissions,
│       performance-reviews, reports, scorecards, survey-reminders, va-profiles, work-entries
├── jobs/                     crons (companyScheduler, cronLock, eodCompliance, surveyDispatcher) + AI jobs
├── shared/
│   ├── middleware/           authenticate, optionalAuthenticate, authorize, errorHandler, upload
│   ├── utils/                ai/ (claude, openai, retry, json), email, emailSender, companyDay, timezone,
│   │                         crmScope, coalesce, logger, pdf, zoom, googleMeet (stubs), parseResumeWithAI…
│   └── validators/           validate(), httpUrlSchema; objectId/pagination/dateRange schemas (unused)
├── sockets/                  index (emit helpers), ats.socket, crm.socket
└── scripts/                  17 seeds, migrations, cleanups
```

The feature-folder layering is consistent and easy to navigate. Weak spots: orchestration of multi-step flows lives in controllers (candidate approve/change-job, job apply) instead of services; no transactions anywhere [A-10]; enums duplicated across zod, Mongoose and TS types [A-54]; five copy-pasted multer configs [B-37]. Full annotated tree: **§A10**.

## A4. Request lifecycle

1. `config/env` loads and **throws if any of 20 vars is missing** — including Sentry DSN and Zoom credentials, so local dev and every script need them [B-32].
2. Sentry init → helmet (defaults) → CORS (exact ATS + CRM origins, credentials) → `express.json` (raw body kept for Resend webhooks; 100 kb) → cookieParser → request logger (dropped in production because level is `info`) → **production-only** rate limits: 100 req/15 min/IP on all `/api` (webhooks included), 10/15 min on `/api/v1/auth` (refresh included) [B-21, A-18].
3. Routers: `/api/v1/shared/{users,settings,activity-logs}`, `/api/v1/auth`, 12 `/api/v1/ats/*`, 11 `/api/v1/crm/*`, reports mounted twice (`/api/v1/crm/reports` and `/api/v1/reports`), `/api/webhooks` (not under v1).
4. 404 → Sentry error handler → `errorHandler` (AppError, Mongoose Validation/Cast/11000, JWT). `BSONError` (from `new ObjectId(badString)`, used everywhere) and most multer errors fall through to 500 [A-25, B-7].
5. Startup: DB connect is **not awaited** before crons and `listen` start; the catch logs a copy-pasted "companySize migration failed"; `seedEmailTemplates` runs on every boot; no SIGTERM, `unhandledRejection` or graceful shutdown handlers [B-21, A-56].
6. Response envelope: `{success, data, message, meta?}` / `{success:false, error:{code, message, details?}}` (two exceptions: webhook 401 returns `success:true`; ATS dashboard returns raw lean docs).

## A5. Auth, roles and permissions

- **Tokens:** access JWT in `Authorization: Bearer` with claims `_id, names, roles, appAccess, permissions, candidateRef, clientRef`; refresh JWT stored on the user (`refreshTokenAts` / `refreshTokenCrm`, plaintext) and set as httpOnly cookies (`sameSite: none` in prod, 7 days). `authenticate` never hits the DB, so role/permission/deactivation changes apply only when the access token expires [A-14]. Refresh now checks `isActive` (`auth.service.ts:131`).
- **Login flow quirks:** inactive check before password check (account enumeration), unknown emails skip bcrypt (timing), login does not verify the requested `app` is in `appAccess` [A-15]. Forgot-password always links to the ATS with "Arista ATS" branding [A-16]. Reset/invite tokens stored in plaintext; refresh not rotated; one session per app [A-17].
- **Guards:** `requireAppAccess('ats'|'crm')` per router (admin bypass), `requirePermission(resource, action)` with hierarchy manage ⇒ write ⇒ read and schedule ⇒ write ⇒ read, `requireRoles(...)` for a few admin-only routes. `users` and `settings` routers only use `authenticate` + permission.
- **CRM ownership:** `shared/utils/crmScope.ts` (`assertOwnsRecord`, `assertOwnsCandidate`, `scopeListFilters`) and `assignments/assignmentScope.ts` (AM scoping). Admin and AM count as staff and bypass the VA/client ownership checks.
- **Default role matrix** (`users/user.service.ts:36-154`):

| Role            | App  | Key permissions                                                                                                                 |
| --------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| admin           | both | everything                                                                                                                      |
| hiring_manager  | ATS  | candidates rwm, jobs rwm, interviews rw, scorecards rw, emails rw, tags rw; read: clients, team, settings, dashboard, templates |
| recruiter       | ATS  | candidates rwm, interviews rw, scorecards rw, emails rw; read: jobs, clients, team, tags, settings, dashboard, templates        |
| coordinator     | ATS  | candidates rw, interviews rw + schedule, scorecards rw, emails rw; read: jobs, clients, team, tags, settings, dashboard         |
| interviewer     | ATS  | candidates r, interviews rw, scorecards rw, team r, tags r (no jobs, clients, dashboard)                                        |
| account_manager | CRM  | clients rw, dashboard r, activityLogs r, assignments rwm, reports rwm, eod rw + approve, performanceReview rw + approve         |
| client          | CRM  | clients r, assignments r, reports r, eod r                                                                                      |
| va              | CRM  | assignments r, eod w                                                                                                            |

- **Gaps:** self-escalation by a non-admin holding team permissions [A-3]; `provisionVA/Client` resurrect any matching account (incl. deactivated staff) with old roles [A-4]; `DELETE /shared/users/:id` hard-deletes while saying "deactivated" [A-24]; `includeIneligible=true` bypasses the admin-only ban view [A-12]; AM scoping missing on survey reminders, client accounts, VA profiles, scorecard generation and the `/crm` socket room [B-8]; VA reads admin notes and risk flags on own profile [B-1]; CRM dashboard scopes AMs by candidate, not assignment [B-3].

## A6. Module map and API surface

Every route with method, full path, guard and validation is listed in Area A §7.1 (ATS + shared) and Area B §7 (CRM). Counts: ~120 routes. Key business flows (Area A §3, Area B §3):

- **Apply (public):** upload-and-parse (AI, nothing stored) → `POST /ats/jobs/:id/apply` → find-or-create candidate by email/phone (status `pending`, `appliedJobId`), Cloudinary upload, background parse/validation, optional confirmation email. **No Application document is created at apply time.**
- **Review → pipeline:** approve creates an Application (phase `approved`, first stage) and triggers AI scoring; reject (candidate-level) sends to Talent Pool or Permanently Ineligible via disposition reason; stage moves, move-to-talent-pool, change-job, assign-job; hire sets phase `hired`, candidate `hired`, provisions the VA user + VaProfile and sends an invite.
- **Interviews:** conflict detection, Zoom create/update/delete, emails to candidate and interviewers, assigned-interviewer-only feedback, 60-minute fixed duration, company timezone.
- **CRM:** assignment create provisions the client user and creates survey reminders (3-day, 1-week, 30-day, "monthly" = once at 60 days); VAs file work entries (soft delete) and one EOD per assignment per company day (unique `(assignmentId, dateKey)`, hard delete); crons send reminders; scorecards are generated only on manual POST; performance reviews are AI drafts edited and completed by staff, exportable as PDF.

## A7. How the two frontends use the API

- **ATS:** loads every collection at boot with `limit: 9999` (backend does not cap limits [A-42]), listens on `/ats` sockets (all rooms auto-joined). Contract mismatches: `pipelineId` vs `pipelineTemplateId` on job create (zod strips it) [A-53]; `POST /ats/emails/attachments` does not exist and `attachments` is not in the send schema; emails `search` ignored; email-template variables `candidatePhone`/`currentStage` rejected; client sends `resumeRawText` that the apply handler trusts [A-19]; frontend emits socket events the server ignores and expects `email:*`/`interview:deleted` events the server never emits. (Details in the ATS audit.)
- **CRM:** no sockets (every `/crm` emit is unused); list endpoints default to 20 rows and the CRM omits `limit` on three lists; error envelope read from the wrong path; scorecard "Sunday cron" promised in the UI does not exist [B-17]. (Details in the CRM audit.)
- **Cross-app:** one user can hold both apps; logout clears only the named app's refresh token when `app` is sent (ATS now sends `app:'ats'`). Invite links: hire-time VA invites go to the ATS `/ats/verify-email` link instead of the CRM `/accept-invitation` link used by manual provisioning [A-9].

## A8. Data model

Mongoose collections (fields and indexes in Area A §2 notes and Area B §8):

| Collection                                                        | Notes                                                                                                                                                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User                                                              | unique email, roles[], appAccess[], embedded permissions map, candidateRef, clientRef, refresh/reset/invite tokens (plaintext)                                                   |
| Candidate                                                         | unique email, phoneNormalized, status pending/approved/hired, inTalentPool, eligibilityStatus, legalHold, parsedData, resumeUrl/resumeRawText, aiScore, aiValidation, text index |
| Application                                                       | unique (candidateId, jobId), phase pending/approved/hired/rejected, currentStage, disposition fields, closedAt, aiScore, interviewIds[]                                          |
| Job                                                               | status machine draft→open→on_hold/closed, embedded pipeline stages copied from a template, clientId, tags                                                                        |
| PipelineTemplate                                                  | unique name, partial-unique default                                                                                                                                              |
| Client                                                            | embedded contacts (single primary), notes (admin-only), crmProfile; email not unique despite docs                                                                                |
| Interview                                                         | type, scheduledAt, timezone, interviewerIds, organizerId, meetingDetails (Zoom password), feedbacks[]                                                                            |
| InterviewScorecard                                                | 5 weighted categories → score /100, final recommendation                                                                                                                         |
| Email / EmailTemplate                                             | outbound + inbound (webhook), context refs; templates by type, one default per type                                                                                              |
| DispositionReason                                                 | 52 seeded reasons in 6 categories, defaultEligibility, applicable stages, notes required                                                                                         |
| Settings                                                          | singleton: sender name, AI provider and toggles, company timezone, application confirmation                                                                                      |
| Tag, ActivityLog                                                  | tag unique name; activity log with action, resource, related resource, performedBy                                                                                               |
| Assignment                                                        | candidateId, clientId, accountManagerId, status active/paused/ended, schedule                                                                                                    |
| WorkEntry                                                         | soft delete, minutes 1–480, category, status                                                                                                                                     |
| EodSubmission / EodReminder                                       | unique (assignmentId, dateKey), shift times, server-computed hours; reminders created by cron                                                                                    |
| SurveyReminder, Scorecard, VaProfile, PerformanceReview, CronLock | see Area B §8                                                                                                                                                                    |

No `populate()` is used; names are joined manually or not at all. Hard deletes leave dangling references in several places [A-49]. Redundant indexes on EOD and assignment collections [B-39].

## A9. External services, crons, sockets, ops

- **Resend:** all outbound mail and inbound replies (webhook with Svix signature; **skipped when `RESEND_WEBHOOK_SECRET` is unset** [A-5]). Emails interpolate user data without HTML escaping [A-20, B-31].
- **Cloudinary:** resumes/portfolios (raw), avatars/logos (image) under `ats/<folder>`.
- **AI:** Anthropic/OpenAI via `fetch`, 30 s abort, `withRetry` retries every error including 4xx [B-34]; resume text (PII, untrusted) embedded verbatim in prompts [B-35]; review generation runs synchronously inside the HTTP request (Heroku 30 s router limit, inferred).
- **Zoom:** server-to-server OAuth, meetings created with `waiting_room:false, join_before_host:true` [B-42]. Google Meet: manual links, util stubs only.
- **Sentry:** captures some errors twice and captures 4xx Mongoose errors; production logger replaces `console.*` with `args.join(' ')`, losing stacks [B-20].
- **Crons:** a per-minute ticker fires at company-time 17:00 and 09:00; the Mongo lock is released right after each run and the "once per day" guard is in memory, so a second instance can double-send [B-9].
- **Sockets:** auth checked once at connect (inside `connection`, not `io.use`); ATS users join every room; `join:job` accepts any string; `user:<id>` and `job:<id>` rooms never receive emits [B-30, A-13].
- **`dist/` is stale:** five modules missing (`assignmentScope`, `crmScope`, `optionalAuthenticate`, `interview.schemas`, `job.public`) and none of the ownership fixes are in it, while `Procfile`/`start` run `dist/app.js` [B-10].
- **Scripts:** `delete-stale-approved-candidates.ts --delete` would delete every quick-imported candidate and their VA login [B-12]; `seed-admin.ts` creates `admin@arista.com / Admin@123` [B-42]; `migrate-user-permissions` does a shallow merge that skips new grants [B-41].

## A10. File tree (line counts in parentheses)

```
backend/
├── dist/  (committed build output, 194 files — not expanded)
├── src/
│   ├── config/
│   │   ├── cloudinary.ts  (53)
│   │   ├── db.ts  (13)
│   │   └── env.ts  (57)
│   ├── features/
│   │   ├── activity-logs/
│   │   │   ├── activityLog.controller.ts  (50)
│   │   │   ├── activityLog.model.ts  (51)
│   │   │   ├── activityLog.routes.ts  (58)
│   │   │   ├── activityLog.service.ts  (114)
│   │   │   └── activityLog.types.ts  (127)
│   │   ├── applications/
│   │   │   ├── application.controller.ts  (124)
│   │   │   ├── application.model.ts  (195)
│   │   │   ├── application.routes.ts  (142)
│   │   │   ├── application.service.ts  (780)
│   │   │   └── application.types.ts  (108)
│   │   ├── assignments/
│   │   │   ├── assignment.controller.ts  (94)
│   │   │   ├── assignment.model.ts  (53)
│   │   │   ├── assignment.routes.ts  (69)
│   │   │   ├── assignment.service.ts  (363)
│   │   │   ├── assignment.types.ts  (37)
│   │   │   └── assignmentScope.ts  (90)
│   │   ├── auth/
│   │   │   ├── auth.controller.ts  (84)
│   │   │   ├── auth.routes.ts  (68)
│   │   │   ├── auth.service.ts  (367)
│   │   │   └── auth.types.ts  (18)
│   │   ├── candidates/
│   │   │   ├── candidate.controller.ts  (661)
│   │   │   ├── candidate.model.ts  (247)
│   │   │   ├── candidate.routes.ts  (331)
│   │   │   ├── candidate.service.ts  (1213)
│   │   │   └── candidate.types.ts  (154)
│   │   ├── client-accounts/
│   │   │   ├── clientAccount.controller.ts  (67)
│   │   │   ├── clientAccount.routes.ts  (64)
│   │   │   ├── clientAccount.service.ts  (243)
│   │   │   └── clientAccount.types.ts  (42)
│   │   ├── clients/
│   │   │   ├── client.controller.ts  (168)
│   │   │   ├── client.model.ts  (245)
│   │   │   ├── client.routes.ts  (180)
│   │   │   ├── client.service.ts  (677)
│   │   │   └── client.types.ts  (123)
│   │   ├── dashboard/
│   │   │   ├── ats/
│   │   │   │   ├── atsDashboard.controller.ts  (8)
│   │   │   │   ├── atsDashboard.routes.ts  (16)
│   │   │   │   └── atsDashboard.service.ts  (117)
│   │   │   └── crm/
│   │   │       ├── crmDashboard.controller.ts  (15)
│   │   │       ├── crmDashboard.routes.ts  (16)
│   │   │       └── crmDashboard.service.ts  (246)
│   │   ├── disposition-reasons/
│   │   │   ├── dispositionReason.controller.ts  (77)
│   │   │   ├── dispositionReason.model.ts  (60)
│   │   │   ├── dispositionReason.routes.ts  (114)
│   │   │   ├── dispositionReason.service.ts  (235)
│   │   │   └── dispositionReason.types.ts  (45)
│   │   ├── email-templates/
│   │   │   ├── emailTemplate.controller.ts  (53)
│   │   │   ├── emailTemplate.model.ts  (59)
│   │   │   ├── emailTemplate.routes.ts  (87)
│   │   │   ├── emailTemplate.service.ts  (168)
│   │   │   └── emailTemplate.types.ts  (62)
│   │   ├── emails/
│   │   │   ├── email.controller.ts  (87)
│   │   │   ├── email.model.ts  (136)
│   │   │   ├── email.routes.ts  (69)
│   │   │   ├── email.service.ts  (163)
│   │   │   └── email.types.ts  (63)
│   │   ├── eod-reminders/
│   │   │   ├── eodReminder.controller.ts  (35)
│   │   │   ├── eodReminder.model.ts  (43)
│   │   │   ├── eodReminder.routes.ts  (26)
│   │   │   ├── eodReminder.service.ts  (71)
│   │   │   └── eodReminder.types.ts  (18)
│   │   ├── eod-submissions/
│   │   │   ├── eodSubmission.controller.ts  (98)
│   │   │   ├── eodSubmission.model.ts  (124)
│   │   │   ├── eodSubmission.routes.ts  (110)
│   │   │   ├── eodSubmission.service.ts  (376)
│   │   │   └── eodSubmission.types.ts  (85)
│   │   ├── interview-scorecards/
│   │   │   ├── interview-scorecard.controller.ts  (75)
│   │   │   ├── interview-scorecard.model.ts  (125)
│   │   │   ├── interview-scorecard.routes.ts  (138)
│   │   │   ├── interview-scorecard.service.ts  (321)
│   │   │   └── interview-scorecard.types.ts  (146)
│   │   ├── interviews/
│   │   │   ├── interview.controller.ts  (160)
│   │   │   ├── interview.model.ts  (152)
│   │   │   ├── interview.routes.ts  (58)
│   │   │   ├── interview.schemas.ts  (90)
│   │   │   ├── interview.service.ts  (672)
│   │   │   ├── interview.types.ts  (100)
│   │   │   └── interviewEmail.service.ts  (670)
│   │   ├── jobs/
│   │   │   ├── job.controller.ts  (319)
│   │   │   ├── job.model.ts  (138)
│   │   │   ├── job.public.ts  (26)
│   │   │   ├── job.routes.ts  (267)
│   │   │   ├── job.service.ts  (384)
│   │   │   ├── job.types.ts  (92)
│   │   │   ├── jobDraft.service.ts  (215)
│   │   │   └── jobStandardize.service.ts  (192)
│   │   ├── performance-reviews/
│   │   │   ├── performanceReview.controller.ts  (176)
│   │   │   ├── performanceReview.model.ts  (147)
│   │   │   ├── performanceReview.routes.ts  (132)
│   │   │   ├── performanceReview.service.ts  (566)
│   │   │   └── performanceReview.types.ts  (89)
│   │   ├── pipeline-templates/
│   │   │   ├── pipelineTemplate.controller.ts  (56)
│   │   │   ├── pipelineTemplate.model.ts  (69)
│   │   │   ├── pipelineTemplate.routes.ts  (85)
│   │   │   ├── pipelineTemplate.service.ts  (263)
│   │   │   └── pipelineTemplate.types.ts  (105)
│   │   ├── reports/
│   │   │   ├── reports.controller.ts  (131)
│   │   │   ├── reports.routes.ts  (53)
│   │   │   └── reports.service.ts  (433)
│   │   ├── scorecards/
│   │   │   ├── scorecard.controller.ts  (52)
│   │   │   ├── scorecard.model.ts  (49)
│   │   │   ├── scorecard.routes.ts  (32)
│   │   │   ├── scorecard.service.ts  (253)
│   │   │   └── scorecard.types.ts  (17)
│   │   ├── settings/
│   │   │   ├── settings.controller.ts  (17)
│   │   │   ├── settings.model.ts  (87)
│   │   │   ├── settings.routes.ts  (62)
│   │   │   ├── settings.service.ts  (128)
│   │   │   └── settings.types.ts  (38)
│   │   ├── survey-reminders/
│   │   │   ├── surveyReminder.controller.ts  (62)
│   │   │   ├── surveyReminder.model.ts  (45)
│   │   │   ├── surveyReminder.routes.ts  (64)
│   │   │   ├── surveyReminder.service.ts  (161)
│   │   │   └── surveyReminder.types.ts  (27)
│   │   ├── tags/
│   │   │   ├── tag.controller.ts  (26)
│   │   │   ├── tag.model.ts  (26)
│   │   │   ├── tag.routes.ts  (47)
│   │   │   ├── tag.service.ts  (101)
│   │   │   └── tag.types.ts  (18)
│   │   ├── users/
│   │   │   ├── user.controller.ts  (409)
│   │   │   ├── user.model.ts  (127)
│   │   │   ├── user.routes.ts  (136)
│   │   │   ├── user.service.ts  (707)
│   │   │   └── user.types.ts  (88)
│   │   ├── va-profiles/
│   │   │   ├── vaProfile.controller.ts  (57)
│   │   │   ├── vaProfile.model.ts  (65)
│   │   │   ├── vaProfile.routes.ts  (60)
│   │   │   ├── vaProfile.service.ts  (215)
│   │   │   └── vaProfile.types.ts  (36)
│   │   ├── webhooks/
│   │   │   ├── webhook.controller.ts  (76)
│   │   │   ├── webhook.routes.ts  (27)
│   │   │   ├── webhook.service.ts  (423)
│   │   │   └── webhook.types.ts  (70)
│   │   └── work-entries/
│   │       ├── workEntry.controller.ts  (88)
│   │       ├── workEntry.model.ts  (61)
│   │       ├── workEntry.routes.ts  (61)
│   │       ├── workEntry.service.ts  (241)
│   │       └── workEntry.types.ts  (36)
│   ├── jobs/
│   │   ├── aiCandidacyValidation.job.ts  (124)
│   │   ├── aiCandidateScoring.job.ts  (149)
│   │   ├── aiResumeParsing.job.ts  (81)
│   │   ├── aiResumeValidation.job.ts  (101)
│   │   ├── companyScheduler.ts  (76)
│   │   ├── cronLock.ts  (72)
│   │   ├── eodCompliance.job.ts  (101)
│   │   ├── index.ts  (14)
│   │   └── surveyDispatcher.job.ts  (93)
│   ├── scripts/
│   │   ├── align-email-sender.ts  (73)
│   │   ├── backfill-activity-performers.ts  (180)
│   │   ├── cleanup-activity-indexes.ts  (165)
│   │   ├── dedupe-activity-logs.ts  (270)
│   │   ├── delete-stale-approved-candidates.ts  (213)
│   │   ├── find-approved-without-application.ts  (65)
│   │   ├── find-orphan-resumes.ts  (155)
│   │   ├── migrate-activity-action.ts  (298)
│   │   ├── migrate-activity-timestamps.ts  (214)
│   │   ├── migrate-company-timezone.ts  (74)
│   │   ├── migrate-disposition.ts  (109)
│   │   ├── migrate-eod-time.ts  (146)
│   │   ├── migrate-user-permissions.ts  (54)
│   │   ├── seed-admin.ts  (56)
│   │   ├── seed-demo.ts  (200)
│   │   ├── seed-disposition-reasons.ts  (377)
│   │   └── seed-email-templates.ts  (35)
│   ├── shared/
│   │   ├── middleware/
│   │   │   ├── authenticate.ts  (42)
│   │   │   ├── authorize.ts  (90)
│   │   │   ├── errorHandler.ts  (49)
│   │   │   ├── optionalAuthenticate.ts  (25)
│   │   │   └── upload.ts  (218)
│   │   ├── types/
│   │   │   └── express.d.ts  (37)
│   │   ├── utils/
│   │   │   ├── ai/
│   │   │   │   ├── claude.provider.ts  (80)
│   │   │   │   ├── index.ts  (75)
│   │   │   │   ├── openai.provider.ts  (72)
│   │   │   │   ├── parse-json.ts  (24)
│   │   │   │   └── types.ts  (24)
│   │   │   ├── AppError.ts  (23)
│   │   │   ├── catchAsync.ts  (15)
│   │   │   ├── coalesce.ts  (68)
│   │   │   ├── companyDay.ts  (127)
│   │   │   ├── companyTimezone.ts  (50)
│   │   │   ├── crmScope.ts  (66)
│   │   │   ├── email.ts  (59)
│   │   │   ├── emailSender.ts  (65)
│   │   │   ├── emailSenderDefaults.ts  (13)
│   │   │   ├── extract-resume-text.ts  (67)
│   │   │   ├── googleMeet.ts  (50)
│   │   │   ├── logger.ts  (82)
│   │   │   ├── parseResumeWithAI.ts  (232)
│   │   │   ├── pdf.ts  (370)
│   │   │   ├── response.ts  (40)
│   │   │   ├── sanitize-job-description.ts  (45)
│   │   │   ├── timezone.ts  (262)
│   │   │   └── zoom.ts  (169)
│   │   └── validators/
│   │       └── common.validator.ts  (49)
│   ├── sockets/
│   │   ├── ats.socket.ts  (56)
│   │   ├── crm.socket.ts  (46)
│   │   └── index.ts  (35)
│   └── app.ts  (189)
├── ATS-CRM-BACKEND-AUDIT.md  (170)
├── ENDPOINTS.md  (365)
├── package.json  (81)
├── pnpm-lock.yaml  [129 KB]
├── Procfile  [0 KB]
├── README.md  (42)
└── tsconfig.json  (16)
```

## A11. Consolidated issue list (ranked)

Totals in Part B: Area A 75 · Area B 46 = **121 findings**. Merged and ranked:

### Critical / High — security

1. **Anonymous apply overwrites a pending applicant's resume, parsed data and portfolio** (matched by email or phone) and deletes their previous files. [A-2]
2. **Apply trusts client-supplied `resumeRawText`** over the uploaded file; that text drives AI validation and scoring (prompt-injection vector). [A-19, B-35]
3. **Admin-only client notes leak** through `GET /ats/clients`, `GET /ats/clients/:id` and every `client:*` socket emit. [A-1]
4. **Self-escalation:** a non-admin holding team permissions can change their own roles and permission map. [A-3]
5. **Provisioning resurrects accounts:** `provisionVA/Client` reactivate any matching user (incl. deactivated staff) with old roles; the invite then sets a new password. [A-4]
6. **VA can read admin notes and risk flags** about themselves via `GET /crm/va-profiles/:id`. [B-1]
7. **AM scoping gaps:** survey reminders, client accounts, VA profiles, company-wide scorecard generation, and the `/crm` socket room (full EOD/review payloads to every AM); dashboard scoped by candidate so AMs see each other's data for shared VAs. [B-8, B-3]
8. **Sockets push full documents to every ATS user** regardless of permission (banned candidates, salaries, resume text, client notes, Zoom passwords); tokens never re-checked. [A-13, B-30]
9. **Webhook signature check fails open** when the secret is unset; `/api/webhooks/resend/test` is public outside production. [A-5]
10. **Any valid token unlocks the full job view** on public job routes (CRM users, interviewers). [A-6]
11. **Stateless auth:** deactivation, deletion, role and permission changes do not apply until the access token expires. [A-14]
12. **Invite token returned in `POST /shared/users` response.** [A-7]

### High — correctness and data integrity

13. **AM dashboard aggregates always empty** (string ids in `$match`, no ObjectId cast). [B-2]
14. **Regenerate-section prompts have no context** and wipe ratings; AI output not validated (TypeError → 500 after a paid call). [B-4, B-5]
15. **Unhandled promise rejections can crash the process** (survey reminders created without await/catch; background AI jobs fired without catch; no global handler). [B-6, A-75]
16. **No ObjectId validation or pagination caps anywhere in CRM lists** and most ATS lists; `objectIdSchema`/`paginationSchema` exist but are unused; query operator injection via qs. [B-7, A-25, A-42, A-43]
17. **Cron lock does not prevent double runs** across instances. [B-9]
18. **Stale committed `dist/`** without the access-control fixes, used by `start`/`Procfile`. [B-10]
19. **EOD integrity:** VA can backdate/pre-date, edit any time and hard-delete EODs; PATCH can empty an EOD and override hours. [B-11, B-13, B-14]
20. **Dangerous cleanup script** targets every quick-imported candidate and deletes VA logins. [B-12]
21. `PATCH /candidates/:id/eligibility` 500s on free-text `reason` and skips ban side-effects. [A-8]
22. Hire-time VA invite links to the ATS instead of the CRM. [A-9]
23. Multi-document workflows without transactions (hire, change job, approve, delete cascade, pipeline swap, assignment create). [A-10, B-27]
24. User "deactivate" is a hard delete that orphans references; no last-admin protection. [A-24]

### Medium (selected)

- `assign-job` silently reopens genuine rejections (`closedAt` heuristic). [A-11]
- Out-of-order Resend events regress email status; inbound attachment URLs expire. [A-37, A-38]
- Interview: type changes don't create/delete Zoom meetings; completed interviews can be cancelled (candidate emailed); flat create trusts all ids. [A-26, A-27, A-29]
- Apply ignores `applicationDeadline`; existing approved/hired candidates applying to another job are silently dropped. [A-31, A-32]
- Any `emails.write` holder can send arbitrary HTML to any address from the company domain. [A-35]
- Server-local vs company timezone mixed in dashboard, work entries, scorecards and reports. [B-16]
- Scorecard math divides by 7 days; no cron; reports N+1 with full documents; dispositions export ignores job/client filters. [B-17, B-19, B-29]
- Survey reminders still sent for ended assignments; "monthly" fires once. [B-25]
- Error masking to 404 in client-accounts, scorecards, VA profiles; GET with side effects on VA profiles. [B-23, B-24]
- Optional integrations required at startup; env not validated. [B-32]
- Rate limits too low for SPAs, include refresh and webhooks; production only. [A-18, B-21]
- Dashboard N+1 (5 queries per open job); candidate list returns full `resumeRawText`. [A-40, A-41]

### Low

Sorting missing on lists, `$text` search whole-word only, plaintext reset/invite tokens, duplicated enums and helpers, dead code (unused validators, Google Meet stubs, `updateAssignmentStatus`, `callClaude`), redundant indexes, logging PII at info level, docs drift in README/ENDPOINTS.md/prior audit, CORS exact-match fragility, seed scripts with known credentials. [A-44..75, B-36..46]

### Ambiguities that need an owner decision

- Re-apply rule: should a pending applicant's materials be overwritten, and what happens when an approved/hired candidate applies to another job? [A-2, A-31]
- Should hiring close the candidate's other live applications? Moves to talent pool are stored as phase `rejected`, which inflates rejection counts. [A-67]
- Do account managers see only their own assignments everywhere? [B-8]
- EOD rules: which dates may a VA file, how long can they edit, may they delete? Working days for compliance and scorecards? [B-11, B-17, B-46]
- Should VAs see draft reviews; should clients see reviews? [B-18]
- Which email template types are actually used server-side (interview/offer/rejection/follow_up are never consumed)? [A-71]

## A12. Status of the 8–9 Oct 2026 security audits (checked against `src`)

| Finding                                                          | Status in `src` now                                                                                                    | Evidence                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| C1a apply trusts `candidateId` / `resumeUrl`                     | **Fixed** (always find-or-create; comment at `jobs/job.controller.ts:172`)                                             | resume text still trusted [A-19]         |
| C1b re-apply overwrites materials                                | **Open** (narrowed to pending candidates)                                                                              | [A-2]                                    |
| C2 VA ownership on work entries / EODs                           | **Fixed** (`assertOwnsRecord`/`assertOwnsCandidate`, `workEntry.service.ts:136-226`)                                   | EOD date/delete rules still loose [B-11] |
| C3 assignment / client-account IDOR                              | **Mostly fixed** (`assertOwnsRecord`, AM scoping in `assignment.controller.ts:24`)                                     | AM gaps remain elsewhere [B-8]           |
| C4 sockets                                                       | **CRM room fixed** (staff only, `crm.socket.ts:37-39`); ATS still all rooms                                            | [A-13, B-30]                             |
| C5 deactivate = hard delete                                      | **Open** (`user.service.ts:476`)                                                                                       | [A-24]                                   |
| C6 webhook fail-open / test route                                | **Open** (config-dependent; prod has the secret)                                                                       | [A-5]                                    |
| H1 deactivated users keep access                                 | **Partly fixed** (login and refresh check `isActive`); access token still trusted                                      | [A-14]                                   |
| H2 reset reactivates accounts                                    | **Partly fixed** (reset only reactivates via invite, `auth.service.ts:275`); `set-password` still sets active (`:356`) | [A-64]                                   |
| H3 privilege escalation                                          | **Partly fixed** (admin targets protected); self-escalation open                                                       | [A-3]                                    |
| H4 / H4b public jobs exposure, operator injection                | **Fixed** (`toPublicJob`, string coercion, `optionalAuthenticate`)                                                     | token-holder full view [A-6]             |
| H5 `javascript:` URLs                                            | **Fixed** for candidate URLs (`httpUrlSchema`); interview meeting link still `z.string().url()`                        | [A-21]                                   |
| H6 public AI endpoints                                           | **Open**                                                                                                               | [A-18]                                   |
| H7 ATS logout kills CRM session                                  | **Fixed** (ATS sends `app:'ats'`)                                                                                      | —                                        |
| H8 forgot-password goes to ATS                                   | **Open**                                                                                                               | [A-16]                                   |
| H9 provisioning takes over accounts                              | **Open**                                                                                                               | [A-4]                                    |
| M CSV formula injection                                          | **Fixed** (`reports.service.ts:57-60`)                                                                                 | —                                        |
| M tag regex injection                                            | **Fixed** (`escapeRegex`, `tag.service.ts:20`)                                                                         | —                                        |
| M HTML injection in emails                                       | **Open**                                                                                                               | [A-20, B-31]                             |
| M rate limits / pagination / error handler leaks / startup order | **Open**                                                                                                               | [A-18, A-42, A-55, A-56]                 |
| No tests                                                         | **Open**                                                                                                               | —                                        |

---

# Part B — Detailed audit by area

## Area A — ATS-side and shared modules, middleware

Auditor scope: activity-logs, applications, auth, candidates, clients, dashboard/ats, disposition-reasons, email-templates, emails, interview-scorecards, interviews (incl. interviewEmail.service.ts), jobs (incl. jobDraft, jobStandardize, job.public), pipeline-templates, settings, tags, users, webhooks; plus backend/src/app.ts, backend/src/shared/middleware/\*, cross-checked against backend/ENDPOINTS.md.
All paths are relative to `backend/src/` unless they start with `backend/`. "feature-relative" `:NN` references in section 2 refer to the file named in that bullet.

---

### 1. Scope covered (every file read completely)

| File                                                            | Lines |
| --------------------------------------------------------------- | ----- |
| backend/src/app.ts                                              | 189   |
| backend/ENDPOINTS.md                                            | 365   |
| shared/middleware/authenticate.ts                               | 42    |
| shared/middleware/authorize.ts                                  | 90    |
| shared/middleware/errorHandler.ts                               | 49    |
| shared/middleware/optionalAuthenticate.ts                       | 25    |
| shared/middleware/upload.ts                                     | 218   |
| features/activity-logs/activityLog.controller.ts                | 50    |
| features/activity-logs/activityLog.model.ts                     | 51    |
| features/activity-logs/activityLog.routes.ts                    | 58    |
| features/activity-logs/activityLog.types.ts                     | 127   |
| features/activity-logs/activityLog.service.ts                   | 114   |
| features/applications/application.controller.ts                 | 124   |
| features/applications/application.routes.ts                     | 142   |
| features/applications/application.model.ts                      | 195   |
| features/applications/application.service.ts                    | 780   |
| features/applications/application.types.ts                      | 108   |
| features/auth/auth.routes.ts                                    | 68    |
| features/auth/auth.types.ts                                     | 18    |
| features/auth/auth.service.ts                                   | 367   |
| features/auth/auth.controller.ts                                | 84    |
| features/candidates/candidate.types.ts                          | 154   |
| features/candidates/candidate.controller.ts                     | 661   |
| features/candidates/candidate.model.ts                          | 247   |
| features/candidates/candidate.routes.ts                         | 331   |
| features/candidates/candidate.service.ts                        | 1213  |
| features/clients/client.routes.ts                               | 180   |
| features/clients/client.types.ts                                | 123   |
| features/clients/client.model.ts                                | 245   |
| features/clients/client.controller.ts                           | 168   |
| features/clients/client.service.ts                              | 677   |
| features/dashboard/ats/atsDashboard.routes.ts                   | 16    |
| features/dashboard/ats/atsDashboard.controller.ts               | 8     |
| features/dashboard/ats/atsDashboard.service.ts                  | 117   |
| features/disposition-reasons/dispositionReason.model.ts         | 60    |
| features/disposition-reasons/dispositionReason.types.ts         | 45    |
| features/disposition-reasons/dispositionReason.controller.ts    | 77    |
| features/disposition-reasons/dispositionReason.service.ts       | 235   |
| features/disposition-reasons/dispositionReason.routes.ts        | 114   |
| features/email-templates/emailTemplate.types.ts                 | 62    |
| features/email-templates/emailTemplate.model.ts                 | 59    |
| features/email-templates/emailTemplate.controller.ts            | 53    |
| features/email-templates/emailTemplate.service.ts               | 168   |
| features/email-templates/emailTemplate.routes.ts                | 87    |
| features/emails/email.service.ts                                | 163   |
| features/emails/email.types.ts                                  | 63    |
| features/emails/email.routes.ts                                 | 69    |
| features/emails/email.model.ts                                  | 136   |
| features/emails/email.controller.ts                             | 87    |
| features/interview-scorecards/interview-scorecard.controller.ts | 75    |
| features/interview-scorecards/interview-scorecard.routes.ts     | 138   |
| features/interview-scorecards/interview-scorecard.types.ts      | 146   |
| features/interview-scorecards/interview-scorecard.service.ts    | 321   |
| features/interview-scorecards/interview-scorecard.model.ts      | 125   |
| features/interviews/interview.routes.ts                         | 58    |
| features/interviews/interview.model.ts                          | 152   |
| features/interviews/interviewEmail.service.ts                   | 670   |
| features/interviews/interview.types.ts                          | 100   |
| features/interviews/interview.service.ts                        | 672   |
| features/interviews/interview.controller.ts                     | 160   |
| features/interviews/interview.schemas.ts                        | 90    |
| features/jobs/job.service.ts                                    | 384   |
| features/jobs/job.model.ts                                      | 138   |
| features/jobs/jobDraft.service.ts                               | 215   |
| features/jobs/job.controller.ts                                 | 319   |
| features/jobs/job.public.ts                                     | 26    |
| features/jobs/jobStandardize.service.ts                         | 192   |
| features/jobs/job.routes.ts                                     | 267   |
| features/jobs/job.types.ts                                      | 92    |
| features/pipeline-templates/pipelineTemplate.model.ts           | 69    |
| features/pipeline-templates/pipelineTemplate.types.ts           | 105   |
| features/pipeline-templates/pipelineTemplate.routes.ts          | 85    |
| features/pipeline-templates/pipelineTemplate.controller.ts      | 56    |
| features/pipeline-templates/pipelineTemplate.service.ts         | 263   |
| features/settings/settings.controller.ts                        | 17    |
| features/settings/settings.routes.ts                            | 62    |
| features/settings/settings.model.ts                             | 87    |
| features/settings/settings.service.ts                           | 128   |
| features/settings/settings.types.ts                             | 38    |
| features/tags/tag.types.ts                                      | 18    |
| features/tags/tag.model.ts                                      | 26    |
| features/tags/tag.controller.ts                                 | 26    |
| features/tags/tag.routes.ts                                     | 47    |
| features/tags/tag.service.ts                                    | 101   |
| features/users/user.controller.ts                               | 409   |
| features/users/user.model.ts                                    | 127   |
| features/users/user.routes.ts                                   | 136   |
| features/users/user.types.ts                                    | 88    |
| features/users/user.service.ts                                  | 707   |
| features/webhooks/webhook.routes.ts                             | 27    |
| features/webhooks/webhook.service.ts                            | 423   |
| features/webhooks/webhook.types.ts                              | 70    |
| features/webhooks/webhook.controller.ts                         | 76    |

Supporting files read (outside scope, for connections only): shared/validators/common.validator.ts (49), shared/utils/response.ts (40), shared/utils/email.ts (59), sockets/ats.socket.ts (grep of room joins :27-45), sockets/index.ts (emit helpers :21-34), jobs/index.ts exports, jobs/aiResumeParsing.job.ts:10-40, jobs/aiCandidateScoring.job.ts:20-45, shared/utils/zoom.ts / googleMeet.ts / companyTimezone.ts (export/throw lines), shared/utils/emailSenderDefaults.ts:8-13, config/env.ts (COMPANY_EMAIL, RESEND_WEBHOOK_SECRET lines), package.json dependency lines.

---

### 2. Per-folder / per-file summary

The detailed per-file notes (routes, guards, validation, controller → service logic, models, side effects) are kept in reading order in the "Detailed per-file notes" block at the end of this document (section 2 continued). Short orientation:

- **app.ts** — Sentry init, helmet, CORS (ATS+CRM origins), JSON with raw-body capture for Resend, request logging, production-only rate limits, mounts 26 routers, 404, Sentry error handler, errorHandler, DB connect + email-template seed, background jobs, Socket.IO.
- **shared/middleware** — `authenticate` (stateless JWT → req.user), `authorize` (requireRoles / requirePermission / hasPermission / requireAppAccess, admin bypass), `errorHandler` (AppError, Mongoose Validation/Cast/11000, JWT), `optionalAuthenticate`, `upload` (multer memory: resume, resume+portfolio, avatar, logo, user avatar).
- **activity-logs** — audit trail model + fire-and-forget `createLog`, global feed and per-record feed.
- **applications** — candidate↔job link; phases pending/approved/hired/rejected; stage moves; reject with disposition; hire (provisions VA user); move-to-talent-pool; nested interview routes.
- **auth** — login/logout/refresh (per-app refresh cookies), forgot/reset/change password, invite verify/set-password.
- **candidates** — public resume parse endpoints, CRUD, talent pool, approve/reject/assign/change job, eligibility (ban), restore, legal hold, delete cascade.
- **clients** — CRUD, logo, contacts, CRM profile, admin-only notes.
- **dashboard/ats** — counts, recent apps, upcoming interviews, per-job stats.
- **disposition-reasons** — rejection reason catalogue (category, applicable stages, ban default, notes required).
- **email-templates** — template CRUD, one default per type.
- **emails** — outbound email log/send/resend/threads; inbound stored by webhook.
- **interview-scorecards** — weighted 5-category screening scorecard.
- **interviews** — scheduling with conflict detection, Zoom integration, emails to candidate+interviewers, feedback.
- **jobs** — public careers listing + apply, CRUD, status machine, pipeline (template copy + remap), AI draft and AI standardize.
- **pipeline-templates** — stage templates, single default (partial unique index).
- **settings** — singleton: sender name, AI provider/toggles, timezone, application confirmation.
- **tags** — simple tag CRUD.
- **users** — team management, role → permission matrix, invites, CRM provisioning (VA/client), revoke CRM.
- **webhooks** — Resend events (status tracking, inbound email ingest).

---

### 3. Features & user flows (backend side)

#### 3.1 Sign-in and session

1. `POST /api/v1/auth/login {email,password,app}` → auth.service.ts:28-96: user lookup, inactive check, bcrypt compare, sign access JWT (claims: roles, appAccess, permissions, candidateRef, clientRef) + refresh JWT; refresh stored on user (`refreshTokenAts|Crm`), cookie `refreshTokenAts|Crm` set (auth.controller.ts:13-20); activity `login`/`login_failed`.
2. SPA calls APIs with `Authorization: Bearer` → `authenticate` decodes claims (no DB hit).
3. On 401 `AUTH_TOKEN_EXPIRED`, SPA calls `POST /auth/refresh-token?app=` → cookie compared to stored token, new access token with fresh roles (auth.service.ts:114-162).
4. Logout clears stored token(s) and cookie(s).
5. Forgot → reset: emailed 1h token to ATS `/ats/reset-password?token=`; reset accepts reset or invite token.
6. Invite: team member created (`POST /shared/users`) → 24h invite token → email to `${ATS}/ats/verify-email/:token` (ATS roles) or `${CRM}/accept-invitation?token=` (CRM-only) → `POST /auth/verify-email` then `POST /auth/set-password` (activates).

#### 3.2 Public careers + apply (anonymous)

1. `GET /ats/jobs` (anonymous → only open jobs, public fields via toPublicJob) and `GET /ats/jobs/:id` (draft → 404).
2. Applicant uploads resume → `POST /ats/candidates/public/upload-and-parse` (validate personal fields, extract text, AI parse, return `{resumeOriginalName, resumeRawText, parsedData}`; nothing stored).
3. Applicant submits → `POST /ats/jobs/:id/apply` multipart (job must be open) → findExistingApplicant by email/phone → if new or still refreshable: Cloudinary upload resume (+portfolio) → findOrCreateCandidate (status `pending`, `appliedJobId`) → banned → `{blocked:true}` → else background AI parse (if no parsedData), set appliedJobId, AI candidacy validation, optional confirmation email from template. **No Application is created.** Socket `candidate:created`.

#### 3.3 Recruiter review ("In Review" tab)

1. List `GET /ats/candidates?status=pending` (banned excluded by default).
2. Approve: `POST /ats/candidates/:id/approve {jobId?}` → createApplication(source direct_apply) → candidate status `approved` → approveApplication puts it in first stage (if job has pipeline) → AI scoring. Emits application:created/updated/phaseChanged, candidate:updated/statusChanged.
3. Reject: `PATCH /ats/candidates/:id/reject {rejectionReasonId, destination?, internalNotes?}` → refused if live application (409) → ban (`permanently_ineligible`) or talent pool.
4. Quick import (internal): `POST /ats/candidates` multipart → status `approved`, no application.

#### 3.4 Pipeline (job board)

1. `GET /ats/applications?jobId=` → board; `PATCH /applications/:id/stage {stageId}` → stage_changed log + emit.
2. Reject from pipeline: `PATCH /applications/:id/reject` → if last live application and a reason given → disposition (pool or ban) + closedAt/disposition fields; otherwise plain removal from this job.
3. Move to talent pool: `PATCH /applications/:id/move-to-talent-pool` → application phase `rejected` (logged `job_changed`, movedToTalentPool) + candidate pooled.
4. Change job: `POST /ats/candidates/:id/change-job` → validate target (open + pipeline) → new application (assigned, first stage or startStageId) → old closed as move → compensating delete on failure → appliedJobId updated → un-pool.
5. Assign from talent pool: `POST /ats/candidates/:id/assign-job` → createApplication(assigned) (re-opens an earlier "move" application) → optional stage → scoring → un-pool.
6. Hire: `PATCH /applications/:id/hire` → phase hired → candidate status hired → provisionVA (User role va, crm access, VaProfile upsert) → invite email.

#### 3.5 Interviews

1. Schedule: `POST /ats/applications/:applicationId/interviews` (or flat `POST /ats/interviews`) → interviewer default = organiser → conflict check (409 INTERVIEW_CONFLICT) → Zoom meeting created for type zoom, manual link for google_meet, phone/address otherwise → Interview saved (company timezone, 60 min) → activity under application → `$push` Application.interviewIds → emails to candidate + interviewers → socket `interview:created`.
2. Update/reschedule → conflict check → Zoom update → emails with change list.
3. Complete/no-show via PATCH status; cancel via DELETE (Zoom delete + emails).
4. Feedback: assigned interviewer once (`POST .../feedback`).
5. Scorecard: `POST /ats/interview-scorecards` (server computes weighted score), `GET ?candidateId=`.

#### 3.6 Jobs management

Create (draft, default template stages copied) → AI helpers `generate-draft` / `standardize` populate the form → `PATCH /:id/status` draft→open→on_hold/closed → `PATCH /:id/pipeline` swap template with stage remap → delete when no live applications.

#### 3.7 Clients

CRUD, logo upload (Cloudinary `logos`), contacts with single primary, CRM profile, admin notes; delete blocked while open/on_hold jobs.

#### 3.8 Settings / catalogue admin

Disposition reasons, pipeline templates, email templates, tags, settings singleton (sender name, AI provider/toggles, timezone, application confirmation).

#### 3.9 Team management (shared)

List/create/update/delete users, permission overrides, provision client/VA, revoke CRM; `GET /crm-accounts` for AM-scoped lists.

#### 3.10 Email inbox

Send (`POST /ats/emails`), list/thread/read/delete/resend; Resend webhook updates delivery status and stores inbound replies matched to candidates.

---

### 4. UI/UX observations (as visible from the API)

- Response envelope consistent (`sendSuccess`/`sendError`), except webhook invalid-signature returns `success:true` with HTTP 401 (webhooks/webhook.controller.ts:22) and dashboard returns raw `.lean()` docs whose shape differs from all `toSafeObject` payloads (dashboard/ats/atsDashboard.service.ts:51-63).
- Error messages are user-friendly and specific (e.g. INTERVIEW_CONFLICT with names/time interview.service.ts:206-210; DISPOSITION_REASON_IN_USE dispositionReason.service.ts:215-221).
- Pagination inconsistent: most lists accept unvalidated `Number(page/limit)` with no cap; users normalise (users/user.controller.ts:61-69); jobs/scorecards validate via zod; templates/tags/reasons/settings unpaginated.
- Several lists have no sort (jobs, clients, users) → rows jump between pages.
- Candidate search uses Mongo `$text` (whole-word only) so typing a partial name returns nothing (candidates/candidate.service.ts:85-86; same for jobs title job.service.ts:42, clients client.service.ts:34).
- Real-time: most writes emit Socket.IO events (application:_, candidate:_, job:_, client:_, tag:_, interview:_, pipeline*template:*, email*template:*), but not emails (sent or inbound), interview scorecards, users, settings, disposition reasons, or remapped applications after pipeline swap.
- Hard-coded HTML emails (interview, invite, reset) use emoji headings and inline styles; reset email hard-codes "Arista ATS" while others use env.COMPANY_NAME (inconsistent branding). Interview emails footer says "Please do not reply" while replies are ingested.
- Timeline noise/ambiguity: scorecards logged as generic `created` on candidate; `crm_profile_updated` / `settings_updated` logged even with no change.

### 5. Styles

Not applicable to backend code; the only presentational code is inline-styled email HTML in interviews/interviewEmail.service.ts:119-151, auth/auth.service.ts:177-238, users/user.service.ts:254-316 (three different visual designs: slate #1e293b header vs #1a1a2e header with #4361ee button vs #71abbf button) → inconsistent email styling.

### 6. Roles & permissions

- Guards: `requireAppAccess('ats')` on every ATS router (+ activity logs). Users and settings routers have only `authenticate` (users/user.routes.ts:84, settings/settings.routes.ts:52). Public: auth (most), `GET /ats/jobs`, `GET /ats/jobs/:id`, `POST /ats/jobs/:id/apply`, `POST /ats/candidates/public/*`, webhooks.
- Permission hierarchy (shared/middleware/authorize.ts:39-62): admin all; `manage` ⇒ write ⇒ read; `schedule` ⇒ write ⇒ read.
- Role matrix (users/user.service.ts:36-154): see section 2 notes. Highlights: recruiter has candidates.manage but jobs read-only; interviewer has no jobs.read and no clients.read; account_manager has activityLogs.read/clients.write but no ATS access (so blocked from activity logs and /ats/clients); `team`, `settings.write`, `pipelineTemplates.write`, `emailTemplates.write`, `tags.manage`, `clients.manage`, `dashboard` beyond read are admin-only by default.
- Role checks outside the permission system: `requireRoles('admin')` for candidate eligibility/restore/legal-hold (candidates/candidate.routes.ts:286-309) and client notes (clients/client.routes.ts:158-178); in-handler admin checks: banned candidate read/list (candidate.controller.ts:48-57, 93-102), delete candidate (candidate.service.ts:607-613), admin role grant/target protection (users/user.controller.ts:22-46).
- Ownership checks: interview feedback (assigned interviewer only, interview.service.ts:625-633). Missing: interview scorecards (any writer edits any), interviews (any interviews.write edits/cancels any), emails (any reader sees all incl. unmatched inbound).
- Gaps: see ISSUES #1, #3, #6, #13, #14, #33.

### 7. Connections

#### 7.1 Endpoints exposed (prefix from app.ts:120-155)

| Method           | Path                                                            | Guard                                        | Validation                        |
| ---------------- | --------------------------------------------------------------- | -------------------------------------------- | --------------------------------- |
| POST             | /api/v1/auth/login                                              | public                                       | loginSchema                       |
| POST             | /api/v1/auth/logout                                             | token                                        | –                                 |
| POST             | /api/v1/auth/refresh-token                                      | cookie                                       | –                                 |
| POST             | /api/v1/auth/forgot-password                                    | public                                       | {email}                           |
| POST             | /api/v1/auth/reset-password                                     | public                                       | {token,password≥8}                |
| POST             | /api/v1/auth/change-password                                    | token                                        | {currentPassword,newPassword≥8}   |
| POST             | /api/v1/auth/verify-email                                       | public                                       | {token}                           |
| POST             | /api/v1/auth/set-password                                       | public                                       | {token,password≥8}                |
| PATCH            | /api/v1/shared/users/me                                         | token                                        | updateMeSchema                    |
| POST             | /api/v1/shared/users/me/avatar                                  | token                                        | multipart `file` jpeg/png 2MB     |
| GET              | /api/v1/shared/users/crm-accounts                               | token (admin all / AM scoped / others empty) | –                                 |
| GET              | /api/v1/shared/users                                            | team.read                                    | –                                 |
| POST             | /api/v1/shared/users                                            | team.write                                   | createUserSchema                  |
| GET              | /api/v1/shared/users/:id                                        | team.read                                    | –                                 |
| PATCH            | /api/v1/shared/users/:id                                        | team.write                                   | updateUserSchema                  |
| DELETE           | /api/v1/shared/users/:id                                        | team.manage                                  | – (hard delete)                   |
| PATCH            | /api/v1/shared/users/:id/permissions                            | team.manage                                  | record<record<bool>>              |
| POST             | /api/v1/shared/users/provision-client                           | team.write                                   | {clientId}                        |
| POST             | /api/v1/shared/users/provision-va                               | team.write                                   | {candidateId}                     |
| POST             | /api/v1/shared/users/:id/revoke-crm                             | team.manage                                  | –                                 |
| GET              | /api/v1/shared/settings                                         | settings.read                                | –                                 |
| PATCH            | /api/v1/shared/settings                                         | settings.write                               | updateSettingsSchema              |
| GET              | /api/v1/shared/activity-logs                                    | ats + activityLogs.read                      | –                                 |
| GET              | /api/v1/shared/activity-logs/:resourceType/:resourceId          | ats + activityLogs.read or record read perm  | –                                 |
| GET/POST         | /api/v1/ats/clients                                             | ats + clients.read / clients.write           | createClientSchema                |
| GET/PATCH/DELETE | /api/v1/ats/clients/:id                                         | clients.read / write / manage                | updateClientSchema                |
| POST             | /api/v1/ats/clients/:id/logo                                    | clients.write                                | multipart `logo`                  |
| POST             | /api/v1/ats/clients/:id/contacts                                | clients.write                                | createContactSchema               |
| PATCH/DELETE     | /api/v1/ats/clients/:id/contacts/:contactId                     | clients.write                                | updateContactSchema               |
| PATCH            | /api/v1/ats/clients/:id/crm-profile                             | clients.write                                | updateCrmProfileSchema            |
| GET/POST         | /api/v1/ats/clients/:clientId/notes                             | admin                                        | createClientNoteSchema            |
| PATCH/DELETE     | /api/v1/ats/clients/:clientId/notes/:noteId                     | admin                                        | updateClientNoteSchema            |
| GET/POST         | /api/v1/ats/tags                                                | tags.read / tags.write                       | createTagSchema                   |
| PATCH/DELETE     | /api/v1/ats/tags/:id                                            | tags.write / tags.manage                     | updateTagSchema                   |
| GET/POST         | /api/v1/ats/pipeline-templates                                  | pipelineTemplates.read / write               | createTemplateSchema              |
| GET/PATCH/DELETE | /api/v1/ats/pipeline-templates/:id                              | read / write / write                         | updateTemplateSchema              |
| GET              | /api/v1/ats/jobs                                                | public (optional token)                      | listJobsQuerySchema               |
| GET              | /api/v1/ats/jobs/:id                                            | public (optional token)                      | –                                 |
| POST             | /api/v1/ats/jobs/:id/apply                                      | public                                       | multipart + applyToJobSchema      |
| POST             | /api/v1/ats/jobs                                                | ats + jobs.write                             | createJobSchema                   |
| POST             | /api/v1/ats/jobs/generate-draft                                 | jobs.write                                   | {notes}                           |
| POST             | /api/v1/ats/jobs/standardize                                    | jobs.write                                   | standardizeContentSchema          |
| PATCH            | /api/v1/ats/jobs/:id                                            | jobs.write                                   | updateJobSchema                   |
| DELETE           | /api/v1/ats/jobs/:id                                            | jobs.manage                                  | –                                 |
| PATCH            | /api/v1/ats/jobs/:id/status                                     | jobs.write                                   | {status}                          |
| PATCH            | /api/v1/ats/jobs/:id/pipeline                                   | jobs.write                                   | {templateId, stageMapping?}       |
| POST             | /api/v1/ats/candidates/public/parse                             | public                                       | multipart resume                  |
| POST             | /api/v1/ats/candidates/public/upload-and-parse                  | public                                       | multipart + publicApplySchema     |
| GET/POST         | /api/v1/ats/candidates                                          | ats + candidates.read / write                | createCandidateSchema (multipart) |
| POST             | /api/v1/ats/candidates/:id/approve                              | candidates.write                             | assignJobSchema                   |
| GET/PATCH/DELETE | /api/v1/ats/candidates/:id                                      | read / write / manage(+admin in service)     | updateCandidateSchema             |
| POST             | /api/v1/ats/candidates/:id/avatar                               | candidates.write                             | multipart `avatar`                |
| PATCH            | /api/v1/ats/candidates/:id/talent-pool                          | candidates.write                             | talentPoolSchema                  |
| PATCH            | /api/v1/ats/candidates/:id/reject                               | candidates.write                             | rejectCandidateSchema (strict)    |
| PATCH            | /api/v1/ats/candidates/:id/eligibility                          | admin                                        | eligibilitySchema                 |
| PATCH            | /api/v1/ats/candidates/:id/restore                              | admin                                        | {jobId}                           |
| PATCH            | /api/v1/ats/candidates/:id/legal-hold                           | admin                                        | {legalHold}                       |
| POST             | /api/v1/ats/candidates/:id/assign-job                           | candidates.write                             | assignJobSchema                   |
| POST             | /api/v1/ats/candidates/:id/change-job                           | candidates.write                             | changeJobSchema                   |
| GET              | /api/v1/ats/applications                                        | ats + candidates.read                        | –                                 |
| GET              | /api/v1/ats/applications/:id                                    | candidates.read                              | –                                 |
| PATCH            | /api/v1/ats/applications/:id/approve                            | candidates.write                             | –                                 |
| PATCH            | /api/v1/ats/applications/:id/reject                             | candidates.write                             | rejectSchema                      |
| PATCH            | /api/v1/ats/applications/:id/move-to-talent-pool                | candidates.write                             | {notes≤2000}                      |
| PATCH            | /api/v1/ats/applications/:id/stage                              | candidates.write                             | {stageId}                         |
| PATCH            | /api/v1/ats/applications/:id/hire                               | candidates.write                             | –                                 |
| PATCH            | /api/v1/ats/applications/:id/notes                              | candidates.write                             | {notes}                           |
| GET/POST         | /api/v1/ats/applications/:applicationId/interviews              | interviews.read / write                      | createNestedInterviewSchema       |
| GET/PATCH/DELETE | /api/v1/ats/applications/:applicationId/interviews/:id          | read / write / write                         | updateInterviewSchema             |
| POST             | /api/v1/ats/applications/:applicationId/interviews/:id/feedback | interviews.write                             | feedbackSchema                    |
| GET/POST         | /api/v1/ats/interviews                                          | ats + interviews.read / write                | createInterviewSchema             |
| GET/PATCH/DELETE | /api/v1/ats/interviews/:id                                      | read / write / write (cancel)                | updateInterviewSchema             |
| POST             | /api/v1/ats/interviews/:id/feedback                             | interviews.write                             | feedbackSchema                    |
| POST/GET         | /api/v1/ats/interview-scorecards                                | interviewScorecards.write / read             | create schema / list query schema |
| GET/PATCH        | /api/v1/ats/interview-scorecards/:id                            | read / write                                 | update schema                     |
| GET              | /api/v1/ats/disposition-reasons/active                          | candidates.read                              | –                                 |
| GET/POST         | /api/v1/ats/disposition-reasons                                 | settings.read / settings.write               | createReasonSchema                |
| GET/PATCH/DELETE | /api/v1/ats/disposition-reasons/:id                             | settings.read / write / write                | updateReasonSchema                |
| PATCH            | /api/v1/ats/disposition-reasons/:id/deactivate                  | settings.write                               | –                                 |
| PATCH            | /api/v1/ats/disposition-reasons/:id/reorder                     | settings.write                               | {order}                           |
| GET/POST         | /api/v1/ats/email-templates                                     | emailTemplates.read / write                  | createTemplateSchema              |
| GET/PATCH/DELETE | /api/v1/ats/email-templates/:id                                 | read / write / write                         | updateTemplateSchema              |
| GET/POST         | /api/v1/ats/emails                                              | emails.read / emails.write                   | sendEmailSchema                   |
| GET              | /api/v1/ats/emails/thread/:threadId                             | emails.read                                  | –                                 |
| GET/DELETE       | /api/v1/ats/emails/:id                                          | emails.read / emails.write                   | –                                 |
| PATCH            | /api/v1/ats/emails/:id/read                                     | emails.read                                  | –                                 |
| POST             | /api/v1/ats/emails/:id/resend                                   | emails.write                                 | –                                 |
| GET              | /api/v1/ats/dashboard                                           | ats + dashboard.read                         | –                                 |
| POST             | /api/webhooks/resend                                            | public (Svix if secret set)                  | –                                 |
| POST             | /api/webhooks/resend/test                                       | public, 403 in production                    | testSchema                        |

Response shapes: `{success, data, message, meta?}`; lists return arrays of `toSafeObject` records with `meta {total,page,limit,totalPages}`; apply returns `{candidateId, jobId, received, blocked?}`; assign/change/approve candidate return `{candidateId, jobId, applicationId, ...flags}`; createUser returns `{user, inviteToken}`; dashboard returns `{overview, recentApplications, upcomingInterviews, jobStats}`.

#### 7.2 Socket.IO events emitted (namespace /ats; sockets/index.ts:21-27)

- room `applications`: application:created|updated|deleted|phaseChanged (application.service.ts:88, 259-263, 338-342, 513-517, 604, 671-675, 703, 736, 778); interview:created|updated (interview.service.ts:391, 565, 613, 670).
- room `candidates`: candidate:created|updated|deleted|statusChanged (candidate.service.ts:342, 408, 572, 724, 758, 890, 925-929, 971, 995, 1026, 1061, 1139, 1186, 1211).
- room `jobs`: job:created|updated|deleted|statusChanged (job.service.ts:128, 200, 232, 343, 381-382).
- room `clients`: client:created|updated|deleted (client.service.ts:91, 204, 243, 319, 350, 382, 555).
- room `tags`: tag:created|updated|deleted; `pipeline-templates`: pipeline*template:*; `email-templates`: email*template:*.
- All ATS sockets join every room (sockets/ats.socket.ts:35-41).

#### 7.3 External services

- **Resend** (shared/utils/email.ts): all outbound mail — interview emails (interviewEmail.service.ts), invites (user.service.ts:347-352), password reset (auth.service.ts:174-239), recruiter emails & confirmation (email.service.ts:88-95); inbound content + attachments fetch (webhook.service.ts:161-213); Svix webhook signature (webhook.service.ts:20-42).
- **Cloudinary** (config/cloudinary): resumes (candidate.controller.ts:122; job.controller.ts:158), portfolios (job.controller.ts:167), avatars (candidate.controller.ts:168; user.controller.ts:253), logos (client.controller.ts:69); deletions on replace/delete (candidate.service.ts:225, 242, 615-631; client.controller.ts:73; user.controller.ts:260).
- **AI (Claude/OpenAI via shared/utils/ai)**: job draft (jobDraft.service.ts:174-177), standardize (jobStandardize.service.ts:371-374), public resume parse (candidate.controller.ts:612, 644 via parseResumeTextWithAI), background jobs runResumeParsing / runResumeValidation / runCandidacyValidation / runCandidateScoring triggered from application.service.ts:226, 239, 316; candidate.service.ts:326, 396; candidate.controller.ts:283, 435; job.controller.ts:237, 254.
- **Zoom** (shared/utils/zoom.ts): create/update/delete meetings (interview.service.ts:303-308, 481-488, 589). **Google Meet**: manual link; util stubs only (interview.service.ts:489-500, 590-592).
- **Sentry**: app.ts:6-11, 161-167; errorHandler.ts:44.

### 8. Data models (summary; full field lists in section 2 notes)

ActivityLog, Application (unique candidateId+jobId), Candidate (unique email, text index), Client (embedded contacts/notes/crmProfile), DispositionReason, EmailTemplate (unique name), Email (context refs), InterviewScorecard, Interview (embedded feedbacks/meetingDetails), Job (embedded pipeline stages), PipelineTemplate (unique name, partial-unique default), Settings (singleton), Tag (unique name), User (unique email, embedded permissions).
Relationships: Application→Candidate/Job/Client/DispositionReason/Interview[]; Interview→Application/Candidate/Job/Client/User; Job→Client/Tag/PipelineTemplate; Candidate→Tag/DispositionReason/User; User→Client/Candidate; Email→Candidate/Application/Job/Interview/EmailTemplate/User; Settings→EmailTemplate. No `populate()` anywhere — names are resolved manually (interview.service.ts:57-107, candidate.service.ts:108-128) or not at all (activity performedBy, application lists, dashboard).
Enums duplicated between zod, Mongoose and TS types in many modules (see ISSUE #55).

### 9. Dependencies used in scope

express ^4.18 (routing; extended qs query parser), mongoose ^8 (models, hooks, bulkWrite), zod ^3.22 (request validation), jsonwebtoken ^9 (access/refresh JWT), bcryptjs ^2.4.3 (cost 12), multer (memory uploads), cookie-parser, cors, helmet, express-rate-limit, @sentry/node, cloudinary ^2, resend ^6.4.0-canary.0 (canary build in production deps, backend/package.json:45), svix (webhook verification, webhook.service.ts:3), socket.io ^4.8, crypto (token generation), internal AI provider abstraction (shared/utils/ai: getAiProvider, withRetry, parseJsonResponse).

---

### 10. ISSUES

Severity / category / location / problem / why it matters / fix direction.

1. **High — security** — clients/client.model.ts:233-240, clients/client.service.ts:43, 54, 91, 204, 243, 319, 350, 555; sockets/ats.socket.ts:38. Admin-only client notes (`notes[]`, guarded by `requireRoles('admin')` at clients/client.routes.ts:158-178) are returned by `GET /ats/clients`, `GET /ats/clients/:id` and every `client:*` socket emit to any ATS user. Leaks internal CRM notes to recruiters/hiring managers/coordinators (and interviewers via sockets). Fix: strip `notes` in toSafeObject (add a separate admin serializer) or move notes to their own collection.
2. **High — security** — candidates/candidate.service.ts:189-199, 207-258, 266-284; jobs/job.controller.ts:137-204. Public apply matches an existing candidate by email OR normalized phone and, while that candidate is pending, overwrites their resume, parsed data and portfolio and deletes their previous Cloudinary files — with no proof of identity. Anyone who knows an applicant's email/phone can replace their application materials. Fix: never mutate an existing record from an anonymous request (store a new submission / require email verification link), match by email only, never delete prior files from public flows.
3. **High — security** — users/user.controller.ts:33-46, 197-204, 231-243; users/user.service.ts:360-466. `assertCanManageTarget` only protects admin targets; a non-admin holding team.write/team.manage (possible via custom permissions) can edit their own roles and their own permission map (`PATCH /shared/users/:ownId/permissions`) → self-escalation to any non-admin capability (settings.write, clients.manage…). Fix: forbid self-modification of roles/permissions, and cap grantable permissions to those the actor holds.
4. **High — security / bad implementation** — users/user.service.ts:536-566, 613-642. `provisionVA`/`provisionClient` reactivate ANY existing user whose email matches (including a deactivated staff/admin account) with its old roles and permissions, add `crm` access and issue a fresh invite token; they don't set the `va`/`client` role or rebuild permissions. Hiring a candidate (application.service.ts:640-646) or provisioning a client can silently resurrect a former employee's privileged account. Fix: refuse when the matched user has non-CRM roles; set role and rebuild permissions explicitly.
5. **High — security (config-dependent)** — webhooks/webhook.controller.ts:9, 19-25, 44-52; webhooks/webhook.service.ts:10. Resend signature verification is skipped entirely when `RESEND_WEBHOOK_SECRET` is unset (fail-open); `/api/webhooks/resend/test` is a public unauthenticated endpoint in every non-production environment. Attackers can forge status changes or inject inbound "candidate replies". Fix: refuse webhooks when the secret is missing (or fail startup in production); require auth/feature flag for the test route; read the secret from `env`.
6. **High — security** — jobs/job.routes.ts:201-207; jobs/job.controller.ts:26-36, 51-59. Public job routes treat ANY valid token as staff: CRM-only VA/client users and ATS interviewers (no jobs.read, users/user.service.ts:120-126) get every client's full job record (clientId, pipeline, priority, tags, internal fields). Fix: return the full view only when `hasPermission(user,'jobs','read')` and ATS access; otherwise the public view.
7. **Medium — security** — users/user.controller.ts:189-194. `POST /shared/users` returns the raw `inviteToken`; anyone with team.write can accept the invite (set the password) for the invitee and act as them. Fix: don't return the token (or only in non-production).
8. **High — bug** — candidates/candidate.service.ts:1161-1163 with candidates/candidate.routes.ts:277-280, 286-291. `PATCH /candidates/:id/eligibility` takes `reason` as free text but the service does `new mongoose.Types.ObjectId(reason)` → any non-ObjectId text throws BSONError → 500. Also banning via this path doesn't clear talent-pool flags or touch live applications (contrast :859-867). Fix: validate `reason` as a DispositionReason id (objectIdSchema) or store text separately; reuse rejectCandidate's side-effects.
9. **Medium — bug** — applications/application.service.ts:649-655 vs users/user.service.ts:331-333 and users/user.controller.ts:319, 372. Hiring sends the VA invite without `inviteUrl`, so a CRM-only VA receives the ATS `/ats/verify-email/:token` link instead of the CRM `/accept-invitation` link used by manual provisioning. Fix: pass the CRM URL (centralise invite URL selection by appAccess in sendTeamMemberInvite).
10. **Medium — bad implementation (data integrity)** — applications/application.service.ts:608-660 (hire), candidates/candidate.controller.ts:404-443 (change job), 510-528 (approve), candidates/candidate.service.ts:615-712 (delete cascade), jobs/job.service.ts:318-329 (pipeline swap). Multi-document workflows run without transactions; a failure midway leaves partial state (e.g. application hired but no VA user; Cloudinary files deleted but DB rows remain). Fix: Mongo sessions/transactions or outbox pattern; move orchestration from controllers into services.
11. **Medium — bug / business rule** — applications/application.service.ts:124-136 vs :418-448. The "reopen a moved application" exception keys on `closedAt == null`, but non-final rejections (candidate live on another job) and reason-less rejections also leave `closedAt` null, so `assign-job` silently reopens a genuine rejection — contradicting the comment "Real rejections stay closed". Fix: add an explicit `closeReason: 'moved'|'rejected'` field.
12. **Medium — security** — candidates/candidate.controller.ts:33-36, 59-76; candidates/candidate.service.ts:94-97. `includeIneligible=true` is not admin-gated, so any candidates.read user can list banned candidates, bypassing the admin-only rule enforced for `eligibilityStatus` (:48-57) and `GET /:id` (:93-102). Fix: apply the same admin check.
13. **Medium — security** — sockets/ats.socket.ts:35-41 with all emits in section 7.2. Every ATS socket joins every room regardless of permissions, so full candidate (incl. banned, salaries, resumeRawText), client (incl. notes) and interview (incl. Zoom passwords) payloads reach users who can't read them via REST. Fix: join rooms per permission and emit minimal payloads/ids.
14. **Medium — security** — shared/middleware/authenticate.ts:17-36. Roles/permissions/appAccess are trusted from the access token with no DB check; deactivation, hard deletion, role/permission changes and revoke-CRM only take effect when the access token expires (documented in backend/ENDPOINTS.md:7). Fix: short expiry + tokenVersion check, or cache-backed user lookup.
15. **Medium — security** — auth/auth.service.ts:30-54. Inactive-account check runs before the password check (reveals that an account exists and is deactivated to anyone), unknown emails skip bcrypt (timing oracle), and login doesn't verify `appAccess` includes the requested `app`. Fix: compare password first with a dummy hash for unknown users; return a generic error; check app access.
16. **Medium — security / bug** — auth/auth.service.ts:164-239. Forgot-password awaits `sendEmail` without try/catch → provider failure returns 500 only for existing accounts (enumeration); reset email hard-codes "Arista ATS" branding and always links to the ATS app, even for CRM-only users. Fix: fire-and-forget with logging; use env.COMPANY_NAME; choose the app URL by appAccess.
17. **Medium — security** — auth/auth.service.ts:84-91, 168-171; users/user.service.ts:219-236. Refresh, password-reset and invite tokens are stored in plaintext; refresh tokens are never rotated and only one per app is kept (a second device logs out the first). Fix: store hashes, rotate on refresh, support multiple sessions.
18. **Medium — security / performance** — app.ts:101-117; candidates/candidate.routes.ts:177-216. Rate limiting exists only in production; the 10/15-min auth limiter also counts `/refresh-token` (multi-tab users can lock themselves out — inferred); public AI resume-parse endpoints have no dedicated limit or captcha → anonymous AI cost / CPU abuse. Fix: per-route limiters, exclude refresh, captcha on public parse/apply.
19. **Medium — security / data integrity** — jobs/job.controller.ts:149-157. Apply trusts client-supplied `resumeRawText` over server extraction; the stored text (used by AI validation/parsing/scoring) can be unrelated to the uploaded file. Fix: always extract server-side.
20. **Medium — security** — interviews/interviewEmail.service.ts:73, 88, 93, 190, 198, 257, 374, 416; shared/utils/email.ts:9-16 (substituteVariables); users/user.service.ts:283-306. User-controlled strings (applicant names from the public form, interview titles, meeting links/addresses, template variables) are interpolated into HTML emails without escaping → HTML injection/phishing content in company-branded mail. Fix: HTML-escape values; validate URLs.
21. **Medium — security** — interviews/interview.schemas.ts:35-38. Meeting link uses `z.string().url()` (accepts `javascript:`/`data:`) unlike `httpUrlSchema` (shared/validators/common.validator.ts:14-19); the link is rendered as an `<a href>` in emails (interviewEmail.service.ts:73) and the UI (inferred). Fix: use httpUrlSchema.
22. **Medium — bug (inferred from Mongoose semantics)** — clients/client.service.ts:581-610. `addNote` returns `_id`/timestamps from the plain object it pushed; Mongoose creates a new subdocument, so the response contains `_id: "undefined"` and undefined dates. Fix: read back `client.notes[client.notes.length - 1]`.
23. **Medium — bug** — pipeline-templates/pipelineTemplate.service.ts:38-52 with pipelineTemplate.model.ts:34. Any E11000 (including the unique `name` index) is reported as "Another pipeline template is already marked as default". Fix: inspect `keyPattern`.
24. **Medium — bad implementation** — users/user.service.ts:468-493; users/user.controller.ts:213-228. `deactivateUser`/`DELETE /users/:id` hard-deletes the user while responding "User deactivated"; references in Interview.interviewerIds/organizerId, Assignment.accountManagerId, createdBy/updatedBy, activity performedBy become dangling. Fix: soft delete (isActive=false) and keep a separate purge.
25. **Medium — bug** — interviews/interview.service.ts:345-355; candidates/candidate.service.ts:311, 384, 529; clients/client.service.ts:79, 185, 522-525; users/user.service.ts:554, 589, 631, 665; interview-scorecards/interview-scorecard.service.ts:250-253. Unvalidated strings are passed to `new mongoose.Types.ObjectId()`; a malformed id throws BSONError, which errorHandler.ts doesn't recognise → 500 + Sentry noise instead of 400. Fix: use `objectIdSchema` in zod for every id field.
26. **Medium — bug** — interviews/interview.service.ts:441-444, 510-526. Changing an interview's `type` does not create/delete the Zoom meeting or reset meetingDetails; `"Meeting details updated"` is pushed whenever the `meetingDetails` key is present, triggering update emails to candidate and interviewers even when nothing changed. Fix: diff values; handle type transitions.
27. **Medium — bug** — interviews/interview.service.ts:577-583. Cancel only rejects already-cancelled interviews; completed/no-show interviews can be cancelled and the candidate gets a cancellation email (error code INTERVIEW_ALREADY_COMPLETED is used for the "already cancelled" case). Fix: allow cancel only from `scheduled`.
28. **Low — bug** — interviews/interview.service.ts:617-654. Feedback can be submitted on scheduled or cancelled interviews. Fix: require completed (or at least not cancelled).
29. **Medium — bug / security** — interviews/interview.controller.ts:48-58; interviews/interview.service.ts:269-357. Flat `POST /ats/interviews` trusts client-provided applicationId/candidateId/jobId/clientId with no existence or consistency checks, no application-phase check (can schedule for rejected/hired) and no past-date check; interviewerIds aren't verified as staff users. Fix: derive ids from the application like the nested route and validate.
30. **Low — inconsistency** — interviews/interview.controller.ts:40-96 via applications/application.routes.ts:116-140. Nested `/applications/:applicationId/interviews/:id` routes ignore `:applicationId`; any interview can be read/edited under any application path. Fix: assert `interview.applicationId === applicationId`.
31. **Medium — ambiguity / bug** — jobs/job.controller.ts:141-160, 245-303. An existing candidate who is approved/hired/in a pipeline applying to a different job gets "Application received" and a confirmation email, but nothing about the new job is stored (no application, appliedJobId unchanged, no log) — the application is silently lost. Also re-applies by pending candidates overwrite `appliedJobId` (:247-251) contrary to candidate.service.ts:254-257. Fix: define the rule; at least record the interest (activity/log or pending application).
32. **Medium — bug** — jobs/job.controller.ts:122-129. `applicationDeadline` is never enforced on apply. Fix: reject after deadline (and hide from public list).
33. **Medium — bug** — candidates/candidate.controller.ts:218-265; candidates/candidate.routes.ts:163-166. `assign-job` accepts a missing jobId (schema optional) and doesn't check job status, so candidates can be assigned to draft/on_hold/closed jobs (change-job checks `open`, :357-363). Fix: require jobId, check status.
34. **Medium — security** — interview-scorecards/interview-scorecard.controller.ts:23-27; interview-scorecard.service.ts:225-253. Any interviewScorecards.write holder (incl. `interviewer`) can create scorecards attributed to any user and overwrite anyone's scorecard. Fix: restrict interviewerId to self unless elevated; ownership check on update.
35. **Medium — security** — emails/email.routes.ts:19-53; emails/email.service.ts:60-109. Any emails.write holder can send arbitrary HTML to arbitrary external addresses (to/cc/bcc) from the verified company domain with no rate limit or recipient restriction → phishing/spam vector and domain-reputation risk. Fix: restrict recipients to candidate/contact addresses or require elevated permission; rate limit.
36. **Low — bug** — emails/email.service.ts:63-66, 78, 95. Variables are substituted into subject/bodyHtml but not bodyText → raw `{{placeholders}}` in plain-text part. Fix: substitute bodyText too.
37. **Medium — bug** — webhooks/webhook.service.ts:54-133. Status handlers overwrite unconditionally, so out-of-order events regress status (delivered → sent/delayed); opened/clicked counters double-count on retries. Fix: monotonic status ranking; idempotency by event id.
38. **Medium — bug** — webhooks/webhook.service.ts:221-230, 300-305. Inbound attachment `download_url` (expiring, `expires_at`) is stored as the permanent `url`; attachments break later. Fix: copy to Cloudinary/S3 or fetch on demand.
39. **Low — bad implementation** — emails/email.service.ts:70-80; webhooks/webhook.service.ts:259-273. Outbound mail never records a Message-ID, so reply threading falls back to "latest outbound to this address"; interview/invite/reset emails bypass the Email collection entirely and can't be threaded or audited. Fix: set custom Message-ID header, persist all outbound emails.
40. **Medium — performance** — dashboard/ats/atsDashboard.service.ts:69-92. Per open job: 4 counts + client lookup (5N queries) on every dashboard load. Fix: single aggregation with $group/$lookup.
41. **Medium — performance** — candidates/candidate.service.ts:100-140. Candidate list returns `resumeRawText` (full resume text) for every row (GET /:id strips it, :157) and socket emits carry it too. Fix: projection excluding resumeRawText (and other heavy fields) on lists/emits.
42. **Medium — performance / robustness** — activity-logs/activityLog.controller.ts:15-16, 38-39; applications/application.controller.ts:26-27; interviews/interview.controller.ts:27-28, 112-113; candidates/candidate.controller.ts:73-74; clients/client.controller.ts:24-25; emails/email.controller.ts:25-26. `Number(page/limit)` without validation or cap: NaN/negative values cause Mongo errors (500) and `limit=1000000` dumps whole collections. Fix: shared paginationSchema (common.validator.ts:21-24).
43. **Low — security** — applications/application.service.ts:35-38; interviews/interview.service.ts:239-243; candidates/candidate.service.ts:82; emails/email.service.ts:378-384; activity-logs/activityLog.service.ts:53-56; clients/client.service.ts:33; email-templates/emailTemplate.service.ts:17; users/user.service.ts:173-181. Raw `req.query` values go into Mongo filters; with Express 4's qs parser `?status[$ne]=x` becomes an operator on String fields (only jobs list validates its query, job.routes.ts:187-195). Authenticated-only, so impact is limited to filter bypass. Fix: validate query params with zod or enable `sanitizeFilter`.
44. **Low — performance** — activity-logs/activityLog.service.ts:93-100; activityLog.model.ts:37-40. `includeRelated` `$or` on (relatedType, relatedId) has no supporting index → collection scan on the candidate history panel. Fix: add `{relatedType:1, relatedId:1, createdAt:-1}`.
45. **Low — UX / bug** — jobs/job.service.ts:45-47; clients/client.service.ts:37-40; users/user.service.ts:184-187. Lists without sort → nondeterministic pagination. Fix: sort by createdAt/\_id.
46. **Low — data loss** — candidates/candidate.model.ts:46-56 vs candidates/candidate.routes.ts:69, 111 and candidate.types.ts:16. `parsedData.yearsOfExperience` is accepted but not in the Mongoose subschema → silently dropped. Fix: add to schema or drop from API.
47. **Low — data integrity** — clients/client.model.ts:162-220 (esp. :174-180, :202-210). Unknown companySize values are silently coerced to '1-10' (comment says "unset"). Fix: reject with 400.
48. **Low — inconsistency** — clients/client.model.ts:127; clients/client.service.ts:61-68, 116-121; backend/ENDPOINTS.md:85. Client email is documented as unique but has no unique index and PATCH doesn't check duplicates. Fix: unique index + check.
49. **Low — data integrity** — clients/client.service.ts:354-384; jobs/job.service.ts:204-234; tags/tag.service.ts:82-101; email-templates/emailTemplate.service.ts:146-168; candidates/candidate.service.ts:642-712. Hard deletes leave dangling references (draft/closed jobs and client users after client delete; applications/interviews after job delete; tag ids on records; settings.applicationConfirmation.templateId after template delete; VA User/VaProfile after candidate delete). Fix: reference checks or soft delete/cascade.
50. **Low — UX / ambiguity** — pipeline-templates/pipelineTemplate.service.ts:152-187. Switching the default template requires unsetting the old one first (a window with no default where job creation fails with 422 PIPELINE_REQUIRED, jobs/job.service.ts:86-96); unsetting the only default is allowed. Fix: atomic "make default" that swaps.
51. **Low — business-rule ambiguity** — disposition-reasons/dispositionReason.service.ts:100-112, 209-212. Category `permanently_ineligible_reasons` and `defaultEligibility` can disagree after an update; usage check ignores reasons recorded only as labels (non-final rejects, In-Review pool rejects) so "used" reasons can be deleted. Fix: derive one from the other; record reasonId consistently.
52. **Low — bug** — jobs/jobStandardize.service.ts:22-27, 81-84. Output cap (50) < input cap (60) silently drops up to 10 items per list; `keep()` restores the original list whenever the model empties it, defeating rule 10 (moving all tools from requirements to skills) and reintroducing duplicates. Fix: equal caps; fall back only when all lists are empty.
53. **Low — dead code** — jobs/job.routes.ts:42-52 (unused stageSchema); jobs/job.service.ts:74-85 (pipelineTemplateId branch unreachable because zod strips it); jobs/job.routes.ts:143 (coverLetter accepted, discarded); interviews/interview.model.ts:84-94 (legacy interviewType/round); interviews/interview.types.ts:1-11; interviews/interview.service.ts:489-500, 590-592 (Google Meet update/delete never reachable: meetingId never set); interview-scorecards/interview-scorecard.service.ts:2-5, 158-160 (AI-task artefact comment; claims realtime that doesn't exist).
54. **Low — duplication** — role enum ×4 (users/user.routes.ts:31-40, 51-60; user.model.ts:14-23; user.types.ts:1-9); upload middlewares ×3 (shared/middleware/upload.ts:127-218); disposition category enum ×4; scorecard enums ×2; stage zod schema ×2 (jobs/job.routes.ts:42-52, pipeline-templates/pipelineTemplate.routes.ts:20-33); Cloudinary public-id parsers ×4 (candidates/candidate.service.ts:32-51, clients/client.controller.ts:11-14, candidates/candidate.controller.ts:170, users/user.controller.ts:257); three inbound Email.create blocks (webhooks/webhook.service.ts:281-380); three email HTML wrappers. Fix: shared constants/helpers.
55. **Low — bug** — shared/middleware/errorHandler.ts:12-26; shared/middleware/upload.ts:32-39, 104-111. Multer errors other than LIMIT_FILE_SIZE (unexpected field, too many files) become 500; DUPLICATE_KEY responses echo `keyValue` (field values) to the client. Fix: map MulterError generically; omit values.
56. **Low — bad implementation** — app.ts:171-180. DB connect failure logs "companySize migration failed"; `startBackgroundJobs()` runs before the connection resolves despite the comment; server listens even if DB is down. Fix: await connect before jobs/listen.
57. **Low — inconsistency (outside scope, noted)** — app.ts:147-149. reportsRouter mounted at both /api/v1/crm/reports and /api/v1/reports (CRM exports reachable on the second prefix too; documented in backend/ENDPOINTS.md:343).
58. **Low — privacy** — candidates/candidate.controller.ts:603, 629-631; users/user.service.ts:353, 356; applications/application.controller.ts:12-19, 30-32. Applicant names/emails and invitee emails logged at info level; every applications list call logged. Fix: drop PII from logs, lower verbosity.
59. **Low — bug** — settings/settings.service.ts:94-105. applicationConfirmation.templateId is not validated (existence, active, type). Fix: validate on save.
60. **Low — privacy** — jobs/job.controller.ts:220-226, 313-318. Anonymous apply responses expose the internal candidateId and the ban flag (`blocked:true`). Fix: return only `{received:true}`.
61. **Low — doc mismatch** — shared/middleware/upload.ts:81 vs backend/ENDPOINTS.md:24. Apply route accepts resumes up to 10 MB (combined limit) while docs/other routes say 5 MB.
62. **Low — bug** — jobs/job.service.ts:244-329. Pipeline swap doesn't check `template.isActive`, isn't atomic (bulkWrite then save) and emits no application updates for remapped cards (inferred stale boards).
63. **Low — race** — interviews/interview.service.ts:123-155, 293, 344; interview.model.ts:124-129. Conflict detection is check-then-insert without locking; no compound index for (status, interviewerIds, scheduledAt).
64. **Low — security** — auth/auth.service.ts:320-367. `verify-email` marks the invite accepted without a password; `set-password` doesn't clear refresh tokens or password-reset tokens; `reset-password` marks `emailVerified/isInviteAccepted` even for plain resets.
65. **Low — inconsistency** — dashboard/ats/atsDashboard.service.ts:51-63. Raw lean docs returned (ObjectIds, Zoom passwords in meetingDetails) unlike every other endpoint's toSafeObject payloads.
66. **Low — UX** — interview-scorecards/interview-scorecard.service.ts:161-175. Scorecard creation logs generic `created` against the candidate resource (relatedType `interview_scorecard` not in ActivityLogResourceType) — timeline may render it as "candidate created" (inferred).
67. **Low — business ambiguity** — applications/application.service.ts:608-677. Hiring doesn't close the candidate's other live applications; moves/talent-pool removals are stored as phase `rejected` (application.service.ts:533-538), so anything counting `phase:'rejected'` (dashboard, reports — inferred) includes non-rejections.
68. **Low — bug** — candidates/candidate.controller.ts:510-528. Approving a candidate for a job without a pipeline sets candidate `approved` with a `pending` application — the limbo the comment says it avoids.
69. **Low — inconsistency** — webhooks/webhook.controller.ts:22. Invalid signature → `success:true` envelope with HTTP 401.
70. **Low — inconsistency** — emails/email.service.ts:72 vs shared/utils/email.ts:27-28. Stored `from` is env.COMPANY_EMAIL while the real sender comes from settings.
71. **Low — ambiguity** — email-templates/emailTemplate.service.ts:68-144. A default template can be deactivated; the `interview`, `offer`, `rejection`, `follow_up` template types are never consumed by server-side sends (only application_confirmation, jobs/job.controller.ts:264) — interview emails are hard-coded (interviews/interviewEmail.service.ts).
72. **Low — race** — tags/tag.service.ts:15-42, 44-80. Case-insensitive duplicate check runs on untrimmed input and isn't backed by a case-insensitive unique index.
73. **Low — inconsistency** — emails/email.routes.ts:63. Marking as read (a write) is guarded by emails.read.
74. **Low — bug** — applications/application.service.ts:267-303. `approveApplication` ignores `isBlocked` and candidate eligibility (a candidate banned after holding a pending application can still be approved via `PATCH /applications/:id/approve`); an unknown `startStageId` silently falls back to the first stage.
75. **Low — robustness (inferred)** — applications/application.service.ts:226, 239, 316; candidates/candidate.service.ts:326, 396; candidates/candidate.controller.ts:283, 435; jobs/job.controller.ts:254. Background AI jobs (`run*` return Promises) are fired without `.catch`; if the job body rejects, an unhandled rejection occurs (job.controller.ts:237 is the only call site with a catch).

#### Docs vs code (backend/ENDPOINTS.md)

- All routes in scope are documented; no undocumented route found.
- Mismatches: client email "unique" (ENDPOINTS.md:85) — not enforced (#48); resume limit 5 MB (:24) — apply route 10 MB (#61); `assign-job {jobId, ...}` (:114) — jobId optional in code (#33); `DELETE /interviews/:id` "Cancels" (:179) — also cancels completed/no-show (#27); `DELETE /shared/users/:id` documented as hard delete but controller message says "User deactivated" (#24); `GET /ats/jobs` (:128) doesn't mention that any token unlocks the full view (#6); `GET /ats/candidates` "Banned candidates are hidden unless asked; eligibilityStatus=permanently_ineligible is admin-only" (:105) — `includeIneligible` bypass (#12); webhooks "Svix signature checked when RESEND_WEBHOOK_SECRET is set" (:360) documents the fail-open behaviour (#5).

---

### 2 (continued). Detailed per-file notes (reading order)

#### app.ts / middleware

- app.ts:58 trust proxy 1; app.ts:60 helmet; app.ts:61-66 CORS limited to ATS_FRONTEND_URL + CRM_FRONTEND_URL, credentials.
- app.ts:72-80 express.json with raw-body capture only for `/api/webhooks/resend` (Svix signature).
- app.ts:101-117 rate limiting ONLY in production: 100 req/15min on all /api (incl. webhooks) and 10/15min on /api/v1/auth (incl. refresh-token, logout, me-type calls).
- Mounts app.ts:120-155 (see section 7).
- app.ts:149 reportsRouter mounted twice (/api/v1/crm/reports and /api/v1/reports).
- app.ts:172-180 connectDB().then(seedEmailTemplates).catch(log 'companySize migration failed') — misleading message; startBackgroundJobs() runs without awaiting DB despite comment "Connect first, then start background jobs"; server listens even if DB connect fails.
- authenticate.ts:7-40: stateless JWT verify; req.user built from token claims (roles, appAccess, permissions, candidateRef, clientRef). No DB lookup → deactivated/deleted users and permission changes keep working until access token expiry.
- authorize.ts:11-28 requireRoles (admin bypass); :39-62 hasPermission hierarchy manage>write>read, schedule>write>read; :64 requirePermission; :77 requireAppAccess (admin bypass).
- errorHandler.ts:6-47: AppError, mongoose ValidationError (400, raw err.errors as details), 11000 → 409 DUPLICATE_KEY with keyValue (leaks field values), CastError 400, JWT errors; everything else 500 + Sentry. Multer errors other than LIMIT_FILE_SIZE (LIMIT_UNEXPECTED_FILE, LIMIT_FILE_COUNT) fall through to 500 (upload.ts:32-39, 104-111).
- optionalAuthenticate.ts:12-23: no header → anonymous; header → full authenticate (401 on bad token).
- upload.ts: memoryStorage; uploadResume (pdf/docx, 5MB, fields resume|file → req.file) :7-54; uploadResumeWithPortfolio (10MB per file incl. resume, so resume limit differs: 10MB vs doc says 5MB) :64-125; uploadAvatar(field avatar) :127, uploadLogo(field logo) :158, uploadUserAvatarFile(field file) :189 — three near-identical copies. MIME checks trust client-declared mimetype only.

#### activity-logs

- routes: authenticate + requireAppAccess('ats') (activityLog.routes.ts:48-52). GET / requires activityLogs.read (:54). GET /:resourceType/:resourceId → canReadRecordLogs (:28-46): activityLogs.read OR mapped record permission (candidate/application→candidates.read, interview→interviews.read, job→jobs.read, client→clients.read).
- controller: Number() on page/limit with no validation (activityLog.controller.ts:15-16, 38-39) → NaN/negative/huge limit flow into skip/limit (service :58, :101).
- service: createLog swallows errors (activityLog.service.ts:8-26) — fire-and-forget audit log; getAllLogs default limit 50, no cap; getResourceLogs includeRelated uses $or on relatedType/relatedId (:93-100) — no index on {relatedType, relatedId} (model :37-40) → collection scan.
- model: action, resourceType (String, no enum), resourceId ObjectId (no ref), relatedType, relatedId, description, metadata Mixed, performedBy ref User; timestamps; indexes (resourceType,resourceId,createdAt), (performedBy,createdAt), (action,createdAt), (createdAt).
- performedBy never populated → clients get raw IDs (service :60, :103).
- types: ActivityLogResourceType list & ActivityAction union (activityLog.types.ts:1-103) are TS-only; schema has no enum (model :16-17).

#### shared validators / response (context)

- common.validator.ts:31-49 `validate(schema, source)` zod safeParse → 400 VALIDATION_ERROR with [{field,message}], replaces req[source] with parsed data (z.object strips unknown keys). paginationSchema caps limit 100 (:21-24) but most controllers don't use it.
- Express ^4.18 (package.json:35) → default `qs` extended query parser, so `?phase[$ne]=x` yields objects; many services put raw req.query strings straight into Mongo filters (operator injection on String fields; ObjectId fields CastError). Mongoose ^8, zod ^3.22, resend ^6.4.0-canary.0 (a canary release pinned in prod deps, package.json:45).
- response.ts:10-40 envelope `{success,data,message,meta?}` / `{success:false,error:{code,message,details?}}`.

#### applications

- Routes (application.routes.ts): authenticate + requireAppAccess('ats') (:54-55).
  - GET / candidates.read (:57); GET /:id candidates.read (:59)
  - PATCH /:id/approve candidates.write (:61-65, no body validation)
  - PATCH /:id/reject candidates.write + rejectSchema {reason?, rejectionReasonId?, destination?, internalNotes?} (:37-42, :67-72)
  - PATCH /:id/move-to-talent-pool candidates.write {notes≤2000} (:44-46, :74-79)
  - PATCH /:id/stage candidates.write {stageId} (:81-86)
  - PATCH /:id/hire candidates.write (:88-92) — hiring guarded only by candidates.write
  - PATCH /:id/notes candidates.write {notes:string} unbounded (:48-50, :94-99)
  - nested interviews: GET/POST /:applicationId/interviews, GET/PATCH/DELETE /:applicationId/interviews/:id, POST .../:id/feedback with interviews.read/write (:103-140) delegating to interview.controller.
- Controller: thin; logger.info on every list call (application.controller.ts:12-19, :30-32) — noisy; Number(page/limit) unvalidated, no cap (:26-27).
- Model (application.model.ts): candidateId→Candidate, jobId→Job, clientId→Client (required); phase enum pending|approved|hired|rejected (:94-98); currentStage/lastStage subdoc {stageId, stageName, assignedAt, assignedBy→User} (:50-58); source enum direct_apply|internal_upload|assigned (:102-106); aiValidation {isValid, score 0-100, reason, completedAt}; aiScore {score, recommendation enum poor_fit|moderate_fit|good_fit|strong_fit, summary, strengths, concerns}; approved*/rejected*/rejectionReason; disposition fields closedAt/closedBy/dispositionDate/dispositionReasonId→DispositionReason/dispositionDestination enum/internalNotes/isBlocked; interviewIds→Interview[]; notes; hired\*; appliedAt; createdBy/updatedBy. Indexes :149-158 incl UNIQUE (candidateId, jobId); {jobId} is redundant with {jobId, phase}; {candidateId} covered by unique. toSafeObject stringifies ids.
- Service (application.service.ts):
  - getAllApplications :26-56 raw filters, default limit 20, no cap, no populate.
  - createApplication :91-265 — blocks if job closed for direct_apply (:107-113); unique per (candidate, job) with reopen exception when existing phase rejected && closedAt null && source assigned (:124-136); non-direct sources require pipeline and go straight to `approved` first stage (:153-173); updates candidate status to approved unless hired (:204-223); runResumeValidation for direct_apply (:225-227); runResumeParsing if parsedData hollow (:231-241); log applied/ineligible_reapply_blocked; emit application:created|updated.
  - approveApplication :267-344 — only phase pending; requires pipeline; optional startStageId (silently falls back to first stage if not found :298-303); runCandidateScoring (AI) fire-and-forget; candidate status → approved; log + emits application:updated & application:phaseChanged.
  - rejectApplication :346-519 — counts other live apps → isFinalReject (:369-374); reason resolved/validated (active, requireInternalNotes) (:387-425); destination only on final reject and only when reasonId given, permanently_ineligible category forces ban (:418-424); stores lastStage, phase rejected; disposition payload only when destination (:441-448); candidate side effects updateTalentPool / updateCandidateEligibility (:476-494); logs rejected|job_changed and disposition.
  - moveToTalentPool :529-557 — reuses rejectApplication with isJobMove (phase becomes 'rejected'), then pools candidate unless already pooled/banned.
  - moveStage :559-606 — approved only; stage must exist in job.pipeline (no isActive check).
  - hireApplication :608-677 — approved → hired; candidate status hired; provisionVA + sendTeamMemberInvite (email, fire-and-forget, console.error) ; log + emits.
  - updateApplicationNotes :679-705; updateApplicationAiScore :707-738; updateAiValidation :740-780 (called from background jobs).
  - removeApplicationById :86-89 compensating delete (used by change-job rollback).

#### interviews

- Routes (interview.routes.ts): authenticate + requireAppAccess('ats') (:24-25). GET / interviews.read (:27); POST / interviews.write + createInterviewSchema (:29-34); GET /:id interviews.read (:36); PATCH /:id interviews.write + updateInterviewSchema (:38-43); DELETE /:id interviews.write → cancel (:45-49); POST /:id/feedback interviews.write + feedbackSchema (:51-56). Nested duplicates in application.routes.ts:103-140.
- Schemas (interview.schemas.ts): INTERVIEW_TYPES zoom|google_meet|phone_call|in_person (:18-23); meetingLink url|'' ≤2000 (:35-38) — `z.string().url()` accepts any scheme (javascript:, data:) unlike httpUrlSchema in common.validator.ts:14-19; meetingDetails {link, phoneNumber≤50, address≤500}; create {applicationId, candidateId, jobId, clientId, title≤200, type, scheduledAt ISO datetime, interviewerIds?, meetingDetails?} (:56-66) — ids are `z.string().min(1)` not objectIdSchema; nested create {title, type, jobId?, scheduledAt, interviewerIds?, meetingDetails?} (:68-75); update all optional + status enum incl cancelled (:77-84); feedback {rating int 1-5, notes string (no max), recommendation enum} (:86-90).
- Controller (interview.controller.ts): flat create spreads body + organizerId (:48-58); nested create derives candidateId/clientId from Application, optional jobId override derives clientId from Job (:125-160). Nested GET/PATCH/DELETE/feedback (`/:applicationId/interviews/:id`) ignore `:applicationId` entirely (use getInterviewById/updateInterview etc. by :id only) (:40-96) → path's applicationId is not validated against interview.applicationId.
- Model (interview.model.ts): applicationId→Application, candidateId→Candidate, jobId→Job, clientId→Client (all required); title; type enum; legacy interviewType enum INTERVIEW_MEETING_TYPES default initial_screening (:84-88) and round (:94) — dead fields; status enum scheduled|completed|cancelled|no_show; scheduledAt; duration (required); timezone (required); meetingDetails {link, meetingId, password, phoneNumber, address}; interviewerIds→User[]; feedbacks [{interviewerId→User, rating 1-5, notes, recommendation enum, submittedAt}] (subdocs have \_id); organizerId→User; reminderSent. Indexes candidateId, applicationId, jobId, status, interviewerIds, scheduledAt(-1) (:124-129). No compound (status, interviewerIds, scheduledAt) for the conflict query.
- Service (interview.service.ts):
  - INTERVIEW_DURATION_MINUTES = 60 (:42). attachInterviewerNames / Bulk resolve names via User.find (:57-107).
  - findConflicts/assertNoConflicts (:123-211): only status scheduled; window widened by 480min; 409 INTERVIEW_CONFLICT with names + time; not atomic (race between check and create).
  - getAllInterviews (:213-260) raw filters, default 20, no cap, sort scheduledAt desc.
  - createInterview (:269-393): interviewerIds default [organizer]; company timezone from settings; conflict check; zoom → createZoomMeeting BEFORE Interview.create (:297-316) (orphan Zoom meeting if create fails); google_meet manual link; phone_call phoneNumber; in_person address. `new mongoose.Types.ObjectId(x)` on unvalidated strings (:345-355) → BSONError → 500 instead of 400. No existence/consistency check of applicationId/candidateId/jobId/clientId on the flat route, no application phase check, no past-date check, interviewers not verified as existing users. Logs interview_scheduled under application, $push into Application.interviewIds, emails (fire-and-forget), emit `interview:created` to 'applications' room (payload incl. Zoom password).
  - updateInterview (:395-567): blocks completed/cancelled; status only scheduled→completed|no_show; cancelled rejected; title/type change; interviewer list resolved (empty → organizer); reschedule triggers conflict check and Zoom/Meet update (fire-and-forget). Changing `type` (e.g. zoom→phone_call or phone_call→zoom) does not create/delete Zoom meeting or reset meetingDetails (:441-444). meetingDetails edits ignored when stored meetingDetails is null (:510); "Meeting details updated" pushed whenever meetingDetails key is present even if values unchanged (:510-526) → spurious update emails to candidate + interviewers. Google Meet meetingId is never set (manual links), so updateGoogleMeetMeeting/deleteGoogleMeetMeeting branches (:489-500, :590-592) are effectively dead.
  - cancelInterview (:569-615): only blocks already-cancelled (error code INTERVIEW_ALREADY_COMPLETED misleading :578-582); completed / no_show interviews can be cancelled and trigger cancellation emails; deletes Zoom meeting.
  - submitFeedback (:617-672): only assigned interviewer, once; no status check (feedback allowed on scheduled/cancelled interviews).
- interviewEmail.service.ts (670 lines): hand-built HTML emails (not the email-templates feature) sent via shared/utils/email sendEmail: candidate invitation/update/cancellation (:169-338), interviewer invitation/update/cancellation (:352-496), orchestration (:558-670) sequential sends, errors swallowed/logged. Raw interpolation of user-controlled strings into HTML: meeting link into href (:73), address/phone (:88, :93), candidateName (:190, :374 — applicant-controlled via public apply form), interview.title (:198), jobTitle, change strings (:257, :416). → HTML injection in outbound emails. companyName from env.COMPANY_NAME (:550). Footer says "Please do not reply" (:141) while the emails feature ingests inbound replies — inconsistent. Organizer who is defaulted as interviewer receives "You have been assigned" email. No calendar (.ics) attachment. fallbackTimezone module-level mutable (:14-23).

#### auth

- Routes (auth.routes.ts), mounted /api/v1/auth (app.ts:124): POST /login validate {email, password, app?} (:9-13, :38); POST /logout authenticate (:39); POST /refresh-token (no validation, cookie) (:40); POST /forgot-password {email} (:15-17, :41-45); POST /reset-password {token, password≥8} (:46-50); POST /change-password authenticate {currentPassword, newPassword≥8} (:51-56); POST /verify-email {token} (:57-61); POST /set-password {token, password≥8} (:62-66). Production: 10 req/15min limiter on whole router (app.ts:110-116) — includes /refresh-token, so normal multi-tab refresh traffic counts against login limit (inferred risk of lockout).
- Controller (auth.controller.ts): login sets httpOnly cookie refreshTokenAts|refreshTokenCrm, secure+sameSite=none in prod, lax in dev, 7d (:13-20); logout reads app from query/body (unvalidated cast) clears one or both cookies (:24-37); refresh reads app (default ats) and cookie (:39-51); clearCookie called without the same secure/sameSite options used when setting (:29-34).
- Service (auth.service.ts):
  - login (:28-96): lookup by lowercased email; inactive check BEFORE password compare (:41-44) → reveals account existence/state with any password (USER_INACTIVE vs AUTH_INVALID_CREDENTIALS); unknown email path skips bcrypt (timing oracle). Does NOT check user.appAccess includes requested app — any user can obtain an ATS or CRM refresh cookie (route guards still apply). JWT payload includes roles/appAccess/permissions/candidateRef/clientRef (:56-68). Refresh token = JWT {\_id} stored plaintext in user.refreshTokenAts/Crm (:84-91) → one session per app per user (new login elsewhere invalidates previous device), no rotation on refresh (:114-162). login/login_failed activity logs with IP (:12-26).
  - refreshToken (:114-162): verifies JWT, checks isActive and equality with stored token, re-issues access token with fresh roles/permissions.
  - forgotPassword (:164-240): silently returns for unknown/inactive; reset token stored plaintext (:168-171), 1h; awaited sendEmail — a Resend failure throws → 500 only for existing accounts (enumeration via error) (inferred from no try/catch :174). Hard-coded "Arista ATS" branding (:176, :191, :199, :229) vs env.COMPANY_NAME used elsewhere; always links to ATS `/ats/reset-password` even for CRM-only users (:173).
  - resetPassword (:242-286): accepts reset token OR invite token; invite re-activates; sets emailVerified + isInviteAccepted true even for plain reset; clears refresh tokens.
  - changePassword (:288-318) clears both refresh tokens (current session's access token remains valid until expiry).
  - verifyEmail (:320-338) marks isInviteAccepted=true without password being set; token not consumed.
  - setPassword (:340-367): activates user, clears invite token; does NOT clear refresh tokens or passwordResetToken.
- types: LoginInput, AuthTokenPayload (auth.types.ts:1-18).

#### users (mounted /api/v1/shared/users, app.ts:120)

- Routes (user.routes.ts): authenticate only — no requireAppAccess (:84). PATCH /me {firstName≤50,lastName≤50,phone} (:66-70, :87); POST /me/avatar uploadUserAvatarFile (field `file`) (:88); GET /crm-accounts (any auth) (:92); GET / team.read (:95); POST / team.write createUserSchema (:24-43, :96-101); GET /:id team.read (:102); PATCH /:id team.write updateUserSchema {firstName, lastName, phone, roles, isActive} (:45-64, :103-108); DELETE /:id team.manage (:109); PATCH /:id/permissions team.manage `z.record(z.record(z.boolean()))` (:72-74, :110-115); POST /provision-client team.write {clientId} (:118-123); POST /provision-va team.write {candidateId} (:124-129); POST /:id/revoke-crm team.manage (:130-134). Role enum list duplicated 4x (user.routes.ts:31-40, :51-60, user.model.ts:14-23, user.types.ts:1-9).
- Controller (user.controller.ts): assertCanAssignRoles (only admin grants admin) (:22-30); assertCanManageTarget (non-admin can't touch admin targets) (:33-46) — but nothing stops a non-admin with team.manage/team.write from editing THEMSELVES (own permissions via PATCH /:id/permissions, own roles via PATCH /:id) → self privilege escalation (any non-admin role set, any permission flag). getAllUsers normalises page/limit (:61-69) — the only controller that does. getCrmAccountsList (:99-155): admin all, AM scoped by Assignment.accountManagerId, others empty; unpaginated. createUser returns `inviteToken` in the response body (:189-194) and sends invite (CRM-only → `${CRM_FRONTEND_URL}/accept-invitation?token=`, else default ATS `/ats/verify-email/:token`) (:170-187). deactivateUser (:213-229) → service hard-deletes. uploadAvatar (:245-270): Cloudinary 'avatars' upload; old avatar deletion via regex publicId, not awaited (:256-262); then updateUser(...) which logs an 'updated' entry. provisionClient (:279-335) uses primary contact or client.email; provisionVA (:342-387).
- Model (user.model.ts): firstName, lastName, email (unique, lowercase), phone, avatar, roles enum[], appAccess enum[], permissions subdoc of resourcePerm {read, write, manage, schedule, approve} for candidates, jobs, interviews, interviewScorecards, clients, emails, tags, settings, dashboard, team, pipelineTemplates, emailTemplates, activityLogs, assignments, reports, eod, performanceReview (:27-61); isActive, emailVerified, passwordHash, refreshTokenAts/Crm, passwordResetToken/Expires, inviteToken/Expires, isInviteAccepted, lastLoginAts/Crm, clientRef→Client, candidateRef→Candidate, createdBy→User; indexes roles, isActive (:108-109); no index on inviteToken/passwordResetToken/clientRef/candidateRef (queried at auth.service.ts:244-255, :321, user.controller.ts:126-141). toSafeObject strips passwordHash, refresh tokens, passwordResetToken, inviteToken but leaves passwordResetExpires/inviteTokenExpires (:111-125).
- Service (user.service.ts):
  - ATS_ROLES / CRM_ROLES, deriveAppAccess (:20-34); buildPermissionsForRoles role matrix (:36-154): admin all; hiring_manager candidates rwm, jobs rwm, interviews rw, scorecards rw, team r, clients r, emails rw, tags rw, settings r, dashboard r, pipelineTemplates r, emailTemplates r; recruiter candidates rwm, jobs r, interviews rw, scorecards rw, team r, clients r, emails rw, tags r, settings r, dashboard r, pipeline r, emailTemplates r; coordinator candidates rw, jobs r, interviews rw+schedule, ...; interviewer candidates r, interviews rw, scorecards rw, team r, tags r (no jobs.read); account_manager clients rw, dashboard r, activityLogs r, assignments rwm, reports rwm, eod rw+approve, performanceReview rw+approve; client clients r, assignments r, reports r, eod r; va assignments r, eod w.
  - getAllUsers (:156-196) no sort (unstable pagination), limit uncapped.
  - createUser (:204-249): 409 USER_ALREADY_EXISTS; random password hash; invite 24h; log created.
  - sendTeamMemberInvite (:321-358): default URL `${ATS_FRONTEND_URL}/ats/verify-email/${token}`; HTML with raw firstName/invitedBy interpolation (:283, :286, :306); swallows errors; logs recipient email.
  - updateUser (:360-427): roles change rebuilds appAccess+permissions (wipes custom permissions silently :380-383); isActive false clears refresh tokens; logs changes.
  - updatePermissions (:429-466): deep-merge; arbitrary keys accepted by zod, unknown ones dropped silently by schema.
  - deactivateUser (:468-493): HARD DELETE (findByIdAndDelete) despite name/route message "User deactivated" (user.controller.ts:227) → dangling refs in Interview.interviewerIds/organizerId, Assignment.accountManagerId, createdBy fields, activity performedBy.
  - updateMe (:495-527).
  - provisionVA (:529-604) / provisionClient (:606-679): if a User with that email exists and is inactive or lacks crm → re-activates it, adds 'crm' appAccess, sets candidateRef/clientRef, new invite token — WITHOUT adding the va/client role or resetting permissions (:539-566, :616-642). A deactivated staff account (even admin) whose email matches a hired candidate / client contact is re-activated with its old roles/permissions. New VA/client users get createdBy null even when createdBy passed (:590, :666); provisionVA creation log lacks performedBy (:593-599). upsertVaProfile errors swallowed (:556, :601).
  - revokeCrmAccess (:685-707): remove crm, deactivate, clear tokens (also kills ATS access for dual-access users since isActive=false).

#### candidates (mounted /api/v1/ats/candidates)

- Routes (candidate.routes.ts):
  - PUBLIC (before authenticate, :170-216): POST /public/parse uploadResume (no body validation, :177) → extract text + AI parse; POST /public/upload-and-parse uploadResume + publicApplySchema {firstName, lastName, email, phone, videoIntroUrl(http), videoIntroSource, englishProficiency, salaries, reasonForLeaving≤500, cityOfResidence≤100} (:188-216). No dedicated rate-limit/captcha (only the global prod 100/15min) → anonymous AI-cost / CPU abuse of resume parsing.
  - authenticate + requireAppAccess('ats') (:220-221).
  - GET / candidates.read (:223); POST / candidates.write + uploadResume + createCandidateSchema (multipart; parsedData JSON preprocess; tags z.array(z.string()) — a single multipart `tags` field arrives as a string and fails validation; inferred) (:33-98, :225-231); POST /:id/approve candidates.write assignJobSchema {jobId?, startStageId?} (:163-166, :234-239); GET /:id candidates.read (:241); PATCH /:id candidates.write updateCandidateSchema (:100-146, :243-248) — tags are free strings (no objectId check); DELETE /:id candidates.manage (:250-254); POST /:id/avatar candidates.write uploadAvatar(field avatar) (:256-261); PATCH /:id/talent-pool {action add|remove, notes?} (:148-151, :263-268); PATCH /:id/reject `.strict()` {rejectionReasonId, destination?, internalNotes?} (:153-161, :270-275); PATCH /:id/eligibility requireRoles('admin') {eligibilityStatus, reason?} (:277-291); PATCH /:id/restore admin {jobId} (:282-298); PATCH /:id/legal-hold admin {legalHold} (:300-309); POST /:id/assign-job candidates.write assignJobSchema — jobId OPTIONAL although required by logic/doc (:311-316); POST /:id/change-job candidates.write {applicationId, targetJobId, startStageId?} (:318-329).
- Controller (candidate.controller.ts) — significant business logic lives here, not in service:
  - getAllCandidates (:17-85): eligibilityStatus=permanently_ineligible admin-only (:48-57); tags CSV; `includeIneligible=true` is NOT admin-gated (:33-36) → any candidates.read user can list banned candidates mixed in, bypassing the admin-only rule enforced on GET /:id (:93-102) and on `eligibilityStatus` filter.
  - createCandidate (:108-135): extract text, upload to Cloudinary 'resumes' BEFORE duplicate-email check in service (orphan file on 409).
  - uploadAvatar (:161-182): old avatar delete not awaited.
  - assignJob (:218-298): rejects banned candidates; does NOT check job status (draft/closed/on_hold jobs accept assignments, unlike change-job :357-363); getJobById(undefined) when jobId omitted; createApplication(source 'assigned') then optional moveStage; runCandidateScoring (AI); removes from talent pool.
  - changeJob (:308-457): validates ownership, phase, same-job, target open, existing app, pipeline, stage; creates new application first, closes old one via rejectApplication(isJobMove) with compensating delete on failure (:416-426); moveStage; scoring; updateAppliedJob; un-pool. Non-transactional.
  - approveCandidate (:459-546): candidate must be pending and eligible; jobId from body or appliedJobId; createApplication(source 'direct_apply') (→ also triggers runResumeValidation AI) then status approved then approveApplication only when pipeline exists (:524-528) → with no pipeline candidate becomes `approved` with a `pending` application (the "limbo" the comment says it avoids).
  - updateEligibility / restoreCandidate / updateLegalHold (:548-596).
  - publicParse (:598-619) / publicUploadAndParse (:621-661): stateless extract + parseResumeTextWithAI; returns resumeRawText to the anonymous client which is later re-submitted at apply (client-controlled raw text, inferred trust issue — see jobs apply). Logs applicant name+email at info (:629-631) (PII in logs).
- Model (candidate.model.ts): firstName, lastName, email (unique, lowercase), phone, avatar, resumeUrl (required), resumeOriginalName (required), resumeRawText, videoIntroUrl, videoIntroSource enum cloudinary|external, portfolioUrl/FileUrl/FileName, parsedData {summary, skills, languages, certifications, experience[{company,title,duration,description}], education[{institution,degree,field,year}]} (:46-56) — NO yearsOfExperience field although types (candidate.types.ts:16) and zod (candidate.routes.ts:69, :111) accept it → silently stripped on save; aiValidation, aiScore (same shapes as application), appliedJobId (ObjectId, no ref), yearsOfExperience, englishProficiency enum, currentSalaryPHP/USD, reasonForLeaving≤500, cityOfResidence≤100, source enum applied|internal_upload, tags→Tag[], inTalentPool/talentPoolAddedAt/talentPoolNotes, status enum pending|approved|hired, eligibilityStatus enum, permanentlyIneligibleAt/By→User/Reason→DispositionReason, phoneNormalized, legalHold, crmProfile {workloadLevel enum low|medium|high ...} (:82-96; conflicts with va-profiles `low|normal|high|overloaded` in ENDPOINTS.md:333 — likely legacy), createdBy/updatedBy. Indexes status, inTalentPool, eligibilityStatus, phoneNormalized (sparse — but default null so every doc is indexed; non-unique), tags, createdAt, text(firstName,lastName,email) (:191-197). pre('save') normalizes phone (:240-245); normalizePhone keeps last 10 digits (:228-236).
- Service (candidate.service.ts):
  - extractCloudinaryPublicId (:32-51).
  - getAllCandidates (:53-146): $text search (whole-word only; no partial/prefix match); default excludes banned; resolves permanentlyIneligibleReasonLabel; returns full toSafeObject INCLUDING resumeRawText for every row (getCandidateById strips it :157) → large payloads, inconsistent.
  - canApplicantUpdateProfile (:176-186), findExistingApplicant (:189-199), findOrCreateCandidate (:266-344): public apply matches by email, then by normalized phone; an existing pending, non-pipeline candidate is refreshed with the new resume/portfolio/parsedData and the old Cloudinary files deleted (:233-258). No ownership proof → anyone who knows a pending applicant's email (or phone) can overwrite their resume/profile and delete their files (security; unauthenticated). Phone-only match attaches a different email's application to another person's record.
  - createCandidate (:346-410) 409 on dup email; status approved for internal_upload; runResumeParsing if no parsedData; tags `new ObjectId(t)` unvalidated → 500 on bad tag id (:384, :311, :529).
  - updateCandidate (:412-574) field-by-field with change log; appliedJobId supported internally.
  - deleteCandidate (:576-726): legal hold 409; only permanently_ineligible; only admin (route needs candidates.manage too); deletes Cloudinary resume/portfolio/avatar then Application, Interview, InterviewScorecard, Assignment, WorkEntry, EodSubmission, EodReminder, PerformanceReview, Email(context.candidateId), ActivityLog (resource/related candidate) sequentially, no transaction; leaves VA User (candidateRef dangling), VaProfile and interview-related activity rows (resourceType application/relatedType interview) behind (inferred).
  - updateTalentPool (:728-760).
  - rejectCandidate (:776-892): pending only; reason active; requireInternalNotes; destination forced by reason category; refuses when live application exists (409); sets ban or pool; logs rejected.
  - updateCandidateStatus (:894-931) no-op guard; emits candidate:updated + candidate:statusChanged.
  - updateParsedData (:933-973), updateAiScore (:975-997), updateAiValidation (:999-1028) — background-job writers.
  - updateAppliedJob (:1037-1063), restoreCandidate (:1074-1141): 409 if any application exists for that job; resets to pending.
  - updateCandidateEligibility (:1143-1188): `reason` (free-text from PATCH /:id/eligibility zod `z.string()`) is cast with `new mongoose.Types.ObjectId(reason)` (:1161-1163) → any non-ObjectId reason → BSONError 500. Banning via this route doesn't clear talent pool or close live applications (unlike rejectCandidate :859-867); un-banning doesn't reset status/appliedJobId (unlike restore).
  - updateCandidateLegalHold (:1190-1213).
  - All writes emit full candidate (incl. resumeRawText, salaries, banned candidates) to the 'candidates' socket room (e.g. :342, :572, :1186) — REST hides banned candidates from non-admins but sockets don't (inferred; depends on sockets room auth, out of scope).

#### jobs (mounted /api/v1/ats/jobs)

- Routes (job.routes.ts):
  - PUBLIC: GET / optionalAuthenticate + validate(listJobsQuerySchema,'query') {clientId?, status?(any string), search?, page, limit≤10000} (:189-206); GET /:id optionalAuthenticate (:207); POST /:id/apply uploadResumeWithPortfolio + applyToJobSchema (:119-185, :208-213).
  - authenticate + requireAppAccess('ats') (:215-216); POST / jobs.write createJobSchema (:54-72, :218-223); POST /generate-draft jobs.write {notes 10–20000} (:84-86, :228-233); POST /standardize jobs.write (lists ≤60×1000) (:94-112, :237-242); PATCH /:id jobs.write updateJobSchema = create minus clientId, partial (:74, :244-249); DELETE /:id jobs.manage (:251); PATCH /:id/status jobs.write {status enum incl draft} (:76-78, :253-258); PATCH /:id/pipeline jobs.write {templateId, stageMapping?} (:114-117, :260-265).
  - `stageSchema` (:42-52) is defined but never used (dead code). salaryRange has no min≤max refine (:28-40). createJobSchema has no `pipelineTemplateId`, so the service's explicit-template branch (job.service.ts:74-85) is unreachable (zod strips it). applyToJobSchema accepts `coverLetter` (:143) and `resumeOriginalName`, never stored / overridden.
- job.public.ts:8-26 toPublicJob whitelist (no clientId, pipeline, tags, priority, createdBy, startDate).
- Controller (job.controller.ts):
  - getAllJobs (:19-46): anonymous → status forced 'open', clientId ignored, public fields. ANY valid token (no permission or appAccess check — router-level guards come after these routes) gets full internal job objects for all clients incl. pipeline, clientId, priority, tags: e.g. CRM-only VA/client users and ATS interviewers (who lack jobs.read, user.service.ts:120-126).
  - getJobById (:48-60): anonymous: draft → 404, closed/on_hold visible; token → full job (same no-permission issue).
  - createJob/updateJob/deleteJob/updateJobStatus/assignPipeline thin (:62-102). generateDraft / standardizeContent (:104-115) AI.
  - applyToJob (:117-319): job must be open (applicationDeadline NOT enforced); resume required; findExistingApplicant → refreshProfile; if refreshing: resumeRawText = client-supplied `body.resumeRawText` if non-empty, else server extraction (:154-157) → applicant can submit text unrelated to the uploaded file, which feeds AI validation/parsing/scoring; Cloudinary upload resumes/portfolios (:158-170); findOrCreateCandidate; banned → logs ineligible_reapply_blocked and returns {candidateId, blocked:true} (:208-227) — reveals ban status and internal candidateId to anonymous caller; runResumeParsing if no parsedData; updateCandidate(appliedJobId=jobId) for refreshable candidates (:245-251) — overwrites the previous appliedJobId (the comment in candidate.service.ts:254-257 says it's only set when missing); runCandidacyValidation (AI). For a non-refreshable existing candidate (approved/hired/in pipeline) nothing about this job is recorded at all, yet the response says "Application received" and the confirmation email is still sent (:257-303) → silent loss of the application to job B (business ambiguity). Confirmation email: settings.applicationConfirmation {enabled, templateId} → EmailTemplate → emails.service.sendEmail with variables (candidateName etc.) and companyName = settings.email.fromName (:258-303).
- Model (job.model.ts): title, description, clientId→Client (req), status enum draft|open|on_hold|closed default draft, jobType enum, locationType enum, location, experienceLevel enum, priority enum default medium, openings≥1, requirements/responsibilities/skills/benefits [String], tags [ObjectId] ref Tag, salaryRange {min,max,currency,period enum}, pipeline {templateId→PipelineTemplate, stages[{_id, name, color, order, isActive, icon}]}, applicationDeadline, startDate, createdBy/updatedBy (:47-107). Indexes clientId (redundant with clientId+status), status, (clientId,status), text(title) (:109-112).
- Service (job.service.ts):
  - ALLOWED_TRANSITIONS draft→open, open→on_hold|closed, on_hold→open|closed, closed final (:17-22).
  - getAllJobs (:24-57): no sort → unstable pagination order; $text on title only.
  - createJob (:65-130): client must exist; default pipeline template required (422 PIPELINE_REQUIRED); copies stages with new ids; sanitizeJobDescription; status draft; emits job:created.
  - updateJob (:132-202): generic loop over input keys with change log; description sanitized; tags not ObjectId-validated (Cast error → 400).
  - deleteJob (:204-234): blocks pending/approved apps; hard delete leaves rejected/hired Applications, Interviews, scorecards, emails pointing at a deleted job (orphans; dashboard/reports may break — inferred).
  - assignPipeline (:236-345): template isActive NOT checked; remaps approved apps by stage name or mapping, fallback first stage; Application.bulkWrite then job.save — not atomic; no socket emit for remapped applications (clients showing the board see stale stage ids until refetch — inferred).
  - updateJobStatus (:347-384): transitions enforced; closing/holding a job leaves live applications untouched.
- jobDraft.service.ts (:161-215): prompt with SYSTEM_RULES + notes; getAiProvider()/withRetry/parseJsonResponse from shared/utils/ai; maxTokens 4000; output sanitised by toStringArray (≤30 items ×300 chars) / title ≤200; 422 AI_EMPTY_DRAFT. Exports toStringArray/toCleanString reused by standardizer.
- jobStandardize.service.ts (:325-407): input ≤60 items, output ≤50 items (:237-242) → silent truncation of up to 10 entries per list; `keep()` falls back to the original list whenever the model returns an empty list (:396-399), which contradicts rule 10 (moving every requirement into skills is exactly the expected result in the worked example, but an emptied list is restored → duplicates reintroduced).

#### clients (mounted /api/v1/ats/clients)

- Routes (client.routes.ts): authenticate + requireAppAccess('ats') (:95-96). GET / clients.read (:98); POST / clients.write createClientSchema {companyName≤100, email, phone, website http(s)|'', industry, companySize enum, description, address{...}, tags} (:31-51, :100-105); GET /:id clients.read (:107); PATCH /:id clients.write updateClientSchema (+status) (:53-56, :109-114); DELETE /:id clients.manage (:116); POST /:id/logo clients.write uploadLogo(field logo) (:118-123); POST /:id/contacts, PATCH/DELETE /:id/contacts/:contactId clients.write (:58-66, :125-143); PATCH /:id/crm-profile clients.write updateCrmProfileSchema (healthStatus, baaSign|baaSigned, dates, satisfactionScore 1-5, accountOwnerId, …) (:75-91, :145-150) — on the ATS-gated router so account managers (CRM-only) cannot use it; GET/POST/PATCH/DELETE /:clientId/notes requireRoles('admin') (:152-178) — comment calls these "CRM-internal admin notes" but they sit behind requireAppAccess('ats').
- Controller (client.controller.ts): thin; uploadLogo (:62-82) uploads to Cloudinary 'logos', awaits deletion of the old one, then updateClient({logo}).
- Model (client.model.ts): COMPANY_SIZE_ENUM + typo map + normalizeCompanySize (:3-54); addressSchema; contactSchema {name, email, phone, position, isPrimary} (subdoc \_id); noteSchema {method enum, content, author→User, timestamps} (:83-98); crmProfileSchema {healthStatus enum green|yellow|red, baaSign, baaSignedDate, emrSystem, onboardingComplete, sopReceived, satisfactionScore 1-5, openIssuesCount, lastClientCheckin, notes, accountOwnerId→User, serviceStartDate, primaryContact, secondaryContact} (:100-122); client {companyName, email (lowercase, NOT unique — ENDPOINTS.md:85 says unique), phone, website, logo, industry, companySize enum default '1-10', status enum active|inactive|suspended, description, address, contacts[], notes[], tags→Tag[], crmProfile, createdBy/updatedBy} (:124-152). Indexes text(companyName), status (:154-155) — no email index though createClient queries by email. pre('save') & pre('findOneAndUpdate') companySize "self-healing" (:162-220): an unrecognised value is silently replaced by '1-10' (comment at :174-175 says "unset") → silent data corruption. toSafeObject returns `notes` (:233-240).
- Service (client.service.ts):
  - getAllClients (:18-49) no sort; $text search; raw status filter.
  - getClientById (:51-55) / getAllClients return the full embedded `notes[]` (admin-only CRM notes) to every clients.read holder (recruiter, hiring_manager, coordinator) and broadcast them in every `client:*` socket emit (:91, :204, :243, :319, :350, :555) → bypasses the requireRoles('admin') guard on /:clientId/notes.
  - createClient (:57-93) app-level email uniqueness only (race; updateClient :116-121 doesn't check at all) ; tags `new ObjectId` unvalidated.
  - updateClient (:95-206) field diff log; address merge.
  - addContact/updateContact/removeContact (:208-352) — single primary enforced; removing the primary leaves none.
  - deleteClient (:354-384): only blocks open/on_hold jobs; hard delete leaves draft/closed jobs, applications, interviews, CRM assignments and provisioned client Users (clientRef) dangling.
  - updateCrmProfile (:386-557): initialises profile; accountOwnerId `new ObjectId` unvalidated (500 on bad id), not checked to be a user; always logs crm_profile_updated even with no changes (:546-552).
  - listNotes/addNote/updateNote/deleteNote (:563-677): addNote pushes a plain object then returns `String(saved._id)`, `saved.createdAt` from that same plain object (:581-610) — Mongoose casts pushed values into a NEW subdocument, so the original object has no \_id/timestamps → API returns `_id: "undefined"` and undefined dates (inferred from Mongoose DocumentArray semantics; should read `client.notes[client.notes.length-1]`).

#### dashboard/ats (mounted /api/v1/ats/dashboard)

- atsDashboard.routes.ts:9-14 authenticate + ats + GET / dashboard.read. Controller atsDashboard.controller.ts:5-8.
- atsDashboard.service.ts:7-117: 14 parallel counts (candidates excl. banned, jobs, clients, applications by phase, interviews by status); recentApplications = 10 newest Application docs as raw `.lean()` (ObjectIds, no candidate/job names, not toSafeObject — inconsistent with every other endpoint) (:51-54); upcomingInterviews 10 raw lean docs (incl. meetingDetails.password) (:57-63); per open/on_hold job: 4 countDocuments + Client.findById each (:69-92) → 5N queries (N+1; should be one aggregation). `activeCandidates` duplicates approvedCandidates (:108). No caching.

#### disposition-reasons (mounted /api/v1/ats/disposition-reasons)

- Routes (dispositionReason.routes.ts): authenticate + ats (:64-65). GET /active candidates.read (:70-74); GET / settings.read (:77); GET /:id settings.read (:79); POST / settings.write createReasonSchema {label≤200, category enum(7), isActive, order≥0, applicableStages[], defaultEligibility, requireInternalNotes} (:20-36, :83-88); PATCH /:id settings.write (:38-56, :90-95); PATCH /:id/deactivate (:97-101); PATCH /:id/reorder {order} (:58-60, :103-108); DELETE /:id settings.write (:112). Category enum duplicated 3x (routes :22-30, :40-49, model :18-26, types :1-8).
- Model (dispositionReason.model.ts:13-42): label, category enum, isActive, order, applicableStages [String] (free-text stage NAMES — tied to per-job stage names, so renaming a stage silently detaches reasons), defaultEligibility enum, requireInternalNotes, createdBy/updatedBy; indexes isActive, (category, order). No uniqueness on label.
- Controller thin (dispositionReason.controller.ts:6-77).
- Service (dispositionReason.service.ts): listReasons sorted (category, order) (:13-25); getActiveReasons filters applicableStages in JS (:27-44); createReason forces defaultEligibility=permanently_ineligible for that category (:59-85); updateReason (:87-131) — setting category to permanently_ineligible_reasons and `defaultEligibility:'eligible'` in the same PATCH ends with an "eligible" reason in the ineligible category (:100-112), and moving a reason OUT of that category keeps the ban default; deactivate (:133-160); reorder (:162-182) — no activity log, no re-sequencing of siblings; deleteReason (:197-235) usage = Application.dispositionReasonId + Candidate.permanentlyIneligibleReason only — reasons used on non-final application rejects or In-Review → talent-pool rejects are stored only as label / log metadata, so they count as "unused" and can be deleted. Activity logs use resourceType 'settings' for reasons.

#### email-templates (mounted /api/v1/ats/email-templates)

- Routes (emailTemplate.routes.ts): authenticate + ats (:52-53). GET / emailTemplates.read (:55-59); POST / emailTemplates.write createTemplateSchema {name≤100, subject≤200, bodyHtml, bodyText, type enum(8), variables enum[]?, isDefault?} (:13-46, :61-66); GET /:id read (:68-72); PATCH /:id write (+isActive) (:48-50, :74-79); DELETE /:id write (not manage) (:81-85). Type enum includes CRM types eod_reminder/survey_reminder although the router is ATS-gated.
- Model (emailTemplate.model.ts:12-43): name (unique), subject, bodyHtml, bodyText, type enum, variables [String] enum SYSTEM_VARIABLES, isDefault, isActive, createdBy/updatedBy; indexes type, isActive. "One default per type" only enforced in service (no partial unique index).
- Controller thin (emailTemplate.controller.ts:6-53).
- Service (emailTemplate.service.ts): getAll sorted createdAt desc (:11-20); createTemplate un-defaults others of same type then saves (not atomic) (:34-66); updateTemplate (:68-144) — a default template can be deactivated (isActive:false) leaving the type with an inactive default; deleteTemplate (:146-168) hard delete with no check against Settings.applicationConfirmation.templateId (job.controller.ts:261-265 then silently skips confirmation emails) or Email.templateId refs. Emits to 'email-templates' room. Interview emails (interviewEmail.service.ts) and invite/reset emails are hard-coded HTML and ignore these templates (the `interview` template type is never used by server-side sends — inferred from grep of call sites in scope: only application_confirmation is consumed, job.controller.ts:264).

#### emails (mounted /api/v1/ats/emails)

- Routes (email.routes.ts): authenticate + ats (:43-44). GET / emails.read (:46); POST / emails.write sendEmailSchema {to[] email ≥1, cc?, bcc?, subject≤200, bodyHtml, bodyText?, templateId?, context{type, candidateId, applicationId, jobId, interviewId}?, inReplyTo?, threadId?, variables record?} (:19-39, :48-53) — any emails.write holder (recruiter, coordinator, hiring_manager) can send arbitrary HTML to arbitrary external addresses from the company sender, not restricted to candidate addresses; no rate limit. GET /thread/:threadId (:55-59); GET /:id (:61); PATCH /:id/read uses emails.read for a write (:63); DELETE /:id emails.write (:65); POST /:id/resend emails.write (:67).
- Model (email.model.ts): direction enum outbound|inbound, from, to[], cc[], bcc[], subject, bodyHtml, bodyText, status enum pending|sent|delivered|delayed|failed|bounced|complained|received, threadId, inReplyTo, messageId, templateId→EmailTemplate, context {type default general, candidateId→Candidate, applicationId→Application, jobId→Job, interviewId→Interview}, resendId, deliveredAt, failedAt, failureReason, attachments[{filename,url,contentType,size}], sentBy→User, sentAt, receivedAt, openedAt, clickedAt, bouncedAt, openCount, clickCount, isRead (:51-104); indexes context.candidateId/applicationId/jobId, threadId, messageId, resendId, status, createdAt (:106-113).
- Controller (email.controller.ts): page/limit via `page ? Number(page)` (:25-26); sendEmail returns 201 even on failure (:51-62).
- Service (email.service.ts): getAllEmails raw filters, no cap (:11-47); getEmailThread unpaginated (:55-58); sendEmail (:60-109): substituteVariables on subject + bodyHtml only — NOT on bodyText (:63-66, :78, :95) so `{{candidateName}}` placeholders leak into the plain-text part; variables are substituted without HTML-escaping (shared/utils/email.ts:9-16) → applicant-controlled names inserted raw into HTML; `from` stored as env.COMPANY_EMAIL (:72) while the actual sender comes from settings via getEmailSenderIdentity (shared/utils/email.ts:27-28) → stored From can differ from real From; no Message-ID/In-Reply-To headers are sent, `messageId` never set for outbound (threading relies only on reply-to mailbox + webhook matching); no activity log, no socket emit for sent emails. markEmailAsRead (:111-120); deleteEmail hard delete, no log (:122-125); resendEmail failed-only (:127-163).

#### interview-scorecards (mounted /api/v1/ats/interview-scorecards)

- Routes (interview-scorecard.routes.ts): authenticate + ats (:108-109). POST / interviewScorecards.write createScorecardSchema (candidateId, jobId, interviewerId?, interviewDate ISO, interviewType default initial_screening, 2 comm ratings, experienceSelections enum[], 5 category ratings 1-5 int, 13 booleans, notes strings unbounded, earliestStartDate?, finalRecommendation enum required) (:42-88, :111-116); GET / interviewScorecards.read validate query {candidateId required, page, limit≤100} (:92-96, :118-123) — the only list endpoint besides jobs and users that validates/caps pagination; GET /:id (:125-129); PATCH /:id write updateScorecardSchema = create minus candidateId/jobId (full re-save) (:100-103, :131-136). No DELETE. EXPERIENCE_SELECTIONS/FINAL_RECOMMENDATIONS duplicated in routes (:20-37) and types (interview-scorecard.types.ts:2-21).
- Types: CATEGORY_WEIGHTS communication 30, experience 25, professionalism 15, technology 20, availability 10 (interview-scorecard.types.ts:27-33).
- Model (interview-scorecard.model.ts:23-106): candidateId→Candidate, jobId→Job, interviewerId→User (required), interviewDate, interviewType enum, all inputs (required), computed communicationRating & \*Weighted & overallScore (required), notes, finalRecommendation enum, createdBy. Indexes (candidateId, createdAt), jobId. Not linked to an Interview document (no interviewId) or Application.
- Controller (interview-scorecard.controller.ts:12-30): interviewerId defaults to caller but any user id can be supplied ("log on behalf of") — no check it's an existing/active staff user or that caller may act for them.
- Service (interview-scorecard.service.ts): computeScores pure (communicationRating = round((diction+comprehension)/2); weighted = rating/5×weight; overall rounded 1dp) (:24-69); createScorecard validates candidate+job exist (:76-178); logs under resourceType 'candidate' with generic action 'created' + relatedType 'interview_scorecard' (:161-175) → candidate timeline receives a "created" entry (ambiguous with candidate creation; inferred UI impact); comment says "Activity log + realtime" (:158) but there is no socket emit; header comment (:2-5) is an AI-task artefact ("not in the allowed-edit list ... completion report"). updateScorecard (:225-321): NO ownership check — any interviewScorecards.write holder (incl. `interviewer` role) can overwrite anyone's scorecard and reassign interviewerId; interviewerId cast without validation (:250-253).

#### pipeline-templates (mounted /api/v1/ats/pipeline-templates)

- Routes (pipelineTemplate.routes.ts): authenticate + ats (:50-51). GET / pipelineTemplates.read (:53-57); POST / write createTemplateSchema {name≤100, description, isDefault, stages[{name≤100, color #hex default, order int≥1, isActive, icon enum PIPELINE_STAGE_ICONS (nullish→ClipboardList)}] ≥1} (:20-40, :59-64); GET /:id (:66-70); PATCH /:id write (+isActive) (:42-48, :72-77); DELETE /:id write (:79-83). Stage zod schema duplicated in job.routes.ts:42-52 (with a different icon default handling).
- types (pipelineTemplate.types.ts): PIPELINE_STAGE_ICONS list of lucide icon names (:10-65, missing semicolons — formatting inconsistent with rest of codebase); Create/Update input types omit `icon` (:82-105) though zod accepts it.
- Model (pipelineTemplate.model.ts): stage subdoc {name, color, order, isActive, icon} (:21-27); template {name unique, description, isDefault, isActive, stages[], createdBy, updatedBy} (:29-40); index isActive; partial unique index {isDefault:true} (:45-51) — good DB-level guarantee of ≤1 default.
- Service (pipelineTemplate.service.ts): validateStages ≥1 & unique order (:13-29) — stage NAMES not required unique (job.service.ts assignPipeline maps by lower-cased name, so duplicates collapse); handleDefaultGuardError maps E11000 → 409 (:38-52) — but `name` is also unique, so a duplicate NAME is misreported as "Another pipeline template is already marked as default" (:41-50 catches any 11000/11001) (bug). createTemplate rejects a second default (:77-117). updateTemplate (:119-221): cannot deactivate default; marking default requires none other exists → switching default needs two calls (unset old, set new) with a window where there is no default and POST /jobs fails with 422 PIPELINE_REQUIRED (job.service.ts:86-96); a PATCH {isDefault:false} on the current default is accepted with no replacement → system left with no default. Stage edits replace subdocs (new \_ids every save). deleteTemplate (:223-263): refuses if ANY job (incl. closed/deleted-pipeline history) references it, or if default.

#### settings (mounted /api/v1/shared/settings)

- Routes (settings.routes.ts): authenticate only (no app check) (:52); GET / settings.read (:54); PATCH / settings.write updateSettingsSchema {email{fromEmail must equal env.COMPANY_EMAIL, fromName≤100}, ai{provider claude|openai, resumeValidation, candidateScoring, resumeParsing}, companyTimezone (IANA via isValidTimeZone), applicationConfirmation{enabled, templateId nullable}} (:12-50, :55-60).
- Model (settings.model.ts): email {fromEmail default DEFAULT_FROM_EMAIL='apply@ats.aristagroups.com', fromName default 'Arista ATS' (shared/utils/emailSenderDefaults.ts:12-13)}, ai {provider default claude, 3 toggles default true}, applicationConfirmation {enabled false, templateId→EmailTemplate}, companyTimezone (validated) (:17-66); static getSettings = findOneAndUpdate({}, {$setOnInsert:{}}, upsert) (:74-82) — singleton not enforced by a unique key (concurrent first calls could create two docs; inferred, low).
- Service (settings.service.ts): describeSettingsChanges (:11-50); updateSettings (:57-128) — templateId stored without checking it exists, is active, or has type application_confirmation (:94-105); clears in-process caches for email sender / AI provider / timezone (multi-instance deployments keep stale caches up to 60s — inferred from cache comments :71-74, :113); logs settings_updated even with no changes.
- Controller thin (settings.controller.ts:5-16).

#### tags (mounted /api/v1/ats/tags)

- Routes (tag.routes.ts): authenticate + ats (:22-23). GET / tags.read (:25); POST / tags.write {name≤50, color #rrggbb} (:13-18, :27-32); PATCH /:id tags.write (:34-39); DELETE /:id tags.manage (:41-45).
- Model (tag.model.ts:10-17): name (trim, unique — case-SENSITIVE), color, createdBy; timestamps.
- Service (tag.service.ts): getAllTags sorted by name, unpaginated (:10-13); createTag case-insensitive regex duplicate check on the UNTRIMMED input (schema trims afterwards) — race-prone, and ' Foo' passes the check (:15-42); updateTag same (:44-80); deleteTag (:82-101) hard delete leaving dangling ObjectIds in Candidate.tags, Job.tags, Client.tags (documented in ENDPOINTS.md:223); logs lack the tag name.

#### webhooks (mounted /api/webhooks — NOT under /api/v1)

- Routes (webhook.routes.ts): POST /resend (no auth) (:9); POST /resend/test validate {type enum, emailId?} (:12-25).
- Controller (webhook.controller.ts): reads `process.env.RESEND_WEBHOOK_SECRET` directly (:9) though env.ts:45 already exposes it (duplicated read also webhook.service.ts:10). Signature verified ONLY when the secret is set (:19-25) → fail-open: without the env var anyone can POST forged events (mark emails bounced/delivered, inject inbound emails that appear in candidate threads). Invalid signature responds with `sendSuccess(..., 401)` → `{success:true, data:{verified:false}}` with status 401 (envelope inconsistency) (:22). testWebhook (:44-76) blocked only when NODE_ENV==='production' — on staging/dev it is a public unauthenticated endpoint that can drive processWebhookEvent with an arbitrary emailId.
- Service (webhook.service.ts): verifyWebhookSignature (Svix, raw body; 5-min timestamp window only when header present) (:20-42); status handlers set status unconditionally (:54-133) — out-of-order delivery (e.g. `email.sent` or `delivery_delayed` arriving after `delivered`) regresses status; non-inbound events are not idempotent (openCount/clickCount double-count on retries). handleEmailReceived (:140-385): dedupe by resendId; fetches full content via resend.emails.receiving.get; only accepts mail addressed to env.COMPANY_EMAIL; extracts in-reply-to/references; attachments: stores Resend `download_url` as permanent `url` although it has `expires_at` (:221-230, :300-305) → links break after expiry; candidate lookup by `fromEmail.toLowerCase()` (:250-252) — if Resend returns a display-name form ("Name <a@b>") the match fails (inferred); thread matching by messageId (outbound emails never store messageId, email.service.ts) else most recent outbound to sender (:267-273) — interview/invite/reset emails are not stored in Email, so replies to them can't be threaded; three near-identical Email.create blocks (:281-306, :331-356, :361-380) (duplication); unknown senders stored without context (visible to every emails.read user); inbound bodyHtml is stored raw (frontend must sanitize — inferred XSS risk); no socket emit when inbound mail arrives. processWebhookEvent (:390-423) — `event.data` undefined → TypeError → 500 (Resend retries).

#### sockets (context, outside scope) — sockets/ats.socket.ts:27-42: any ATS-access user joins ALL rooms (applications, candidates, jobs, clients, tags, pipeline-templates, email-templates) with no permission filtering, so every emit listed above reaches users who lack the matching read permission (e.g. interviewer gets clients incl. admin-only notes; non-admins get banned candidates).

---

## Area B — CRM modules and core (app, config, shared utils, crons, sockets, scripts, docs, dist)

Auditor scope: `backend/` only. All paths below are relative to `backend/`. Read-only audit; nothing was built or run.

---

### 1. Scope covered (every file read in full; line counts from `wc -l`)

**Config / docs**
| File | Lines |
|---|---|
| package.json | 81 |
| tsconfig.json | 16 |
| Procfile | 1 |
| README.md | 42 |
| ENDPOINTS.md | 365 |
| ATS-CRM-BACKEND-AUDIT.md | 170 |

**Core**
| File | Lines |
|---|---|
| src/app.ts | 189 |
| src/config/cloudinary.ts | 53 |
| src/config/db.ts | 13 |
| src/config/env.ts | 57 |
| src/shared/middleware/authenticate.ts | 42 |
| src/shared/middleware/authorize.ts | 90 |
| src/shared/middleware/errorHandler.ts | 49 |
| src/shared/middleware/optionalAuthenticate.ts | 25 |
| src/shared/middleware/upload.ts | 218 |
| src/shared/types/express.d.ts | 37 |
| src/shared/utils/AppError.ts | 23 |
| src/shared/utils/ai/claude.provider.ts | 80 |
| src/shared/utils/ai/index.ts | 75 |
| src/shared/utils/ai/openai.provider.ts | 72 |
| src/shared/utils/ai/parse-json.ts | 24 |
| src/shared/utils/ai/types.ts | 24 |
| src/shared/utils/catchAsync.ts | 15 |
| src/shared/utils/coalesce.ts | 68 |
| src/shared/utils/companyDay.ts | 127 |
| src/shared/utils/companyTimezone.ts | 50 |
| src/shared/utils/crmScope.ts | 66 |
| src/shared/utils/email.ts | 59 |
| src/shared/utils/emailSender.ts | 65 |
| src/shared/utils/emailSenderDefaults.ts | 13 |
| src/shared/utils/extract-resume-text.ts | 67 |
| src/shared/utils/googleMeet.ts | 50 |
| src/shared/utils/logger.ts | 82 |
| src/shared/utils/parseResumeWithAI.ts | 232 |
| src/shared/utils/pdf.ts | 370 |
| src/shared/utils/response.ts | 40 |
| src/shared/utils/sanitize-job-description.ts | 45 |
| src/shared/utils/timezone.ts | 262 |
| src/shared/utils/zoom.ts | 169 |
| src/shared/validators/common.validator.ts | 49 |
| src/jobs/aiCandidacyValidation.job.ts | 124 |
| src/jobs/aiCandidateScoring.job.ts | 149 |
| src/jobs/aiResumeParsing.job.ts | 81 |
| src/jobs/aiResumeValidation.job.ts | 101 |
| src/jobs/companyScheduler.ts | 76 |
| src/jobs/cronLock.ts | 72 |
| src/jobs/eodCompliance.job.ts | 101 |
| src/jobs/index.ts | 14 |
| src/jobs/surveyDispatcher.job.ts | 93 |
| src/sockets/ats.socket.ts | 56 |
| src/sockets/crm.socket.ts | 46 |
| src/sockets/index.ts | 35 |

**Scripts**
| File | Lines |
|---|---|
| src/scripts/align-email-sender.ts | 73 |
| src/scripts/backfill-activity-performers.ts | 180 |
| src/scripts/cleanup-activity-indexes.ts | 165 |
| src/scripts/dedupe-activity-logs.ts | 270 |
| src/scripts/delete-stale-approved-candidates.ts | 213 |
| src/scripts/find-approved-without-application.ts | 65 |
| src/scripts/find-orphan-resumes.ts | 155 |
| src/scripts/migrate-activity-action.ts | 298 |
| src/scripts/migrate-activity-timestamps.ts | 214 |
| src/scripts/migrate-company-timezone.ts | 74 |
| src/scripts/migrate-disposition.ts | 109 |
| src/scripts/migrate-eod-time.ts | 146 |
| src/scripts/migrate-user-permissions.ts | 54 |
| src/scripts/seed-admin.ts | 56 |
| src/scripts/seed-demo.ts | 200 |
| src/scripts/seed-disposition-reasons.ts | 377 |
| src/scripts/seed-email-templates.ts | 35 |

**CRM features**
| File | Lines |
|---|---|
| src/features/assignments/assignment.controller.ts | 94 |
| src/features/assignments/assignment.model.ts | 53 |
| src/features/assignments/assignment.routes.ts | 69 |
| src/features/assignments/assignment.service.ts | 363 |
| src/features/assignments/assignment.types.ts | 37 |
| src/features/assignments/assignmentScope.ts | 90 |
| src/features/client-accounts/clientAccount.controller.ts | 67 |
| src/features/client-accounts/clientAccount.routes.ts | 64 |
| src/features/client-accounts/clientAccount.service.ts | 243 |
| src/features/client-accounts/clientAccount.types.ts | 42 |
| src/features/dashboard/crm/crmDashboard.controller.ts | 15 |
| src/features/dashboard/crm/crmDashboard.routes.ts | 16 |
| src/features/dashboard/crm/crmDashboard.service.ts | 246 |
| src/features/eod-reminders/eodReminder.controller.ts | 35 |
| src/features/eod-reminders/eodReminder.model.ts | 43 |
| src/features/eod-reminders/eodReminder.routes.ts | 26 |
| src/features/eod-reminders/eodReminder.service.ts | 71 |
| src/features/eod-reminders/eodReminder.types.ts | 18 |
| src/features/eod-submissions/eodSubmission.controller.ts | 98 |
| src/features/eod-submissions/eodSubmission.model.ts | 124 |
| src/features/eod-submissions/eodSubmission.routes.ts | 110 |
| src/features/eod-submissions/eodSubmission.service.ts | 376 |
| src/features/eod-submissions/eodSubmission.types.ts | 85 |
| src/features/performance-reviews/performanceReview.controller.ts | 176 |
| src/features/performance-reviews/performanceReview.model.ts | 147 |
| src/features/performance-reviews/performanceReview.routes.ts | 132 |
| src/features/performance-reviews/performanceReview.service.ts | 566 |
| src/features/performance-reviews/performanceReview.types.ts | 89 |
| src/features/reports/reports.controller.ts | 131 |
| src/features/reports/reports.routes.ts | 53 |
| src/features/reports/reports.service.ts | 433 |
| src/features/scorecards/scorecard.controller.ts | 52 |
| src/features/scorecards/scorecard.model.ts | 49 |
| src/features/scorecards/scorecard.routes.ts | 32 |
| src/features/scorecards/scorecard.service.ts | 253 |
| src/features/scorecards/scorecard.types.ts | 17 |
| src/features/survey-reminders/surveyReminder.controller.ts | 62 |
| src/features/survey-reminders/surveyReminder.model.ts | 45 |
| src/features/survey-reminders/surveyReminder.routes.ts | 64 |
| src/features/survey-reminders/surveyReminder.service.ts | 161 |
| src/features/survey-reminders/surveyReminder.types.ts | 27 |
| src/features/va-profiles/vaProfile.controller.ts | 57 |
| src/features/va-profiles/vaProfile.model.ts | 65 |
| src/features/va-profiles/vaProfile.routes.ts | 60 |
| src/features/va-profiles/vaProfile.service.ts | 215 |
| src/features/va-profiles/vaProfile.types.ts | 36 |
| src/features/work-entries/workEntry.controller.ts | 88 |
| src/features/work-entries/workEntry.model.ts | 61 |
| src/features/work-entries/workEntry.routes.ts | 61 |
| src/features/work-entries/workEntry.service.ts | 241 |
| src/features/work-entries/workEntry.types.ts | 36 |

Total in scope: 13,001 lines (per `wc -l` total).

Coverage: every file above was read in full. `seed-disposition-reasons.ts` was read in a second pass.

Read outside scope for context only: `src/features/auth/auth.controller.ts` (cookie options), `auth.service.ts` (token signing, grep only), `src/features/activity-logs/activityLog.model.ts:37-40` (indexes), `dist/app.js`, `dist/sockets/crm.socket.js`, `dist/features/eod-submissions/eodSubmission.service.js` (staleness check).

#### dist/ (committed build output?)

- `dist/` exists in the copy: 194 `.js` files, dated the same as src (`ls -la dist`). There is no `.gitignore` in the copy (dotfiles were not synced to the project folder), so I cannot prove it is committed. Its presence next to `src/` suggests it is checked in or at least shipped (inferred).
- **It is stale.** Comparing `src/**/*.ts` (not `.d.ts`) with `dist/**/*.js`, five modules exist only in src:
  `features/assignments/assignmentScope`, `features/interviews/interview.schemas`, `features/jobs/job.public`, `shared/middleware/optionalAuthenticate`, `shared/utils/crmScope`.
- Content drift confirms it: `dist/sockets/crm.socket.js:33` adds every CRM user to `assignments` (the src staff-only check at `src/sockets/crm.socket.ts:37-39` is missing); `grep` finds no `assertOwns*`, `scopeListFilters` or `crmScope` anywhere in `dist`, and `dist/features/eod-submissions/eodSubmission.service.js` has no `actor` or ownership checks. So **dist predates the 2026-10-08/10 IDOR fixes**. `Procfile` runs `node dist/app.js` (Procfile:1). Heroku's Node buildpack runs `build` first, so production is probably rebuilt (inferred), but anyone who runs `pnpm start` without building runs the vulnerable code.

---

### 2. Per-folder / per-file summary

#### Bootstrap: `src/app.ts`

Order of execution:

1. `import * as Sentry` and then `./config/env`. Importing env calls `dotenv.config()` and **throws at import time** if any of the 20 required vars is missing (`config/env.ts:1-31`).
2. `Sentry.init({ dsn, environment: NODE_ENV, tracesSampleRate: prod ? 0.1 : 1.0, integrations: [expressIntegration()] })` (app.ts:6-11). The compiled order is kept, so init runs before express is required (verified in `dist/app.js` lines ~40-50).
3. All routers are imported. Importing `shared/utils/logger` sets up winston and, in production, **monkey-patches `console.*`** (logger.ts:75-80). Importing `shared/utils/email` creates a Resend client (email.ts:7), and `config/cloudinary` is configured when a module imports it.
4. `app.set('trust proxy', 1)` (app.ts:58).
5. Middleware stack, in order (app.ts:60-117):
   1. `helmet()` with defaults.
   2. `cors({ origin: [ATS_FRONTEND_URL, CRM_FRONTEND_URL], credentials: true })`: exact string match.
   3. `express.json({ verify })`, which keeps `req.rawBody` only for `/api/webhooks/resend*` (app.ts:72-80). The default 100 kb limit applies. There is no `urlencoded` parser.
   4. `cookieParser()` (no secret, so no signed cookies).
   5. A request logger: `logger.http` on `res.finish` (app.ts:83-99). In production the logger level is `info` (logger.ts:70), so **HTTP access logs are dropped in production**.
   6. Production only: `rateLimit` on `/api` at 100 requests per 15 min per IP, then on `/api/v1/auth` at 10 per 15 min (app.ts:101-117). Both use default memory stores and IP keys (trust proxy 1).
6. Routes (app.ts:120-155): `/api/v1/shared/{users,settings,activity-logs}`, `/api/v1/auth`, 12 ATS routers under `/api/v1/ats/*`, 11 CRM routers under `/api/v1/crm/*`, `reportsRouter` mounted twice (`/api/v1/crm/reports` and `/api/v1/reports`), and `/api/webhooks`.
7. 404 catch-all `AppError(404,'RESOURCE_NOT_FOUND')` (app.ts:157-159).
8. `Sentry.setupExpressErrorHandler(app, { shouldHandleError: statusCode >= 500 || !statusCode })` (app.ts:161-167).
9. `errorHandler` (app.ts:169).
10. Startup (app.ts:172-186): `connectDB().then(seedEmailTemplates).catch(log "companySize migration failed")`, run without awaiting. In the same tick it calls `startBackgroundJobs()`, `app.listen(PORT)` and `initializeSockets(server)`. **The cron scheduler and HTTP listener start before Mongo is connected.** `connectDB` calls `process.exit(1)` when it fails (db.ts:9-11), so the `.catch` only ever sees `seedEmailTemplates` errors, and its log message ("companySize migration failed") is wrong.
11. There is no `SIGTERM` handler or graceful shutdown, and no `unhandledRejection` or `uncaughtException` handler (grep finds none).

#### `src/config/*`

- `env.ts`: required list (env.ts:4-25) and the exported `env` object (env.ts:33-57). Optional values: `RESEND_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`, each defaulting to `''`.
- `db.ts`: `mongoose.connect(MONGODB_URI)`, exit(1) on failure. No pool or timeout options, no `connection.on('error'|'disconnected')` listeners.
- `cloudinary.ts`: `uploadToCloudinary(file, folder)` puts files in `ats/<folder>`. `resumes` and `portfolios` use resource type `raw`, everything else `image`. Errors are swallowed into `FILE_UPLOAD_FAILED` (cloudinary.ts:31-33). `deleteFromCloudinary` is best effort and logs through `console`.

#### `src/shared/middleware/*`

- `authenticate.ts`: requires `Authorization: Bearer`. It runs `jwt.verify(token, JWT_ACCESS_SECRET)` with no `algorithms`, `issuer` or `audience` options, then builds `req.user` from the claims `_id`, `firstName`, `lastName`, `roles`, `appAccess`, `permissions`, `candidateRef` and `clientRef` (authenticate.ts:27-36). **There is no DB lookup**, so a deactivated or deleted user keeps access until the token expires.
- `authorize.ts`: `requireRoles(...roles)`, where admin always passes (authorize.ts:16-20). `hasPermission` uses the hierarchy manage > write > read and schedule > write > read (authorize.ts:39-62). Note that `approve` (used by `eod` and `performanceReview` in express.d.ts:27-31) is outside the hierarchy. `requireAppAccess('ats'|'crm')` checks `appAccess` and lets admin through.
- `errorHandler.ts` maps:
  - AppError to its own status and code
  - `ValidationError` to 400 with the raw `err.errors` echoed back
  - code 11000 to 409 with `err.keyValue` echoed back
  - `CastError` to 400
  - `JsonWebTokenError` and `TokenExpiredError` to 401
  - anything else to 500, after `Sentry.captureException` and `console.error`

  **Not mapped:** `BSONError` (from `new mongoose.Types.ObjectId(badString)`, which is used throughout the CRM services) and multer errors other than LIMIT_FILE_SIZE. Both become 500s.

- `optionalAuthenticate.ts`: if there is no Bearer header the request continues anonymously; otherwise it delegates to `authenticate`, so a bad token gets a 401. Used by job routes (outside scope).
- `upload.ts`: multer memory storage.
  - `uploadResume`: PDF or DOCX, 5 MB, fields `resume` or `file`.
  - `uploadResumeWithPortfolio`: resume plus `portfolioFile` (PDF, ZIP or image), 10 MB, at most 2 files.
  - `uploadAvatar`, `uploadLogo`, `uploadUserAvatarFile`: JPEG or PNG, 2 MB.
  - The MIME type is the one the client sent; there is no magic-byte check.
  - The multer config is rebuilt on every request, and the same block is copy-pasted five times.
- `types/express.d.ts`: types `req.user` and `req.portfolioFile`. The `permissions` type lists only 10 resources, but the code also checks `settings`, `tags`, `emailTemplates`, `activityLogs`, `interviewScorecards`, `pipelineTemplates`, `dashboard` and `emails` (seen in ENDPOINTS.md), so the type is out of date.

#### `src/shared/utils/*`

- `AppError`, `catchAsync`, `response.ts`: the response envelope is `{success, data, message, meta?}` or `{success:false, error:{code,message,details?}}`.
- `ai/`: provider abstraction.
  - `ClaudeProvider` calls `https://api.anthropic.com/v1/messages` directly with `fetch` (claude.provider.ts:35-48), hard-coded model `claude-sonnet-4-20250514` (line 43), `anthropic-version: 2023-06-01`, a 30 s abort, and optional assistant prefill.
  - `OpenAIProvider` uses `gpt-4o` with `response_format: json_object` (openai.provider.ts:35-38).
  - `getAiProvider()` picks one from `settings.ai.provider` and caches the instance (index.ts:14-27).
  - `withRetry` makes 3 attempts with 1 s and 2 s backoff and **retries every error, including 4xx and config errors** (index.ts:36-55).
  - `callClaude` is deprecated and unused (index.ts:69-75).
  - `parseJsonResponse` strips code fences or leading prose, then runs `JSON.parse`; it returns `null` on failure (parse-json.ts).
- `coalesce.ts`: an in-process map that collapses concurrent AI-job runs with the same key. The comment documents the single-process assumption (coalesce.ts:20-25). `inFlightCount` is unused.
- `companyDay.ts`: `resolveCompanyDay(dateKey?)` returns `{dateKey, timezone, start, end}` for the company business day, plus `computeShiftHours` (which handles crossing midnight, capped at 24). `getCompanyTodayKey`, `buildDateKeyRange` and `dateKeyDaysBefore` are unused (grep).
- `companyTimezone.ts`: resolves DB Settings, then the env var, then `America/Chicago`, with a 60 s cache. Never throws.
- `crmScope.ts`: `assertOwnsRecord`, `assertOwnsCandidate` and `scopeListFilters`. Admin and account_manager count as "staff" and bypass both checks (crmScope.ts:17-18). AM limits live separately in `assignments/assignmentScope.ts`.
- `email.ts`: Resend `emails.send`. The `from` is `${fromName} <${fromEmail}>` and `replyTo` defaults to COMPANY_EMAIL. Failure throws `EMAIL_SEND_FAILED`. `substituteVariables` uses `{{var}}` replacement **without HTML escaping** (email.ts:9-16).
- `emailSender.ts` / `emailSenderDefaults.ts`: sender identity. The address is pinned to COMPANY_EMAIL and the display name comes from Settings. `DEFAULT_FROM_EMAIL='apply@ats.aristagroups.com'` is hard-coded (emailSenderDefaults.ts:12).
- `extract-resume-text.ts`: pdf-parse v2 extracts per-page text; an image-only PDF gets 400 `FILE_IMAGE_BASED_PDF`. DOCX uses mammoth and returns `''` on error.
- `googleMeet.ts`: no-op stubs, since Meet links are pasted in manually.
- `logger.ts`: winston. Dev output is coloured; prod is JSON with level `info`. In production `console.log`, `console.error` and friends are replaced with `args.join(' ')` (logger.ts:75-80), which **drops error stacks and object detail**.
- `parseResumeWithAI.ts`: a long resume-parsing prompt with prefill `{`, 4000 max tokens and `withRetry`, followed by post-processing that removes a duplicated " in <field>" degree suffix. Returns `null` when the `settings.ai.resumeParsing` switch is off.
- `pdf.ts`: `buildReviewPdf(review, tz)` renders a LETTER-size pdfkit document with a header, meta rows, AI sections, category ratings and the footer "AI-assisted document".
- `sanitize-job-description.ts`: a sanitize-html allowlist.
- `timezone.ts`: pure Intl helpers (offsets that are DST-safe, date-key parsing and formatting). `DEFAULT_TIMEZONE = 'America/Chicago'` (timezone.ts:8).
- `zoom.ts`: Server-to-Server OAuth token, cached until 60 s before expiry. Creates, updates and deletes meetings. Reads `process.env.ZOOM_*` directly instead of `env` (zoom.ts:11-13). Meetings are created with `waiting_room: false, join_before_host: true` (zoom.ts:65-68).

#### `src/shared/validators/common.validator.ts`

`validate(schema, source)` replaces `req[source]` with the parsed data. `objectIdSchema`, `paginationSchema` and `dateRangeSchema` are **defined but never used anywhere** (grep finds them only in the defining file). That is why no CRM route validates ObjectIds or caps pagination. `httpUrlSchema` is used by the job, candidate and client routes.

#### `src/jobs/*`

- `index.ts`: `startBackgroundJobs()` schedules the EOD compliance and survey dispatcher jobs and re-exports the four AI job runners.
- `companyScheduler.ts`: runs `cron.schedule('* * * * *')` every minute and fires when the wall clock in the company timezone equals hour:minute. It tracks `lastRunDay` and a `running` flag **per process**, and does not replay missed runs (companyScheduler.ts:27-71).
- `cronLock.ts`: a `CronLock` model (unique `name`, TTL index on `lockedAt` of 300 s). `acquireLock` does `findOneAndUpdate` + upsert and returns false on 11000. `releaseLock` deletes the document.
- `eodCompliance.job.ts`: daily at 17:00 company time. For each `active` assignment with no EOD for today's `dateKey`, it emails the VA, creates an `EodReminder` (`sent` or `failed`) and calls `createLog('eod_compliance_checked')`. Assignments are processed sequentially with N+1 queries.
- `surveyDispatcher.job.ts`: daily at 09:00 company time. Pending `SurveyReminder` records with `dueDate` up to the end of the company day get an email to the `assignedTo` user, then `status='sent'` and a log entry.
- `aiResumeParsing.job.ts`: coalesced on `parse:<candidateId>`. Skips when `parsedData` already has content and re-parses "hollow" results.
- `aiCandidacyValidation.job.ts`: coalesced; controlled by the `settings.ai.resumeValidation` switch.
- `aiResumeValidation.job.ts`: per application; **also controlled by `resumeValidation`** (line 42).
- `aiCandidateScoring.job.ts`: per candidate and job pair. Writes both `Application.aiScore` and `Candidate.aiScore`. It logs "AI candidate scoring completed" twice (lines 123-135).

#### `src/sockets/*`

- `index.ts`: `new Server(httpServer, { cors: same two origins, credentials })`, plus `emitToAts(room,event,payload)` and `emitToCrm(...)`.
- `ats.socket.ts`: namespace `/ats`. Auth runs **inside `connection`** (not `io.use`): the token comes from `handshake.auth.token` or the `Authorization` header and is checked with `jwt.verify`, then the user must have `appAccess` including `ats` or be admin. The socket joins `applications`, `candidates`, `jobs`, `clients`, `tags`, `pipeline-templates`, `email-templates` and `user:<_id>`. Client events: `join:job` and `leave:job` (join or leave the `job:<id>` room with no authorization).
- `crm.socket.ts`: namespace `/crm`. Same auth with `crm` access. Only `admin` and `account_manager` join `assignments`; everyone joins `user:<_id>`.
- Events actually emitted (grep across src):
  - **ATS:** `application:{updated,phaseChanged,deleted}`, `interview:{created,updated}` (in the `applications` room), `candidate:{created,updated,statusChanged,deleted}`, `client:*`, `job:{created,updated,statusChanged,deleted}`, `tag:*`, `pipeline_template:*`, `email_template:*`.
  - **CRM (all to `assignments`):** `assignment:{created,updated}`, `eod:{submitted,updated,deleted}`, `workEntry:{created,updated,deleted}`, `performanceReview:{created,updated,deleted}`.
  - **No emit ever targets `user:<id>` or `job:<id>`**, so those rooms are dead.

#### `src/scripts/*`

All one-off scripts that import `../config/env` need **all 20 required env vars** (including Zoom, Sentry and Cloudinary) even when they don't use them. Scripts:

- `align-email-sender.ts` (dry run by default, `--apply`): sets `settings.email.fromEmail = COMPANY_EMAIL`.
- `backfill-activity-performers.ts` (dry run by default): recovers `performedBy` on candidate `status_changed` logs from sibling application events within ±5 s.
- `cleanup-activity-indexes.ts` (dry run by default): drops four redundant indexes. The header text mentions only two (cleanup-activity-indexes.ts:10-22 vs 39-57). The model no longer declares them (activityLog.model.ts:37-40), so this is consistent.
- `dedupe-activity-logs.ts` (dry run by default): deletes no-op `status_changed` rows (where from equals to) and collapses duplicate groups within 3 s. **It loads the whole collection into memory** (dedupe-activity-logs.ts:118).
- `delete-stale-approved-candidates.ts` (dry run by default; `--delete` is destructive): see Issue #12.
- `find-approved-without-application.ts`: read only.
- `find-orphan-resumes.ts` (`--delete`): lists Cloudinary `ats/resumes` and deletes files not referenced by `candidates.resumeUrl`.
- `migrate-activity-action.ts` (dry run by default): renames `type` to `action` and remaps legacy tokens.
- `migrate-activity-timestamps.ts` (dry run by default): converts string timestamps to Date.
- `migrate-company-timezone.ts`: moves `America/New_York` to `America/Chicago` unless `--force` is given.
- `migrate-disposition.ts`: **no dry run** and no npm script. Backfills eligibility and `phoneNormalized`, and backfills legacy rejected applications from activity logs.
- `migrate-eod-time.ts` (dry run by default): backfills `dateKey`, `dateTimezone` and `date`, and swaps the unique index.
- `migrate-user-permissions.ts`: merges `{...buildPermissionsForRoles(roles), ...stored}` (shallow).
- `seed-admin.ts`: creates `admin@arista.com` with password `Admin@123` and prints it (seed-admin.ts:13,21,47-49).
- `seed-demo.ts`: not idempotent (creates a client with a fixed email and a default pipeline).
- `seed-email-templates.ts`: creates the default `application_confirmation` template if missing. **Runs on every boot** (app.ts:175).
- `seed-disposition-reasons.ts` (377 lines): see the coverage gap below.

**`seed-disposition-reasons.ts`** (read in full after the first pass)

- Seeds 52 reasons in 6 categories (lines 13-337):
  - experience_and_qualifications: 9
  - interview_performance: 8
  - availability_and_employment: 6
  - recruiter_or_client_selection: 9
  - candidate_actions: 8
  - permanently_ineligible_reasons: 12, all with `defaultEligibility: 'permanently_ineligible'`
- Matching is idempotent on (label, category) (lines 339-349). The CLI is guarded by `require.main` (line 361).
- The comment at lines 354-355 says the module can be imported "from the startup chain in `app.ts`", but app.ts never imports it (app.ts imports only `seedEmailTemplates`). The comment is stale.
- Because matching uses `label`, a reason an admin renamed in Settings is re-inserted under its original label on the next run. That produces a semantic duplicate, contradicting the "never duplicates" claim (lines 357-359).
- `connectDB` imports `config/env`, so this script also needs all 20 env vars.

#### CRM features (all routers use `authenticate` + `requireAppAccess('crm')`)

- **assignments**: CRUD plus "end".
  - `assignmentScope.ts` provides AM scoping helpers: `isAccountManagerOnly`, `assignmentScope` (a `{assignmentId: {$in: own}}` condition), `pairScope` (`$or` over candidate and client pairs), and the `assertManages*`/`assertOwns*` assertions.
  - `createAssignment` provisions the client's CRM user through `userService.provisionClient`, sends the invite fire-and-forget, creates survey reminders **without awaiting** (assignment.service.ts:169-173), logs, and emits.
  - `updateAssignmentStatus` (assignment.service.ts:328-363) is unused.
- **client-accounts**: a CRM view of an ATS `Client.crmProfile`. Endpoints: list (only clients that have a `crmProfile`), get, patch, provisioned-clients, and hired VAs for a client (from `Application.phase='hired'`).
- **dashboard/crm**: stats endpoint. Admin sees global figures; AM is filtered by candidateIds taken from their assignments.
- **eod-reminders**: read-only list and get. Records are created only by the cron job.
- **eod-submissions**: `/context` returns the company day. The VA creates, updates and **hard-deletes** EODs. The server computes `hoursWorked`. There is a unique `(assignmentId, dateKey)` index (eodSubmission.model.ts:99), and `toSafeObject` exposes `date` as the `dateKey` string.
- **performance-reviews**: AI-generated drafts. Endpoints: CRUD, `/complete` (locks the review), `/regenerate` (one section) and `/export-pdf`.
- **reports**: CSV or XLSX exports of work entries, EODs (in the boss's Google-Form layout), completed reviews, and ATS dispositions (application rejections plus candidate-level reject logs).
- **scorecards**: list, get and `POST /generate`, which upserts the current week's scorecard for each active assignment using a weighted productivity score (EOD compliance 40, hours 30, tasks 20, on-time 10).
- **survey-reminders**: list, create, get and patch. `createAssignmentReminders` adds 3-day, 1-week, 30-day and "monthly" (60-day, once) check-ins.
- **va-profiles**: one profile per candidate, auto-created on GET. PATCH upserts. There is an admin-only note thread (`/:vaId/notes`).
- **work-entries**: VA CRUD with soft delete (`isDeleted`, `deletedAt`).

---

### 3. Features & user flows (backend side)

**A. Hire to assignment (admin or AM)**

1. `POST /api/v1/crm/assignments` with `{candidateId, clientId, serviceType, startDate, endDate?, accountManagerId, status?, notes?, jobId?}`.
2. The controller checks that an AM is naming themselves (assignment.controller.ts:53).
3. The service checks that the Candidate and Client exist, then `Assignment.create`.
4. It picks the primary contact (or falls back to the client's email) and calls `provisionClient`. If the client user is new, it sends an invite (fire-and-forget).
5. It inserts 4 survey reminders (not awaited), calls `createLog('created')` and emits `assignment:created` to the CRM `assignments` room.
6. Nothing checks that the candidate is hired or that another active assignment already exists for the same pair.

**B. VA daily work**

1. The VA logs work entries: `POST /crm/work-entries` (`timeSpent` 1-480, `entryDate` YYYY-MM-DD). This emits `workEntry:created`.
2. The VA opens the EOD form: `GET /crm/eod-submissions/context` returns `{dateKey, timezone}`.
3. The VA submits: `POST /crm/eod-submissions` with `communicatedWithClient` and either `workEntries[]` or `summaryOfWork`.
4. The server resolves the company day (or the `date` the client sent), computes the hours, enforces one EOD per day (409), saves and emits `eod:submitted`.
5. At 17:00 company time the cron job emails each VA whose active assignment has no EOD and records an `EodReminder`.

**C. Account manager monitoring**

- `GET /crm/dashboard` returns counts, compliance, recent EODs, weekly hours and per-VA/per-client totals.
- `GET /crm/eod-submissions|work-entries|eod-reminders` are AM-scoped through `assignmentScope`.
- `POST /crm/scorecards/generate`, then `GET /crm/scorecards`.
- Survey reminders are emailed to the AM at 09:00. The AM marks them completed with `PATCH /crm/survey-reminders/:id`.

**D. Performance review**

1. `POST /crm/performance-reviews` (admin or AM; for an AM, `assertOwnsPair`). The AI call is synchronous inside the request (performanceReview.service.ts:168-169), and the review is created as `ai_generated`.
2. The manager edits with `PATCH /:id` (categories, ratings, summary, status other than completed).
3. Optionally `POST /:id/regenerate {section}`.
4. `PATCH /:id/complete` locks the review.
5. `GET /:id/export-pdf`. The VA can list, read and export their own reviews in **any status**.

**E. Client view**
A client can call:

- `GET /crm/assignments`, `/work-entries` and `/eod-submissions`, pinned to their `clientRef`
- `GET /crm/client-accounts/:ownId/hired-vas`

**F. Reports**
`GET /api/v1/crm/reports/{work-entries|eod-submissions|performance}/export?format=csv|xlsx&startDate&endDate&candidateId&clientId` returns a file and records `report_exported` in the activity log. Dispositions are at `/api/v1/reports/ats/dispositions/export`.

---

### 4. UI/UX observations

Not applicable; this scope is backend only. Backend aspects that affect the UI:

- Error messages are user-facing strings, but the codes are inconsistent: `FORBIDDEN` (assignment.service.ts:205-209) vs `AUTH_INSUFFICIENT_PERMISSIONS` elsewhere.
- Client-account, scorecard and VA-profile controllers turn unexpected errors into 404s, so the UI shows "not found" for server faults.
- A bad ObjectId in a query string returns a 500 "Something went wrong" instead of a 400.
- Email bodies for the EOD and survey reminders are bare inline HTML. The survey email **does not say which VA, client or assignment** it is about (surveyDispatcher.job.ts:39-48).

### 5. Styles

Not applicable (backend). The PDF styling is hard-coded in pdf.ts (colours `#1e3a5f`, Helvetica, LETTER size).

---

### 6. Roles & permissions (CRM routers)

Admin passes every `requireRoles` check (authorize.ts:16-20). Staff (admin or AM) bypass `crmScope` (crmScope.ts:17-18), and AM limits come from `assignmentScope.ts`.

| Resource                 | Read                                                  | Write                                        | VA/client scoping                       | AM scoping                                                             |
| ------------------------ | ----------------------------------------------------- | -------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| assignments              | admin, AM, client, VA (assignment.routes.ts:37-54)    | admin, AM                                    | `scopeListFilters` / `assertOwnsRecord` | list forced to own (controller:24); get, patch and end check ownership |
| work-entries             | admin, AM, client, VA                                 | **VA only** (workEntry.routes.ts:39-59)      | yes                                     | `assignmentScope`, `assertOwnsAssignment`                              |
| eod-submissions          | admin, AM, client, VA                                 | **VA only** (eodSubmission.routes.ts:88-108) | yes                                     | yes                                                                    |
| eod-reminders            | admin, AM                                             | none (cron only)                             | n/a                                     | yes                                                                    |
| performance-reviews      | admin, AM, **VA** (no client)                         | admin, AM                                    | VA pinned to own                        | `pairScope` / `assertOwnsPair`                                         |
| survey-reminders         | admin, AM                                             | admin, AM                                    | n/a                                     | **none**                                                               |
| scorecards               | admin, AM                                             | admin, AM (generate)                         | n/a                                     | reads scoped; **generate not scoped**                                  |
| client-accounts          | admin, AM (+client for hired-vas)                     | admin, AM                                    | client only for own hired-vas           | **none**                                                               |
| va-profiles              | admin, AM, VA (own `/:id`)                            | admin, AM                                    | VA only own                             | **none**                                                               |
| va-profiles notes        | admin                                                 | admin                                        | n/a                                     | n/a                                                                    |
| dashboard                | admin, AM                                             | n/a                                          | n/a                                     | AM by candidateIds (not by assignment)                                 |
| reports (crm)            | admin, AM                                             | n/a                                          | n/a                                     | `assignmentScope` / `pairScope`                                        |
| reports/ats/dispositions | app `ats` + roles admin, AM (reports.routes.ts:42-50) | n/a                                          | n/a                                     | none (and AMs have no ATS access)                                      |

Admins and AMs **cannot** create work entries or EODs on behalf of a VA (VA-only routes), and nobody but the VA can correct or delete them.

---

### 7. Connections

#### Exposed endpoints (CRM features in scope)

Base `/api/v1`. All need a Bearer token and `crm` app access unless noted.

**Assignments `/crm/assignments`**

- `GET /`: query `candidateId, clientId, accountManagerId, status, page, limit`. Returns `IAssignment[]` plus `companyName`, `accountManagerName`, `accountManagerEmail`, `candidateName`, and `meta`.
- `POST /` (admin, AM): zod `createAssignmentSchema` (assignment.routes.ts:11-21). Returns 201 with an `IAssignment`.
- `GET /:id`.
- `PATCH /:id` (admin, AM): `updateAssignmentSchema` (routes:23-30).
- `DELETE /:id` (admin, AM): sets status `ended` and defaults `endDate` to now.

**Client accounts `/crm/client-accounts`**

- `GET /provisioned`: `[{clientId, companyName}]`.
- `GET /:id/hired-vas` (admin, AM, client): `[{id, firstName, lastName}]`.
- `GET /`: `IClientAccount[]` with meta.
- `GET /:id`.
- `PATCH /:id`: `updateClientAccountSchema` (clientAccount.routes.ts:11-26).

**Dashboard `/crm/dashboard`**

- `GET /` (admin, AM): `{overview, eodCompliance, recentEodSubmissions (raw lean docs), assignmentHealth, weeklyWorkHours, perVABreakdown, perClientBreakdown}`.

**EOD reminders `/crm/eod-reminders`**

- `GET /` (query `assignmentId, candidateId, status, page, limit`).
- `GET /:id`.

**EOD submissions `/crm/eod-submissions`**

- `GET /context`: `{dateKey, timezone}`.
- `GET /`: query `assignmentId, candidateId, clientId, date, dateFrom, dateTo, page, limit`. Rows include `candidateName` and `companyName`.
- `POST /` (VA): `createEodSchema` (eodSubmission.routes.ts:21-64).
- `GET /:id`.
- `PATCH /:id` (VA): `updateEodSchema` (routes:66-68).
- `DELETE /:id` (VA): hard delete.

**Performance reviews `/crm/performance-reviews`**

- `GET /` (admin, AM, VA): query `candidateId|vaId, clientId, reviewType, status, page, limit`.
- `POST /` (admin, AM): `generateReviewSchema` (routes:22-40).
- `GET /:id`: adds `candidateName`, `clientName`, `jobTitle`.
- `PATCH /:id/complete`.
- `PATCH /:id`: `updateReviewSchema` (routes:51-84).
- `DELETE /:id`.
- `GET /:id/export-pdf`: `application/pdf` attachment.
- `POST /:id/regenerate`: `{section: categories|goals|summary}`.

**Reports** (router mounted at both `/crm/reports` and `/reports`)

- `GET /work-entries/export`, `GET /eod-submissions/export`, `GET /performance/export` (admin, AM; app `crm`).
- `GET /ats/dispositions/export` (app `ats`; admin, AM).
- Query `format, startDate, endDate, candidateId, clientId, jobId`. Responses are `text/csv` or xlsx.

**Scorecards `/crm/scorecards`**

- `GET /` (query `vaId, page, limit`).
- `GET /:id`.
- `POST /generate`: body `{vaId?}` with **no validation**. Returns `{generated}`.

**Survey reminders `/crm/survey-reminders`**

- `GET /` (query `relatedType, relatedId, status, assignedTo, page, limit`).
- `POST /`: `relatedType` client|va|assignment, `relatedId`, `surveyType` (3_day|1_week|30_day|60_day|90_day|monthly), `dueDate` YYYY-MM-DD, `assignedTo`.
- `GET /:id`.
- `PATCH /:id`: `status`, `completedDate` (YYYY-MM-DD), `dueDate` (**ISO datetime**), `assignedTo`.

**VA profiles `/crm/va-profiles`**

- `GET /` (admin, AM).
- `GET /:id` (admin, AM, VA): creates the profile on first read.
- `PATCH /:id` (admin, AM): upsert.
- `GET /:vaId/notes` (admin).
- `POST /:vaId/notes` (admin): `{method, content≤5000}`.

**Work entries `/crm/work-entries`**

- `GET /`: query `assignmentId, candidateId, clientId, entryDate, dateFrom, dateTo, page, limit`.
- `POST /` (VA).
- `GET /:id`.
- `PATCH /:id` (VA).
- `DELETE /:id` (VA): soft delete.

#### Auth model (context; the auth feature belongs to another auditor)

- Access JWT signed with `JWT_ACCESS_SECRET`, `expiresIn: JWT_ACCESS_EXPIRES`. Refresh JWT signed with `JWT_REFRESH_SECRET`, `expiresIn: JWT_REFRESH_EXPIRES` (auth.service.ts:70-80).
- One refresh token per app is stored on the user as `refreshTokenAts` or `refreshTokenCrm` (auth.service.ts:85-88).
- Cookie names `refreshTokenCrm` / `refreshTokenAts`, options `{httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax', maxAge: 7 days}` (auth.controller.ts:13-19).
- The cookie `maxAge` is fixed at 7 days and is independent of `JWT_REFRESH_EXPIRES`. `clearCookie` is called without the matching options (auth.controller.ts:29-34).
- Sockets authenticate with the **access** token.

#### Socket namespaces, rooms and events

See §2 (sockets).

#### External services

| Service                 | Where                                                                                     | Notes                     |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------- |
| MongoDB                 | config/db.ts                                                                              |                           |
| Resend                  | shared/utils/email.ts:7,30                                                                | outbound only in my scope |
| Cloudinary              | config/cloudinary.ts; scripts delete-stale-approved-candidates.ts, find-orphan-resumes.ts |                           |
| Anthropic Messages API  | shared/utils/ai/claude.provider.ts:35                                                     |                           |
| OpenAI Chat Completions | shared/utils/ai/openai.provider.ts:26                                                     |                           |
| Zoom OAuth + Meetings   | shared/utils/zoom.ts:18,53,117,152                                                        |                           |
| Sentry                  | app.ts:6-11,161-167; errorHandler.ts:44                                                   |                           |
| Google Meet             | googleMeet.ts                                                                             | no API calls (stubs)      |

#### Env vars referenced (every `process.env` use)

- Through `config/env.ts`:
  - Required: `PORT, NODE_ENV, MONGODB_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_EXPIRES, JWT_REFRESH_EXPIRES, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, RESEND_API_KEY, ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, COMPANY_TIMEZONE, COMPANY_EMAIL, COMPANY_NAME, SENTRY_DSN, ATS_FRONTEND_URL, CRM_FRONTEND_URL` (env.ts:4-25).
  - Optional: `RESEND_WEBHOOK_SECRET, ANTHROPIC_API_KEY, OPENAI_API_KEY` (env.ts:45-47).
- Direct `process.env` reads outside env.ts:
  - `ZOOM_ACCOUNT_ID/CLIENT_ID/CLIENT_SECRET` (zoom.ts:11-13)
  - `RESEND_WEBHOOK_SECRET` (features/webhooks/webhook.service.ts:10, webhook.controller.ts:9)
  - `MONGODB_URI` (scripts seed-admin.ts:8, seed-demo.ts:6, find-approved-without-application.ts:23, find-orphan-resumes.ts:78, delete-stale-approved-candidates.ts:76)
  - `CLOUDINARY_*` (delete-stale-approved-candidates.ts:37-39, find-orphan-resumes.ts:20-21)
- `.env.example` is referenced by README.md:13,29 but is not in the copy (dotfiles were stripped), so it cannot be checked.

#### Cron schedules

| Job               | node-cron expression | Effective schedule | Source                                             |
| ----------------- | -------------------- | ------------------ | -------------------------------------------------- |
| eod-compliance    | `* * * * *`          | 17:00 company time | eodCompliance.job.ts:17-18, companyScheduler.ts:36 |
| survey-dispatcher | `* * * * *`          | 09:00 company time | surveyDispatcher.job.ts:16-17                      |

Neither job is replayed after downtime. Both take a Mongo lock (`cronlocks`, 4-minute stale threshold plus a 300 s TTL index).

#### Logging and Sentry

- Winston writes to the console only. Production format is JSON at level `info`, so `http` logs are filtered out.
- Sentry: traces at 10% in production. Errors are captured by `setupExpressErrorHandler` (5xx or no statusCode) **and again** by `errorHandler` for non-AppError errors (see Issue #20).
- Background-job errors are logged but never sent to Sentry. There is no `Sentry.captureException` in the jobs.

---

### 8. Data models (CRM)

- **Assignment** (assignment.model.ts:15-33):
  - Fields: `candidateId` (ref Candidate, required), `clientId` (ref Client, required), `status` (enum active|on_hold|ended, default active), `serviceType` (required string), `startDate` (required), `endDate` (default null), `accountManagerId` (ref User, required), `notes`, `createdBy`, `updatedBy`, timestamps.
  - Indexes: candidateId, clientId, status, (candidateId, clientId), accountManagerId, createdAt.
  - **No uniqueness on active candidate+client pairs.**
- **EodReminder** (eodReminder.model.ts:11-28): `assignmentId`, `candidateId`, `reminderDate`, `reminderType` (default `missing_eod`), `status` (sent|failed).
- **EodSubmission** (eodSubmission.model.ts:34-99):
  - Fields: `assignmentId`, `candidateId`, `clientId`, `date` (UTC start of the company day), `dateKey` (YYYY-MM-DD), `dateTimezone`, `shiftStart`/`shiftEnd` (HH:MM), `hoursWorked`, `summaryOfWork` (legacy), `workEntries[]` (`{task, description, quantity, status, timeSpent}`, no `_id`), `pendingTasks` (required), `blockers`, `notes`, `communicatedWithClient` (yes|no|other|null), `clientNote`.
  - Unique index on (assignmentId, dateKey). Redundant indexes: `assignmentId_1` and `(assignmentId, dateKey -1)` are covered by the unique one; `date -1` and `dateKey -1` both exist.
- **PerformanceReview** (performanceReview.model.ts:58-112):
  - Core fields: `candidateId`, `clientId`, `jobId`, `reviewType` (6 values), `reviewPeriodStart`/`reviewPeriodEnd`.
  - `status`: draft|ai_generated|in_review|sent_to_client|archived|completed.
  - `aiGenerated`: `{roleSummary, coreResponsibilities[], strengths, areasForImprovement, goals[], finalRecommendation, generatedAt}`.
  - `categories[]`: `{categoryName, categoryDescription, reviewQuestions[], suggestedKpis[], managerCommentPrompt, rating 1-5, managerComments, sortOrder}`.
  - Other fields: `overallRating`, `clientSatisfactionScore`, `managerRatingInputs` (Mixed), `finalRecommendation` (a duplicate of `aiGenerated.finalRecommendation`), `finalManagerSummary`, `generatedByUserId`, `reviewedByUserId`.
- **Scorecard** (scorecard.model.ts:11-39): `vaId` (ref Candidate), `assignmentId`, `weekStart`, `weekEnd`, `totalHours`, `totalTasksCompleted`, `avgTasksPerDay`, `eodComplianceRate`, `onTimeSubmissionRate`, `productivityScore`, `categoryDistribution` (Mixed), `generatedAt`. Unique (vaId, assignmentId, weekStart).
- **SurveyReminder** (surveyReminder.model.ts:11-26): `relatedType` (free string; zod restricts it to client|va|assignment), `relatedId` (ObjectId with no ref), `surveyType` (free string), `dueDate`, `completedDate`, `status` (pending|sent|completed|skipped), `assignedTo` (ref User).
- **VaProfile** (vaProfile.model.ts:28-49): `vaId` (ref Candidate, unique), `workloadLevel` (low|normal|high|overloaded), `satisfactionScore` (1-5), `burnoutRiskFlag`, `replacementRiskFlag`, `lastVaCheckin`, `notes` (free text), `noteThread[]` (`{method, content≤5000, author}` with timestamps).
- **WorkEntry** (workEntry.model.ts:16-50): `assignmentId`, `candidateId`, `clientId`, `entryDate` (Date; parsed from YYYY-MM-DD as UTC midnight), `entryTime` (HH:MM), `taskCategory`, `taskDescription`, `timeSpent` (minutes), `status`, `notes`, `isDeleted`, `deletedAt`.
- **ClientAccount**: not a collection. It is projected from `Client.crmProfile` and contacts (clientAccount.service.ts:12-50). The stored field `baaSign` is exposed as `baaSigned`.
- **CronLock** (cronLock.ts:9-19): `name` (unique), `lockedAt` (TTL 300 s), `instanceId`.

---

### 9. Dependencies used in scope (package.json:28-69)

| Package                    | Use                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| express 4                  | HTTP framework                                                                                     |
| helmet                     | security headers, defaults only                                                                    |
| cors                       | origin allowlist                                                                                   |
| cookie-parser              | refresh cookies                                                                                    |
| express-rate-limit 7       | memory store; production only                                                                      |
| jsonwebtoken 9             | access/refresh tokens, socket auth                                                                 |
| mongoose 8                 | data layer                                                                                         |
| zod 3                      | request validation                                                                                 |
| socket.io 4.8              | realtime; pnpm overrides pin patched `engine.io`, `socket.io-parser` and `ws` (package.json:71-79) |
| node-cron 3                | job scheduler                                                                                      |
| winston 3                  | logging                                                                                            |
| @sentry/node 8             | error tracking                                                                                     |
| resend (`^6.4.0-canary.0`) | email; **a canary pre-release range**                                                              |
| cloudinary 2               | file storage                                                                                       |
| multer 1.4.5-lts           | uploads                                                                                            |
| pdfkit                     | review PDFs                                                                                        |
| xlsx 0.18.5                | report export; no maintained fix on npm                                                            |
| pdf-parse 2                | resume text                                                                                        |
| mammoth                    | DOCX resume text                                                                                   |
| sanitize-html              | job description HTML                                                                               |
| svix                       | webhook signatures (other scope)                                                                   |
| bcryptjs                   | passwords (seed-admin)                                                                             |
| dotenv                     | env loading                                                                                        |

Dev dependencies:

- `@types/mongoose@^5.11.97` is a stub for the old v5 package, unnecessary with Mongoose 8, and can conflict.
- `@types/xlsx@0.0.36` is a deprecated stub.
- `@types/winston` is a deprecated stub (winston ships its own types).
- There is **no test runner, linter or formatter** in package.json, even though the code contains `eslint-disable` comments (common.validator.ts:45, find-orphan-resumes.ts:44).

---

### 10. ISSUES

Format for each issue: severity / category, location, what is wrong, why it matters, suggested fix.

#### Critical / High

**1. High / security (info disclosure).** `va-profiles/vaProfile.controller.ts:24-35`, `vaProfile.model.ts:51-63`, `vaProfile.routes.ts:36-40,49-58`.

- What: `GET /crm/va-profiles/:id` is open to the `va` role, and the response is `toSafeObject()` with the full `noteThread`, `notes`, `burnoutRiskFlag`, `replacementRiskFlag` and `satisfactionScore`. The routes file says the notes thread is "Admin-only: account_manager / client / va roles must not read or write", but the profile GET returns it to the VA (and to AMs).
- Why: a VA can read the internal admin notes about them and their replacement-risk flag.
- Fix: project per role. Strip `noteThread`, `notes` and the risk flags for VAs, and strip `noteThread` for AMs.

**2. High / bug (wrong data for AMs).** `dashboard/crm/crmDashboard.service.ts:41-48,96-131,153-163`.

- What: for an AM, `candidateIdFilter` is an array of **strings** used inside `WorkEntry.aggregate([{ $match: { candidateId: { $in: [...strings] } } }])`. Aggregation pipelines are not cast by Mongoose, and `WorkEntry.candidateId` is an ObjectId (workEntry.model.ts:23-27), so the match returns nothing.
- Why: for every account manager, `weeklyWorkHours`, `perVABreakdown` and `perClientBreakdown` are always 0 or empty. The `countDocuments`/`find` calls are cast and work, so the dashboard is inconsistent (inferred from Mongoose semantics; not executed).
- Fix: map the ids to `new Types.ObjectId(...)` before aggregating.

**3. High / security (cross-AM leak).** `crmDashboard.service.ts:37-49,66-79,87-94`.

- What: AM scoping uses **candidateIds** rather than assignmentIds. When a VA works for two clients under different AMs, each AM sees the other AM's EODs, work entries and reminders for that VA (recent EOD docs are returned in full, `.lean()`). The counts also include ended assignments (`Assignment.find({accountManagerId})` with no status filter).
- Why: this contradicts the scoping model used everywhere else (`assignmentScope`).
- Fix: scope by `assignmentId: {$in: ownAssignmentIds}`, as `assignmentScope()` does.

**4. High / bug (AI feature broken).** `performance-reviews/performanceReview.service.ts:424-473`.

- What: the `regenerateSection` prompts for categories, goals and summary include **no context at all**: no candidate, job, role type, review type, period, existing content, expectations or manager notes. The model is just asked to "Regenerate the performance categories for an existing review".
- Why: the regenerated sections are generic boilerplate unrelated to the VA. Regenerating `categories` also wipes every rating and manager comment (lines 498-503) without warning.
- Fix: rebuild the prompt from the stored review (and the job and candidate). Preserve ratings when category names match, or require confirmation.

**5. High / bug (unhandled errors).** `performanceReview.service.ts:214,498`.

- What: `result.categories.map(...)` is called without checking that `categories` is an array. If the AI returns valid JSON without `categories`, this throws a TypeError, which surfaces as a 500 after a paid AI call. `generateReview` also never checks that the candidate or client exists (lines 119-123). The prompt then contains "undefined undefined" and the review is saved with nonexistent IDs.
- Fix: validate the AI output with zod, and return 404 for a missing candidate or client before calling the AI.

**6. High / reliability.** `assignments/assignment.service.ts:169-173` together with `survey-reminders/surveyReminder.service.ts:93-112`.

- What: `createAssignmentReminders(...)` is async and called **without `await` or `.catch`**. If `insertMany` rejects (DB error, validation), that is an unhandled promise rejection. Node 20 terminates the process on unhandled rejections by default, and there is no `process.on('unhandledRejection')` handler anywhere (grep).
- Fix: `await` the call, or add `.catch(logger.error)`.

**7. High / security / input validation (claim #5 in the prior audit still holds).**

- What: across all CRM services, ids from queries and bodies are passed to `new mongoose.Types.ObjectId(x)` with no validation. Examples: assignment.service.ts:41-46,130-138; eodReminder.service.ts:32-35; eodSubmission.service.ts:75-80; workEntry.service.ts:54-59; surveyReminder.service.ts:36-40,76-79; scorecard.service.ts:60,135; vaProfile.service.ts:81; clientAccount.service.ts:176. The zod schemas use `z.string()` for every id (e.g. assignment.routes.ts:12-17; eodSubmission.routes.ts:22; workEntry.routes.ts:12; surveyReminder.routes.ts:18,28; performanceReview.routes.ts:23-25,83). `objectIdSchema` exists but is never used (common.validator.ts:5-7).
- Why: an invalid id throws `BSONError`, which errorHandler does not map, so the client gets a 500 and Sentry gets noise. String filters such as `status`, `reviewType` and `relatedType` are passed raw from `req.query`. Express 4's `qs` parser allows `?status[$ne]=x` to become an operator object (assignment.service.ts:47; eodReminder.service.ts:36; surveyReminder.service.ts:35,38; performanceReview.service.ts:46-50; reports.service.ts:110-111,164-165,274-275,338-339). `page` and `limit` are `Number(...)` with no bounds: `page=0` gives a negative skip and a Mongo error (500); `limit=0` disables the limit and makes `totalPages` Infinity; `limit=1e6` dumps the collection.
- Fix: use `objectIdSchema` plus `paginationSchema` with `validate(..., 'query')` on every list and id route, and map `BSONError` to 400.

**8. High / security (AM scoping gaps; claim #1 in the prior audit still holds).**

- `survey-reminders/surveyReminder.controller.ts:6-62`: an AM can list, read, create and patch any reminder, including reassigning `assignedTo` to anyone (no existence or role check).
- `client-accounts/clientAccount.controller.ts:8-67`: all clients, and any client's CRM profile, can be read and edited.
- `va-profiles/vaProfile.controller.ts:8-44`: all profiles, and any upsert.
- `scorecards/scorecard.controller.ts:43-51` together with `scorecard.service.ts:133-137`: `POST /generate` without `vaId` regenerates scorecards for **every** active assignment company-wide, and with `vaId` for any VA.
- CRM socket `assignments` room (crm.socket.ts:37-39): every AM receives every `eod:*`, `workEntry:*` and `performanceReview:*` payload, including the full EOD and review documents (eodSubmission.service.ts:350; performanceReview.service.ts:233,339,373), regardless of assignment.
- Fix: apply `assignmentScope` and `assertOwnsAssignment` consistently, and use per-AM socket rooms (e.g. `am:<id>`).

**9. High / bug (multi-instance cron double-fire).** `jobs/eodCompliance.job.ts:86-100`, `surveyDispatcher.job.ts:73-92`, `cronLock.ts:66-72`.

- What: the lock is released in `finally` right after the run, and the "once per day" guard is in process memory (companyScheduler.ts:33,60). With two dynos, instance A runs at 17:00:00, finishes and deletes the lock; instance B ticks at 17:00:20, takes the free lock and runs again. VAs get duplicate reminder emails and duplicate `EodReminder` rows.
- Why: the prior audit says the lock ensures "one instance runs it" (ATS-CRM-BACKEND-AUDIT.md:97), which is not true. The app is single-process today (coalesce.ts:20-22), but the lock design suggests scaling was intended.
- Fix: key the lock on `name + localDay` and don't delete it (let the TTL expire), or store `lastRunDay` in Mongo.

**10. High / ops.** `dist/` is a stale build missing five modules and all IDOR fixes (see §1 dist). `package.json:5,14` and Procfile:1 point at `dist/app.js`.

- Fix: remove `dist/` from the repo and `.gitignore` it; build in CI or on Heroku only.

**11. High / data integrity.** `eod-submissions/eodSubmission.routes.ts:28,108`, `eodSubmission.service.ts:232,354-376`.

- What:
  - The VA may pass any `date` (past or future) when creating an EOD; there is no bound.
  - The VA can PATCH (with no time window) or **hard-delete** any of their EODs at any time, including after the assignment ends.
  - There is no audit trail beyond the activity log.
  - The 17:00 compliance check and the scorecards trust these records.
- Why: a VA can backfill missed days, delete past records or pre-file future days, which undermines compliance metrics. This is a business rule ambiguity, but the risk is concrete.
- Fix: limit `date` to today (or a grace window), lock EODs after N days, and soft-delete.

**12. High / dangerous script.** `scripts/delete-stale-approved-candidates.ts:79-203`.

- What it targets: candidates with `status:'approved'` and no `phase:'approved'` application. But ENDPOINTS.md:106 documents that a quick import (`POST /ats/candidates`) sets status `approved` and **creates no application**, so every quick-imported candidate is a target.
- What it deletes: from **every collection**, rows where `candidateId`, `candidateRef`, `candidate`, `vaId`, `relatedId` or `resourceId` match (lines 27-34, 193-199). That includes `users.candidateRef`, which deletes the VA login account.
- What it misses: the portfolio file (`portfolioFileUrl`).
- Other problems: no transaction, no npm script, and it bypasses the service-level cascade.
- Fix: exclude candidates with `source` = internal import (or whatever field marks a quick import), use the candidate service's delete path, and handle portfolio files.

#### Medium

**13. Medium / bug.** `eod-submissions/eodSubmission.service.ts:306-313` vs `eodSubmission.types.ts:60-64` and `eodSubmission.routes.ts:31-35`.

- What: the types and route comments say the client-supplied `hoursWorked` is "accepted but ignored", but `updateEodSubmission` stores `input.hoursWorked` whenever the shift times are not changed in the same PATCH.
- Why: a VA can set arbitrary hours (0-24) that don't match their shift.
- Fix: drop that branch.

**14. Medium / validation gap.** `eodSubmission.routes.ts:66-68`.

- What: `updateEodSchema` is `.partial()` without the create refinements. A PATCH can set `workEntries: []` and `summaryOfWork: null` (leaving an EOD with no content) or `communicatedWithClient: null`, bypassing the required rules at routes:45-64. `quantity` and `timeSpent` in work entries have no maximum and need not be integers (routes:16-18). No text field has a length limit.
- Fix: re-validate the merged document on update.

**15. Medium / bug.** `work-entries/workEntry.service.ts:129-138,182-241`.

- What: soft-deleted entries can still be fetched (`GET /:id`), updated and "deleted" again; only the list filters out `isDeleted`. Updates to entries on ended assignments are also allowed (only create checks for ended, at lines 149-155). `deleteWorkEntry` logs without `performedBy` (lines 233-237).
- Fix: filter `isDeleted:{$ne:true}` in the get, update and delete paths, and block changes on ended assignments.

**16. Medium / timezone inconsistency (claim #15 in the prior audit still holds).** These use **server-local** time:

- `crmDashboard.service.ts:19-32` (today and week windows)
- `workEntry.service.ts:60-79` (`setHours` on a date parsed as UTC midnight)
- `scorecard.service.ts:15-25` (`getWeekRange` uses `getDay`/`setHours`)
- `reports.service.ts:101-108,265-272,329-337,393-399`: `new Date('YYYY-MM-DD')` (UTC midnight) is mixed with `setHours(23,59,59,999)` (local time)

Meanwhile EODs and the crons use the company timezone. On a non-UTC host, date ranges are off by hours. Even on UTC, a VA in Manila filing "today" may fall on a different day from the dashboard's "today".

- Fix: use `resolveCompanyDay` and `getDayRangeForDateKey` everywhere, and store a `dateKey` on work entries.

**17. Medium / business logic.** `scorecards/scorecard.service.ts:13,39,158-161,179-182`.

- What: compliance and averages are divided by 7 days, so a five-day VA can reach at most 71% compliance, and a scorecard generated mid-week penalises days that haven't happened yet. The task target is `DAYS_IN_WEEK*3 = 21`, but the comment says "~15 tasks/week (3/day)" (line 36). The week bounds are server-local (Issue #16), and `dateKeyFrom`/`dateKeyTo` reformat server-local instants into company keys (lines 172-173), which can shift by a day.
- Also: scorecards are never generated automatically (no cron), only through the manual POST.
- Fix: decide working days per assignment, prorate to elapsed days, and generate weekly in a cron.

**18. Medium / privacy / ambiguity.** `performanceReview.controller.ts:23-73,133-175` and `performanceReview.routes.ts:93-123`.

- What: a VA can list, read and export their own reviews in **every status** (`draft`, `ai_generated`, `in_review`), including unfinished manager comments and AI drafts. Clients have no access, even though a `sent_to_client` status exists.
- Fix: only show `completed` (or explicitly released) reviews to VAs, and clarify the client flow.

**19. Medium / performance.** `reports.service.ts:125-140,291-307,358-378,409-430`.

- What: N+1 queries. Each row loads `Candidate.findById` and `Client.findById` as **full documents** (including `resumeRawText` and `parsedData`), and the dispositions report also loads a Job and a DispositionReason per row. Queries are unbounded (no limit or streaming). `formatResult` always builds **both** CSV and XLSX, whatever the requested format (lines 75-87).
- Fix: batch lookups with `.select()` (as the EOD report already does at lines 178-192), build only the requested format, and stream large exports.

**20. Medium / observability.** `app.ts:161-169` with `errorHandler.ts:43-46`.

- What: unknown errors are captured twice: once by `setupExpressErrorHandler`, which captures any error without a statusCode, and again by `Sentry.captureException` in `errorHandler`. Mongoose `ValidationError`, `CastError`, `BSONError` and 11000 errors have no `statusCode`, so Sentry captures them even when the API returns 4xx. This contradicts "Sentry (5xx only)" in the prior audit (ATS-CRM-BACKEND-AUDIT.md:23).
- Also: in production, `console.error` is replaced with `args.join(' ')` (logger.ts:77), so `console.error(err)` (errorHandler.ts:45) logs only `err.toString()` with no stack. `logger.error(msg, { error })` serialises Error objects as `{}` under winston's `json()` format (inferred from winston behaviour), so stacks are lost in job logs (e.g. eodCompliance.job.ts:82, companyScheduler.ts:67).
- Fix: use one capture path, set `statusCode` on the mapped errors, and add `winston.format.errors({stack:true})`.

**21. Medium / ops.** `app.ts:172-186`.

- What:
  - Cron jobs and the listener start before the DB connects (claim #16 still holds).
  - The catch message "companySize migration failed" is wrong.
  - There is no SIGTERM handling: Heroku sends SIGTERM on restart, and an in-flight cron run or AI job is killed mid-way.
  - The production rate limit of 100 requests per 15 min per IP across all of `/api` (app.ts:102-108) is very low for an SPA dashboard. Offices behind one NAT share the limit, and a single CRM page makes several calls.
  - Webhooks are mounted at `/api/webhooks`, which falls under the `/api` limiter (app.ts:102), so **Resend webhooks are rate-limited** at 100 per 15 min per Resend IP.
  - The auth limit of 10/15 min also applies to `/auth/refresh-token` (claim #10 still holds; auth.routes.ts:40).
- Fix: await the DB, add graceful shutdown, exempt webhooks, and raise or split the limits.

**22. Medium / bug.** `va-profiles/vaProfile.service.ts:169-214`.

- What: `addVaNote` pushes a plain object and then returns fields read from **that plain object**. Mongoose casts a new subdocument on push and does not mutate the original, so the response has `_id: "undefined"` and `createdAt`/`updatedAt` undefined (inferred from Mongoose semantics).
- Fix: return `profile.noteThread[profile.noteThread.length-1]`.

**23. Medium / bad implementation.** `vaProfile.service.ts:40-58`, `vaProfile.controller.ts:24-35`.

- What: a GET has a side effect. It creates a profile for **any** valid ObjectId, including nonexistent candidates or a client id. Concurrent first reads race on the unique `vaId` index, giving an 11000 error that the controller masks as 404. `upsertVaProfile` (lines 80-84) also creates profiles for arbitrary ids.
- Fix: check that the candidate exists (and is hired), and create the profile on assignment or provisioning.

**24. Medium / error masking (claim #14 still holds).** `clientAccount.controller.ts:34-39,56-65`, `scorecard.controller.ts:32-39`, `vaProfile.controller.ts:28-33`.

- What: every error, including DB failures, an invalid `accountOwnerId` causing BSONError, and validation errors, becomes 404. The services throw `new Error('CLIENT_NOT_FOUND')` strings instead of AppError (clientAccount.service.ts:115-120,130; scorecard.service.ts:121-125).
- Fix: throw `AppError(404)` in the services and drop the try/catch.

**25. Medium / bug.** `survey-reminders` and `jobs/surveyDispatcher.job.ts:29-63`.

- What: reminders for **ended assignments** (or reassigned AMs) are still dispatched, because the dispatcher never checks the assignment status and ending an assignment does not cancel pending reminders (assignment.service.ts:285-326). The email gives no VA, client or assignment context (lines 39-48). "monthly" fires once at day 60 and never recurs (surveyReminder.service.ts:98-104), despite its name. Setting `status: 'completed'` does not set `completedDate`.
- Fix: cancel or skip reminders on end, include context, and make recurrence explicit.

**26. Medium / inconsistency.** `surveyReminder.routes.ts:27` (`dueDate: z.string().date()`) vs `:34` (`dueDate: z.string().datetime()`).

- What: create expects `YYYY-MM-DD` but update expects a full ISO datetime, so a frontend that sends the same format to both fails one of them. `completedDate` is a date string that is assigned straight into a Date field (service:141-142).

**27. Medium / data integrity.** `assignment.service.ts:118-187`.

- What:
  - `createAssignment` doesn't verify that `accountManagerId` is an active user with the `account_manager` role, that the candidate is hired, or that no active assignment already exists for the pair.
  - `status:'ended'` is accepted at creation (routes:18).
  - The assignment is created before `provisionClient`. If provisioning throws, the request fails with a 500 but the assignment and survey reminders already exist (no transaction).
  - `jobId` is accepted (routes:19, types:26) but ignored.
- Fix: add the checks, use a transaction, and remove `jobId` or store it.

**28. Medium / bug.** `assignment.service.ts:258-265` vs `285-326`.

- What: `PATCH` with `status:'ended'` ends an assignment without setting `endDate` (unlike `DELETE`, which defaults it) and logs `updated` rather than `ended`. The change log always records "Start date updated" or "Notes updated" whenever the field is sent, even if unchanged (lines 233-257).

**29. Medium / reports bug.** `reports.service.ts:380-430`.

- What: candidate-level reject rows are added **without honouring the `jobId` or `clientId` filters**, so a dispositions export filtered to one job still includes every candidate-level rejection in the date range. "Rejected By" contains raw ObjectIds (lines 375, 427), not names.
- Also: `${candidate?.firstName} ${candidate?.lastName}` renders "undefined undefined" for missing candidates (lines 131, 297).

**30. Medium / security.** `sockets/ats.socket.ts:8-55`, `crm.socket.ts:8-45` (claim #6 still holds).

- What:
  - The token is checked only at connect, so a socket stays alive after the access token expires or the user is deactivated.
  - Auth happens after the connection is accepted rather than in `io.use` middleware.
  - Every ATS user joins every room regardless of permissions (e.g. a user without `clients.read` still receives `client:*` payloads).
  - `join:job` takes any string with no permission check (ats.socket.ts:44-46).
  - The `user:<id>` and `job:<id>` rooms are never emitted to (dead code).
- Fix: use `io.use` auth, re-verify periodically, and join rooms based on permissions.

**31. Medium / email HTML injection.** `jobs/eodCompliance.job.ts:52-57`, `surveyDispatcher.job.ts:42-46`, `email.ts:9-16`.

- What: candidate and user names (which come from the public apply form for candidates) are interpolated into email HTML without escaping. `substituteVariables` doesn't escape either (claim #12 still holds).
- Fix: HTML-escape interpolated values.

**32. Medium / env coupling.** `config/env.ts:4-31`.

- What: optional integrations are **required**: `SENTRY_DSN`, the three `ZOOM_*` vars and `COMPANY_TIMEZONE` (which already has a DB fallback, companyTimezone.ts:32). Local dev, CI and every script (which import `config/env`) refuse to start without a Sentry DSN and Zoom credentials. `zoom.ts:11-13` and the webhook files (webhook.service.ts:10, webhook.controller.ts:9) bypass `env` and read `process.env` directly. There is no value validation either: `PORT` stays a string and the URLs and expiry values aren't checked.
- Fix: parse env with zod and make the integrations optional.

**33. Medium / dependency.** `package.json:45`.

- What: `"resend": "^6.4.0-canary.0"` depends on a canary pre-release range in production.

**34. Medium / AI request design.** `performanceReview.service.ts:168-169,475-476` with `claude.provider.ts:22-23`.

- What: review generation is a synchronous AI call inside the HTTP request with a 30 s abort and no retry. On Heroku the router times out at 30 s (inferred platform limit), so slow generations return H12 errors while the server keeps working.
- Also: `withRetry` (ai/index.ts:36-55) retries non-retryable errors (missing API key, 4xx), tripling the latency of every failure for the AI jobs.
- Fix: run generation as a background job with polling or a socket notification, and retry only 429 and 5xx.

**35. Medium / privacy.** `performanceReview.service.ts:135-143`, `parseResumeWithAI.ts:143`, `aiCandidacyValidation.job.ts:61`.

- What: full resume text (PII) and real VA and client names are sent to third-party AI providers. Resume text is untrusted input embedded verbatim in prompts (a prompt-injection vector that can manipulate validation or score results). No redaction or data-processing note was found.

#### Low

**36. Low / dead code.**

- `assignment.service.ts:328-363` (`updateAssignmentStatus`)
- `ai/index.ts:69-75` (`callClaude`)
- `coalesce.ts:66-68`
- `companyDay.ts:76-79,86-94,125-127`
- `common.validator.ts:5-7,21-29` (`objectIdSchema`, `paginationSchema`, `dateRangeSchema`)
- `eodSubmission.service.ts:28-41`, which duplicates `buildDateKeyRange`
- `googleMeet.ts`, a set of no-op stubs
- the `user:`/`job:` socket rooms

**37. Low / duplication.**

- Five copy-pasted multer handlers (upload.ts:7-218).
- Repeated name-join blocks in every service.
- The `aiGenerated` default object is repeated four times (performanceReview.service.ts:276-284,513-521,536-544).
- `getEodSubmissionById` checks ownership twice (service lines 151-172 plus controller line 53).
- `aiCandidateScoring.job.ts:123-135` logs the same message twice.

**38. Low / inconsistency.**

- Error codes `FORBIDDEN` (assignment.service.ts:205,300) vs `AUTH_INSUFFICIENT_PERMISSIONS`.
- `regenerateSection` emits no socket event while every other review mutation does.
- The route comment at `performanceReview.routes.ts:105` ("must be registered before /:id") is inaccurate, since `/:id/complete` and `/:id` never collide.
- The dispositions export uses roles under an ATS router that otherwise uses permissions (reports.routes.ts:42-50). ATS recruiters can't export, and AMs (CRM only) are listed but can never pass `requireAppAccess('ats')`.

**39. Low / redundant indexes.**

- `eodSubmission.model.ts:91,96-97`: `assignmentId_1`, `(assignmentId,date)` and `(assignmentId,dateKey -1)` overlap with the unique `(assignmentId,dateKey)` index.
- `assignment.model.ts:35`: `candidateId_1` is a prefix of `(candidateId, clientId)`.
- Extra indexes cost write performance.

**40. Low / type-safety.** Widespread `as any` and `as unknown as` casts.

- Examples: assignment.service.ts:78-93; performanceReview.service.ts:291,313-314,361-362, where `reviewedByUserId` is assigned a raw string with no ObjectId validation. A bad id surfaces as a CastError on save.
- `express.d.ts:18-33` lists fewer permission resources than are actually used.
- Several CRM `types.ts` declare `satisfactionScore?: number` while the zod schema allows null (clientAccount.types.ts:34 vs routes:18; vaProfile.types.ts:31 vs routes:13).

**41. Low / script correctness.**

- `migrate-user-permissions.ts:41` does a shallow merge. A stored resource object (e.g. `team: {read:false}`) completely replaces the newly computed one, so the new grants it was written to add (`team.read`) are not applied to users who already had a `team` key.
- `migrate-activity-action.ts:180,200-202`: unmapped tokens get `target: null` and are counted as "non-entity skip", so the "NOT IN MAP" report is always empty.
- `dedupe-activity-logs.ts:118` loads the whole collection into memory.
- `cleanup-activity-indexes.ts:10-22`: the header describes two indexes but four are targeted.
- `seed-demo.ts` is not idempotent.
- `migrate-disposition.ts` has no dry run and no npm script.
- `seed-disposition-reasons.ts:354-355` has a stale comment claiming app.ts imports it, and its label-based matching re-inserts reasons an admin has renamed (lines 341-347).

**42. Low / security hygiene.**

- `seed-admin.ts:13,21,47-49`: well-known credentials `admin@arista.com` / `Admin@123`, printed to the console, with no forced password change.
- `zoom.ts:65-68`: `waiting_room:false, join_before_host:true` allows uninvited join-before-host on interview meetings.
- `zoom.ts:24`: `account_id` is not URL-encoded.

**43. Low / docs drift.**

- README.md:21-27 lists only five scripts; package.json has 15, and four scripts exist with no npm entry (`migrate-disposition`, `find-*`, `delete-stale-*`).
- README references `.env.example`, which can't be verified.
- ENDPOINTS.md:289 says EOD PATCH takes "same fields, all optional", but omits that `hoursWorked` is honoured (Issue #13) and that empty content is accepted (Issue #14).
- ENDPOINTS.md:332 says VA profile GET is "Created on first read" but doesn't mention that the admin note thread is included (Issue #1).

**44. Low / CORS config fragility.** `app.ts:62-65`, `sockets/index.ts:11-14`.

- What: origins must match exactly. A trailing slash or `www.` variant in the env values silently breaks CORS. Not validated.

**45. Low / correctness.** `crmDashboard.service.ts:82-85,214-230`.

- What: `complianceRate` divides today's EODs on _any_ assignment (including on_hold or ended) by the number of active assignments, so it can exceed 100%. It is 100 when there are no active assignments in the main path but 0 in `emptyDashboard()`. The "week" is 8 calendar days (today minus 7 through today, lines 30-32).

**46. Low / UX.** `eodCompliance.job.ts:20-84`.

- What: reminders go out every calendar day, including weekends and holidays, to every active assignment. No schedule or working-days concept exists (business rule ambiguity, inferred). The per-assignment loop also sends one email per assignment, so a VA with two active assignments gets two identical emails.

---

### Prior audit (ATS-CRM-BACKEND-AUDIT.md) claims: still true or fixed?

Verified against code in my scope (auth claims only where I checked a file).

**Section 10, numbered findings**

| #   | Claim                                                                                                 | Status                                | Evidence                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AMs not scoped everywhere                                                                             | **Holds**, and is broader than stated | Survey reminders, client accounts, VA profiles and scorecard generation (Issue #8). The dashboard is also scoped by candidate, not assignment (Issue #3), and the socket `assignments` room is unscoped. |
| 3   | Permission changes not instant; no per-request check                                                  | **Holds**                             | authenticate.ts:17-36                                                                                                                                                                                    |
| 5   | List queries not validated; operator injection; `limit` uncapped                                      | **Holds** for every CRM list          | Issue #7                                                                                                                                                                                                 |
| 6   | Socket tokens never rechecked; ATS rooms not permission-based                                         | **Holds**                             | ats.socket.ts:35-42                                                                                                                                                                                      |
| 10  | Production-only limits; auth limit covers refresh                                                     | **Holds**                             | app.ts:101-117. Additionally, the webhooks are rate-limited (Issue #21).                                                                                                                                 |
| 12  | Unescaped HTML in emails                                                                              | **Holds** for my scope                | email.ts:9-16, cron emails                                                                                                                                                                               |
| 13  | MIME-only upload checks                                                                               | **Holds**                             | upload.ts:16,83-85                                                                                                                                                                                       |
| 14  | Error handler echoes keyValue and validation errors; uses `console.error`; client-account 404 masking | **Holds**                             | errorHandler.ts:13,17-24,45; clientAccount.controller.ts:37,63. Scorecard and VA-profile controllers do the same.                                                                                        |
| 15  | Mixed server and company timezone                                                                     | **Holds**                             | Issue #16                                                                                                                                                                                                |
| 16  | Startup doesn't wait for DB; wrong log message                                                        | **Holds**                             | app.ts:172-186                                                                                                                                                                                           |
| 17  | `resumeValidation` switch drives two jobs; hard-coded models                                          | **Holds**                             | aiCandidacyValidation.job.ts:46; aiResumeValidation.job.ts:42; claude.provider.ts:43; openai.provider.ts:35                                                                                              |
| 19  | Single-process assumptions                                                                            | **Holds**                             | coalesce.ts; app.ts:175. The cron-lock design is also not sufficient (Issue #9).                                                                                                                         |
| 20  | No tests                                                                                              | **Holds**                             | No test files; no test script in package.json                                                                                                                                                            |
| 21  | xlsx 0.18                                                                                             | **Holds**                             | package.json:50                                                                                                                                                                                          |

**Other sections**

| Section | Claim                                            | Status / evidence                                                                            |
| ------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| §1      | Monitoring is "Sentry (5xx only)"                | **Inaccurate.** 4xx Mongoose errors are captured, and errors are captured twice (Issue #20). |
| §1      | "Environment (all required)" list                | **Accurate** (env.ts:4-25), but see Issue #32.                                               |
| §3      | Pipeline description                             | **Accurate**                                                                                 |
| §4      | Ownership via crmScope and assignmentScope       | **Accurate in src. Not in dist** (Issue #10).                                                |
| §6      | "takes a cronlocks lock so one instance runs it" | **Not guaranteed** (Issue #9)                                                                |
| §7      | Socket rooms description                         | **Accurate**                                                                                 |
| §8      | Unique indexes listed                            | **Accurate** (eodSubmission.model.ts:99; scorecard.model.ts:36-39; vaProfile.model.ts:34)    |
| §8      | "Work entries are soft-deleted"                  | **True**, but soft-deleted rows stay reachable by id (Issue #15).                            |
| §9      | Scripts table                                    | **Accurate** apart from the missing npm entries (Issue #43).                                 |

**Not covered by the prior audit (new findings):** Issues #1, #2, #4, #5, #6, #9, #10, #11, #12, #13, #22, #25, #29.

---

_End of audit. Read-only review; no code, config or repository was changed._
