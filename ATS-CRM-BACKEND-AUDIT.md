# ATS-CRM Backend — Technical Audit

Package `ats-crm-backend-v2`. Reviewed against the code on 2026-10-10 (after the security and bug-fix commits up to `b2846bb`).
Companion docs: [ENDPOINTS.md](ENDPOINTS.md) (every route), `ats/BUSINESS_LOGIC.md` (rules and data), `crm/BUSINESS_LOGIC.md` (CRM).

---

## 1. Stack & configuration

| Layer | Technology |
| ----- | ---------- |
| Runtime | Node.js ≥ 20, TypeScript 5 (CommonJS, `strict`, target ES2020) |
| Framework | Express 4 with `helmet`, `cors`, `cookie-parser`, `express-rate-limit` |
| Database | MongoDB via Mongoose 8 |
| Auth | JWT access + refresh (httpOnly cookie), `bcryptjs` (12 rounds) |
| Validation | Zod 3 (`validate()` middleware) |
| Realtime | Socket.IO 4 |
| Email | Resend (+ Svix for webhook signatures) |
| Files | Cloudinary, Multer (memory storage) |
| AI | Claude (`claude-sonnet-4-20250514`) or OpenAI (`gpt-4o`) over `fetch`, chosen in Settings |
| Documents | `pdfkit` (review PDFs), `xlsx` (report export, write only), `pdf-parse` + `mammoth` (resume text) |
| Jobs | `node-cron` + a Mongo lock |
| Monitoring | Sentry (5xx only), Winston (coloured dev output, JSON in production) |
| Package manager | pnpm ≥ 10 (security `overrides` pinned in `package.json`) |

**Scripts:** `dev` (ts-node-dev), `build` (`tsc` → `dist`), `start` (`node dist/app.js`), plus seed and migration scripts (§9). Heroku runs `build` automatically; `Procfile` is `web: node dist/app.js`.

**Environment (all required, startup throws if missing):** `PORT`, `NODE_ENV`, `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES`, `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`, `RESEND_API_KEY`, `ZOOM_ACCOUNT_ID/CLIENT_ID/CLIENT_SECRET`, `COMPANY_TIMEZONE`, `COMPANY_EMAIL`, `COMPANY_NAME`, `SENTRY_DSN`, `ATS_FRONTEND_URL`, `CRM_FRONTEND_URL`. Optional: `RESEND_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.

**Deploy:** two remotes — GitHub `origin` and `heroku` (push to both).

---

## 2. Structure

```
src/
├── app.ts                 # middleware, routers, startup
├── config/                # env, db, cloudinary
├── features/<name>/       # <name>.model | .types | .service | .controller | .routes (+ extras)
│   activity-logs, applications, assignments, auth, candidates, client-accounts, clients,
│   dashboard/{ats,crm}, disposition-reasons, email-templates, emails, eod-reminders,
│   eod-submissions, interview-scorecards, interviews, jobs, performance-reviews,
│   pipeline-templates, reports, scorecards, settings, survey-reminders, tags, users,
│   va-profiles, webhooks, work-entries
├── jobs/                  # cron + AI background jobs, cron lock
├── shared/
│   ├── middleware/        # authenticate, optionalAuthenticate, authorize, upload, errorHandler
│   ├── utils/             # AppError, catchAsync, response, email, zoom, pdf, timezone, companyDay, ai/, ...
│   └── validators/        # validate(), objectId, http(s) URL, pagination
├── sockets/               # /ats and /crm namespaces
└── scripts/               # seeds and one-off migrations
```

Convention: routes → (validate, guards) → controller (thin, `catchAsync`) → service (rules, DB, logs, socket emits). Models expose `toSafeObject()`; there is no `populate()` — names are joined by explicit batch queries.

---

## 3. Request pipeline (`app.ts`)

1. Sentry init, then Express. `trust proxy 1` (Heroku).
2. `helmet`, `cors` (exactly the two frontend origins, credentials on), JSON body parser (keeps the raw body for the Resend webhook), cookie parser, request logger.
3. **Production only:** `/api` 100 req / 15 min, `/api/v1/auth` 10 req / 15 min, per IP.
4. Routers: `/api/v1/shared/{users,settings,activity-logs}`, `/auth`, `/ats/*`, `/crm/*`, `/reports` and `/crm/reports` (same router), `/api/webhooks`.
5. 404 `RESOURCE_NOT_FOUND`, Sentry handler (5xx only), `errorHandler`.
6. Startup: connect DB → seed email templates; cron jobs start and the server listens immediately (not after the DB), then sockets initialise.

**Error handler** maps `AppError` (status + code), Mongoose validation (400), duplicate key (409), bad id (400) and JWT errors (401); anything else is a 500 `INTERNAL_SERVER_ERROR` sent to Sentry.

---

## 4. Auth & authorization

- **Tokens:** access JWT carries `_id`, name, `roles`, `appAccess`, `permissions`, `candidateRef`, `clientRef`. Refresh JWT carries only `_id`; the current one is stored on the user per app (`refreshTokenAts` / `refreshTokenCrm`) and compared on refresh.
- `authenticate` only verifies the signature and expiry — **no DB lookup per request**. Role, permission and deactivation changes reach a user when their token is refreshed. Refresh and login do check `isActive`.
- **Guards:** `requireAppAccess(app)`, `requirePermission(resource, action)` (hierarchy `manage > write > read`), `requireRoles(...)`. Admin bypasses all three. ATS routes use permissions; CRM routes use role lists.
- **Ownership** is enforced in controllers/services: `crmScope.ts` (VA by `candidateRef`, client by `clientRef`) and `assignmentScope.ts` (account managers by `accountManagerId`).
- Roles and default permissions are built in `user.service.ts` (`buildPermissionsForRoles`). Only an admin can grant or alter `admin`.
- Public routes: job list/detail/apply, resume parse, `/auth/*`, the Resend webhook. `GET /ats/jobs*` uses optional auth: no token = trimmed open-jobs view.

---

## 5. Integrations

| Service | Where | Notes |
| ------- | ----- | ----- |
| Resend | `shared/utils/email.ts`, `emails`, `webhooks` | From address pinned to `COMPANY_EMAIL`; display name from Settings; inbound replies matched to candidates/threads; retried webhooks are de-duplicated |
| Cloudinary | `config/cloudinary.ts` | `ats/resumes`, `ats/portfolios` (raw); `ats/avatars`, `ats/logos` (image); deleted with the candidate |
| Zoom | `shared/utils/zoom.ts` | Server-to-server OAuth, token cached; create/update/delete meetings. Google Meet is a manual link (no API) |
| Claude / OpenAI | `shared/utils/ai/` | 30 s timeout, 3 tries with backoff, JSON extracted from replies, provider cached until Settings change |
| Sentry / Winston | `app.ts`, `shared/utils/logger.ts` | |

---

## 6. Background work

**Cron (`jobs/`)** — a one-minute tick compares the wall clock in the **company timezone** (Settings, 60 s cache), runs once per local day, is not replayed after downtime, and takes a `cronlocks` lock (4-minute TTL) so one instance runs it.

| Job | Time | Action |
| --- | ---- | ------ |
| EOD compliance | 17:00 | Active assignments with no EOD for today's `dateKey` → email the VA, save an `EodReminder`, log |
| Survey dispatcher | 09:00 | Pending reminders due by end of today → email the account manager, mark `sent`, log |

**AI jobs** (fire-and-forget, never block a request): resume parsing, candidacy validation, resume validation, candidate scoring. Each is idempotent (skips if a result exists), respects the Settings switches, and is **coalesced in-process** per entity (`shared/utils/coalesce.ts`). That only works on a single instance; with several, a database lock would be needed.

---

## 7. Realtime

`/ats` and `/crm` namespaces; the token is verified once at connect. ATS clients join `applications`, `candidates`, `jobs`, `clients`, `tags`, `pipeline-templates`, `email-templates`, `user:<id>` (and `job:<id>` on request). CRM: `user:<id>`, and the `assignments` room **only for admin and account managers**. Services emit `<resource>:created|updated|deleted` plus a few domain events; the CRM UI does not use sockets yet. Details: `ats/BUSINESS_LOGIC.md` §8.

---

## 8. Data

23 collections (list and fields in `ats/BUSINESS_LOGIC.md` §3). Notes that matter operationally:

- Key unique indexes: `applications (candidateId, jobId)`, `eodsubmissions (assignmentId, dateKey)`, `scorecards (vaId, assignmentId, weekStart)`, one default pipeline template (partial index), `vaprofiles.vaId`.
- Activity logs are fire-and-forget and indexed by resource, performer, action and time.
- Work entries are soft-deleted; candidate permanent delete cascades by hand across ten collections.
- Settings is a singleton upserted on first read.
- Legacy fields kept for old documents: interview `round` / `interviewType`, `Candidate.crmProfile`, EOD `summaryOfWork`.

---

## 9. Scripts (`src/scripts`, run with `pnpm <name>` or `ts-node`)

| Kind | Scripts |
| ---- | ------- |
| Seeds | `seed-admin`, `seed-demo`, `seed-disposition-reasons`, `seed-email-templates` (the last also runs on every boot) |
| Migrations (one-off) | `migrate-user-permissions`, `migrate-company-timezone`, `align-email-sender`, `migrate-eod-time`, `migrate-disposition`, `migrate-activity-action`, `migrate-activity-timestamps` |
| Activity-log repair | `backfill-activity-performers`, `dedupe-activity-logs`, `cleanup-activity-indexes` |
| Diagnostics / cleanup | `find-approved-without-application`, `find-orphan-resumes`, `delete-stale-approved-candidates` (destructive) |

Read each script's header before running it against production data.

---

## 10. Findings (open)

Security fixes made on 2026-10-08/10 (ownership checks, `isActive` enforcement, public job trimming, http(s)-only links, admin-role guard, tag regex, CSV formulas, socket rooms, webhook de-duplication) are in place. What remains, most important first:

**Access control**
1. **Account managers are not scoped everywhere.** They can read all survey reminders, all activity logs, all client accounts and VA profiles, and generate scorecards for any VA. Assignments, work entries, EODs, reminders, reviews, scorecard reads and reports are scoped.
2. **Login does not check app access.** A user can obtain a session for an app they cannot use; routes still refuse them.
3. **Permission and role changes are not instant** (token-baked), and there is no `tokenVersion` or per-request check. Deactivation is only enforced at login and refresh.
4. **User "delete" is a hard delete** (`DELETE /shared/users/:id`), leaving `createdBy`, assignments and logs pointing at a missing user. There is no last-admin protection.
5. **List endpoints other than jobs do not validate query values.** With Express's extended parser, an authenticated user can send operators such as `?status[$ne]=x`. `limit` is uncapped on most lists.
6. Socket tokens are never re-checked after connect, and the ATS namespace gives every ATS user all event rooms regardless of permission.

**Auth & secrets**
7. Refresh, reset and invite tokens are stored in plaintext; refresh tokens do not rotate and a second login on the same app replaces the first.
8. `POST /shared/users` returns the invite token in its response.
9. Forgot-password always links to the ATS reset page, even for CRM users.
10. Rate limiting is production-only; the 10 / 15 min auth limit also covers `/refresh-token`, which SPAs call often. No per-account lockout. `USER_INACTIVE` is returned before the password check.
11. `sameSite: none` cookies with no CSRF token or Origin check on `refresh-token` / `logout`.

**Input & output**
12. Email templates and the invite email insert names and variables into HTML without escaping (an applicant's name goes into the confirmation email).
13. Uploads are checked by the client-sent MIME type only (no magic-byte check) and held in memory; the public AI parse endpoints have only the global rate limit. Resume text is untrusted input to AI prompts.
14. The error handler echoes duplicate-key values and raw Mongoose validation errors, and uses `console.error`. `clientAccount` controllers turn every error into a 404.

**Correctness & operations**
15. Time handling is inconsistent: work-entry date filters, the dashboard's "work entries today" and the weekly scorecard week use the **server** timezone, while EODs, the crons and EOD counts use the **company** timezone.
16. Startup does not wait for the database: crons and the listener start first, and a seeding error is logged as "companySize migration failed".
17. The `ai.resumeValidation` switch controls two jobs (candidacy and resume validation); the model names are hardcoded.
18. Inbound email threading falls back to "last outbound email to this sender" when no reply header matches, which can attach a reply to the wrong thread.
19. Single-process assumptions: AI-job coalescing, and `seedEmailTemplates()` on every boot.
20. **No automated tests** (no test script or files).
21. Dependencies: re-run `pnpm audit` before releases; `xlsx` 0.18 has no fixed release (used for writing only).
