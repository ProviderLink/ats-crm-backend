# ATS / CRM API Endpoints

Base URL: `/api/v1` (webhooks are under `/api/webhooks`). This file lists every route in the code. Business rules behind them are in `ats/BUSINESS_LOGIC.md` and `crm/BUSINESS_LOGIC.md`.

## Conventions

**Auth.** Send `Authorization: Bearer <accessToken>`. Every route needs it except those marked **Public**. Roles, `appAccess` and permissions come from the token, so changes apply after the next refresh. Admin passes every role and permission check.

Each router checks the app first (`ats` or `crm`, admin always passes), then either a permission (`resource.action`) or a role list. The guard column below shows what is required.

**Response envelope.**

```json
{ "success": true, "data": {}, "message": "…", "meta": { "total": 0, "page": 1, "limit": 20, "totalPages": 0 } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [{ "field": "", "message": "" }] } }
```

`meta` is present on lists. Common error codes: `VALIDATION_ERROR` 400, `INVALID_ID` 400, `AUTH_TOKEN_INVALID` / `AUTH_TOKEN_EXPIRED` / `USER_INACTIVE` 401, `AUTH_INSUFFICIENT_PERMISSIONS` 403, `*_NOT_FOUND` 404, `DUPLICATE_KEY` / `*_ALREADY_*` 409.

**Pagination.** `page` (default 1) and `limit` (default 20; activity logs 50). Most list endpoints do not cap `limit`.

**Rate limits (production only).** 100 requests / 15 min / IP on `/api`; 10 / 15 min on `/auth`.

**Uploads** are `multipart/form-data`, held in memory. Resume: PDF or DOCX, 5 MB. Avatar/logo: JPEG or PNG, 2 MB. Portfolio: PDF, ZIP or image, 10 MB.

---

## Auth — `/auth`

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| POST | `/login` | Public | `{ email, password, app?: 'ats'\|'crm' }` (default `ats`). Returns `{ user, accessToken }` and sets the `refreshTokenAts` or `refreshTokenCrm` cookie |
| POST | `/refresh-token` | Public (cookie) | `app` in query or body (default `ats`). Returns `{ user, accessToken }`. Fails for inactive users |
| POST | `/logout` | Token | `app` in query or body; clears that app's token, or both if omitted |
| POST | `/forgot-password` | Public | `{ email }`. Always succeeds; emails a 1-hour link (ATS reset page) to active users |
| POST | `/reset-password` | Public | `{ token, password≥8 }`. Accepts a reset or invite token; only an invite token re-activates |
| POST | `/change-password` | Token | `{ currentPassword, newPassword≥8 }`; clears refresh tokens |
| POST | `/verify-email` | Public | `{ token }` invite token; marks the invite accepted |
| POST | `/set-password` | Public | `{ token, password≥8 }` invite token; activates the user |

## Users & team — `/shared/users`

All need a token (no app check).

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| PATCH | `/me` | any | `{ firstName?, lastName?, phone? }` |
| POST | `/me/avatar` | any | file field `file` |
| GET | `/crm-accounts` | any | CRM client and VA users, scoped: admin all, AM only their assignments, others empty |
| GET | `/` | `team.read` | Query: `role`, `roles` (comma list), `appAccess`, `isActive`, `page`, `limit` |
| POST | `/` | `team.write` | `{ firstName, lastName, email, phone?, roles[] }`. Creates an invite (24 h) and emails it. Only an admin may grant `admin`. Response includes `inviteToken` |
| GET | `/:id` | `team.read` | |
| PATCH | `/:id` | `team.write` | `firstName`, `lastName`, `phone`, `roles`, `isActive`. Roles rebuild access and permissions. Setting `isActive:false` clears refresh tokens. Non-admins cannot change an admin |
| DELETE | `/:id` | `team.manage` | **Hard delete** (not a deactivation). Not for yourself or, for non-admins, an admin |
| PATCH | `/:id/permissions` | `team.manage` | `{ permissions: { resource: { action: boolean } } }`, merged onto the current permissions |
| POST | `/provision-client` | `team.write` | `{ clientId }`; creates or re-invites the client's CRM user from its primary contact |
| POST | `/provision-va` | `team.write` | `{ candidateId }` |
| POST | `/:id/revoke-crm` | `team.manage` | Removes `crm` access, sets inactive, clears tokens. Not for yourself |

## Settings — `/shared/settings`

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | `settings.read` | Singleton |
| PATCH | `/` | `settings.write` | `email.fromName`, `ai { provider: claude\|openai, resumeValidation, candidateScoring, resumeParsing }`, `companyTimezone` (IANA), `applicationConfirmation { enabled, templateId }`. `email.fromEmail` must equal the company address |

## Activity logs — `/shared/activity-logs`

Guard: app `ats` (so account managers, who only have CRM access, are refused). The global list needs `activityLogs.read`. A single record's activity (`/:resourceType/:resourceId`) is also readable with that record's own read permission: `candidates.read` for `candidate` and `application`, `interviews.read` for `interview`, `jobs.read` for `job`, `clients.read` for `client`. Other record types need `activityLogs.read`.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/` | Query: `resourceType`, `resourceId`, `action`, `performedBy`, `page`, `limit` |
| GET | `/:resourceType/:resourceId` | `includeRelated=true` also returns entries that point at the resource; `page`, `limit` |

---

## ATS — Clients — `/ats/clients`

Guard: app `ats`.

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | `clients.read` | Query: `status`, `search`, `page`, `limit` |
| POST | `/` | `clients.write` | `companyName`, `email` (unique), `phone`, `website` (http(s) only), `industry`, `companySize`, `description`, `address`, `tags`. New clients are `active` |
| GET | `/:id` | `clients.read` | |
| PATCH | `/:id` | `clients.write` | Same fields plus `status` (`active\|inactive\|suspended`). `address` is merged |
| DELETE | `/:id` | `clients.manage` | Fails with `CLIENT_HAS_ACTIVE_JOBS` if a job is `open` or `on_hold` |
| POST | `/:id/logo` | `clients.write` | file field `logo` |
| POST | `/:id/contacts` | `clients.write` | `{ name, email, phone?, position?, isPrimary? }` (a new primary clears the others) |
| PATCH | `/:id/contacts/:contactId` | `clients.write` | |
| DELETE | `/:id/contacts/:contactId` | `clients.write` | |
| PATCH | `/:id/crm-profile` | `clients.write` | `healthStatus`, `baaSign` (alias `baaSigned`), `baaSignedDate`, `emrSystem`, `onboardingComplete`, `sopReceived`, `satisfactionScore`, `openIssuesCount`, `lastClientCheckin`, `notes`, `accountOwnerId`, `serviceStartDate`, `primaryContact`, `secondaryContact` |
| GET | `/:clientId/notes` | admin | Newest first |
| POST | `/:clientId/notes` | admin | `{ method: call\|email\|meeting\|message\|other, content ≤5000 }` |
| PATCH | `/:clientId/notes/:noteId` | admin | |
| DELETE | `/:clientId/notes/:noteId` | admin | |

## ATS — Candidates — `/ats/candidates`

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| POST | `/public/parse` | **Public** | file `resume`/`file`; returns parsed data, saves nothing |
| POST | `/public/upload-and-parse` | **Public** | applicant fields + resume; returns `{ resumeOriginalName, resumeRawText, parsedData }`, saves nothing |
| GET | `/` | `candidates.read` | Query: `status`, `inTalentPool`, `eligibilityStatus`, `includeIneligible`, `search`, `tags` (comma), `page`, `limit`. Banned candidates are hidden unless asked; `eligibilityStatus=permanently_ineligible` is admin-only |
| POST | `/` | `candidates.write` | Quick import. multipart: `firstName`, `lastName`, `email`, `phone`, resume, optional profile fields, `tags`, `parsedData` (JSON). Status becomes `approved`; no application is created |
| GET | `/:id` | `candidates.read` | Banned candidates: admin only. `resumeRawText` is omitted |
| PATCH | `/:id` | `candidates.write` | `firstName`, `lastName`, `phone`, `videoIntroUrl` (http(s)), `videoIntroSource`, `yearsOfExperience`, `tags`, `parsedData`, `englishProficiency`, `currentSalaryPHP/USD`, `reasonForLeaving`, `cityOfResidence` |
| DELETE | `/:id` | `candidates.manage` | Only for permanently ineligible candidates, by an admin, and not on legal hold. Deletes files and all related records |
| POST | `/:id/avatar` | `candidates.write` | file `avatar` |
| PATCH | `/:id/talent-pool` | `candidates.write` | `{ action: add\|remove, notes? }` |
| POST | `/:id/approve` | `candidates.write` | `{ jobId? }` (defaults to the job they applied to). Creates the application and approves it into the first stage. Only `pending` candidates |
| PATCH | `/:id/reject` | `candidates.write` | In Review candidates only. `{ rejectionReasonId, destination?: candidate_pool\|permanently_ineligible, internalNotes? }`. 409 if they hold a live application |
| POST | `/:id/assign-job` | `candidates.write` | `{ jobId, startStageId? }`. Takes them out of the Talent Pool |
| POST | `/:id/change-job` | `candidates.write` | `{ applicationId, targetJobId, startStageId? }`. New application first, then the old one is closed as a move. Target job must be `open` and have a pipeline |
| PATCH | `/:id/eligibility` | admin | `{ eligibilityStatus, reason? }` |
| PATCH | `/:id/restore` | admin | `{ jobId }`. Banned → `pending` (In Review); 409 if an application already exists for that job |
| PATCH | `/:id/legal-hold` | admin | `{ legalHold: boolean }` |

### Portfolio (work samples)

Optional link, uploaded file, or both. Collected only on the public apply form. Stored on the candidate as `portfolioUrl`, `portfolioFileUrl` (Cloudinary `ats/portfolios`, raw) and `portfolioFileName`. On a re-apply that is still allowed to refresh the profile (§ Apply), a new value replaces the old one and the old Cloudinary file is deleted; omitted fields stay as they are. The file is uploaded only at final submit, so abandoned applications leave nothing behind. Deleting a candidate removes the file.

## ATS — Jobs — `/ats/jobs`

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | **Public** (optional token) | Query: `clientId`, `status`, `search`, `page`, `limit` (≤10000). Anonymous: only `open` jobs, public fields only, `clientId` ignored |
| GET | `/:id` | **Public** (optional token) | Anonymous: draft → 404; public fields only. A bad or expired token returns 401 |
| POST | `/:id/apply` | **Public** | See below |
| POST | `/` | `jobs.write` | Created as `draft`. `title`, `description`, `clientId`, `jobType`, `locationType`, `location`, `experienceLevel`, `priority`, `openings`, `requirements`, `responsibilities`, `skills`, `benefits`, `tags`, `salaryRange`, `applicationDeadline`, `startDate`. The default pipeline template is copied in |
| POST | `/generate-draft` | `jobs.write` | `{ notes (10–20000 chars) }` → AI draft, nothing saved |
| POST | `/standardize` | `jobs.write` | `{ requirements?, responsibilities?, skills?, benefits? }` → tidied lists, nothing saved |
| PATCH | `/:id` | `jobs.write` | Same fields as create, except `clientId` |
| PATCH | `/:id/status` | `jobs.write` | `{ status }`. `draft→open`, `open→on_hold\|closed`, `on_hold→open\|closed`, `closed` is final |
| PATCH | `/:id/pipeline` | `jobs.write` | `{ templateId, stageMapping? }`. Remaps only `approved` applications by stage name (or the mapping), else to the first stage |
| DELETE | `/:id` | `jobs.manage` | Blocked while pending/approved applications exist |

### Apply — `POST /ats/jobs/:id/apply`

multipart: `firstName`, `lastName`, `email`, `phone`, resume (`resume` or `file`), `resumeRawText?`, `parsedData?` (JSON), `videoIntroUrl?`, `portfolioUrl?`, `portfolioFile?`, `yearsOfExperience?`, `englishProficiency?`, salaries, `reasonForLeaving?`, `cityOfResidence?`. The job must be `open`.

- The candidate is found by email, then phone, or created (`pending`, `appliedJobId` set). Client-supplied candidate ids are ignored.
- An existing candidate's profile and files are refreshed only while still `pending`, not in a pipeline and not banned; otherwise the record is untouched.
- A banned candidate gets `{ received: true, blocked: true }` and nothing else happens.
- No application is created. Resume parsing, candidacy validation and the optional confirmation email run in the background.

## ATS — Applications — `/ats/applications`

Guard: app `ats`; candidate routes use `candidates.*`, interview routes use `interviews.*`.

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | `candidates.read` | Query: `jobId`, `candidateId`, `clientId`, `phase`, `page`, `limit` |
| GET | `/:id` | `candidates.read` | |
| PATCH | `/:id/approve` | `candidates.write` | `pending` → `approved`, first stage |
| PATCH | `/:id/reject` | `candidates.write` | `{ rejectionReasonId?, reason?, destination?, internalNotes? }`. Destination applies only on the candidate's last live application |
| PATCH | `/:id/move-to-talent-pool` | `candidates.write` | `{ notes? }`. Closes this application as a move (no reason) and pools the candidate |
| PATCH | `/:id/stage` | `candidates.write` | `{ stageId }`; `approved` applications only |
| PATCH | `/:id/hire` | `candidates.write` | `approved` → `hired`; candidate becomes `hired`; VA user created and invited |
| PATCH | `/:id/notes` | `candidates.write` | `{ notes }` |
| GET | `/:applicationId/interviews` | `interviews.read` | Query: `status`, `interviewerId`, `page`, `limit` |
| POST | `/:applicationId/interviews` | `interviews.write` | See Interviews |
| GET | `/:applicationId/interviews/:id` | `interviews.read` | |
| PATCH | `/:applicationId/interviews/:id` | `interviews.write` | |
| DELETE | `/:applicationId/interviews/:id` | `interviews.write` | Cancels |
| POST | `/:applicationId/interviews/:id/feedback` | `interviews.write` | |

## ATS — Interviews — `/ats/interviews`

Guard: app `ats`.

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | `interviews.read` | Query: `candidateId`, `jobId`, `applicationId`, `status`, `interviewerId`, `page`, `limit`. Includes `interviewerNames` |
| POST | `/` | `interviews.write` | `{ applicationId, candidateId, jobId, clientId, title, type, scheduledAt (ISO), interviewerIds?, meetingDetails? }` |
| GET | `/:id` | `interviews.read` | |
| PATCH | `/:id` | `interviews.write` | `title`, `type`, `scheduledAt`, `interviewerIds`, `meetingDetails`, `status` (only `scheduled → completed\|no_show`) |
| DELETE | `/:id` | `interviews.write` | Cancels (status `cancelled`) |
| POST | `/:id/feedback` | `interviews.write` | `{ rating 1–5, notes, recommendation }`. Assigned interviewer only, once |

Server-owned: duration (60 min) and timezone (company). The nested create takes `{ title, type, jobId?, scheduledAt, interviewerIds?, meetingDetails? }`. `zoom` creates a Zoom meeting; `google_meet` needs a pasted `meetingDetails.link`; `phone_call` uses `phoneNumber`; `in_person` uses `address`. An overlapping slot for any interviewer returns 409 `INTERVIEW_CONFLICT`. Candidate and interviewers are emailed on create, update and cancel.

## ATS — Interview scorecards — `/ats/interview-scorecards`

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| POST | `/` | `interviewScorecards.write` | `candidateId`, `jobId`, `interviewerId?` (defaults to you), `interviewDate`, the five category inputs and notes, required `finalRecommendation`. Scores are computed by the server |
| GET | `/` | `interviewScorecards.read` | **`candidateId` required**; `page`, `limit` (≤100) |
| GET | `/:id` | `interviewScorecards.read` | |
| PATCH | `/:id` | `interviewScorecards.write` | Full re-save (same fields, without `candidateId` and `jobId`) |

## ATS — Disposition reasons — `/ats/disposition-reasons`

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/active` | `candidates.read` | Active reasons for the reject dialog; `stageName` filters by stage |
| GET | `/` | `settings.read` | Query: `isActive`, `category` |
| GET | `/:id` | `settings.read` | |
| POST | `/` | `settings.write` | `{ label, category, isActive?, order?, applicableStages?, defaultEligibility?, requireInternalNotes? }` |
| PATCH | `/:id` | `settings.write` | |
| PATCH | `/:id/deactivate` | `settings.write` | |
| PATCH | `/:id/reorder` | `settings.write` | `{ order }` |
| DELETE | `/:id` | `settings.write` | 409 `DISPOSITION_REASON_IN_USE` once used; deactivate instead |

## ATS — Pipeline templates — `/ats/pipeline-templates`

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | `pipelineTemplates.read` | Query: `isActive` |
| POST | `/` | `pipelineTemplates.write` | `{ name, description?, isDefault?, stages[{ name, color, order, isActive, icon }] }` (≥1 stage, unique `order`). 409 if another template is already the default |
| GET | `/:id` | `pipelineTemplates.read` | |
| PATCH | `/:id` | `pipelineTemplates.write` | Same fields plus `isActive`. The default cannot be deactivated |
| DELETE | `/:id` | `pipelineTemplates.write` | Not if a job uses it, and not the default |

## ATS — Tags — `/ats/tags`

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | `tags.read` | All tags, by name |
| POST | `/` | `tags.write` | `{ name ≤50, color #rrggbb }`; 409 on a duplicate name (case-insensitive) |
| PATCH | `/:id` | `tags.write` | |
| DELETE | `/:id` | `tags.manage` | Does not remove the tag from records that use it |

## ATS — Email templates — `/ats/email-templates`

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | `emailTemplates.read` | Query: `type`, `isActive` |
| POST | `/` | `emailTemplates.write` | `{ name, subject, bodyHtml, bodyText, type, variables?, isDefault? }`. One default per type |
| GET | `/:id` | `emailTemplates.read` | |
| PATCH | `/:id` | `emailTemplates.write` | plus `isActive` |
| DELETE | `/:id` | `emailTemplates.write` | |

Types: `interview`, `offer`, `rejection`, `follow_up`, `eod_reminder`, `survey_reminder`, `general`, `application_confirmation`. Variables: `candidateName`, `candidateEmail`, `jobTitle`, `clientName`, `interviewDate`, `interviewTime`, `interviewType`, `meetingLink`, `interviewerName`, `companyName`, `senderName`.

## ATS — Emails — `/ats/emails`

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | `emails.read` | Query: `candidateId`, `jobId`, `applicationId`, `status`, `direction`, `threadId`, `page`, `limit` |
| POST | `/` | `emails.write` | `{ to[], cc?, bcc?, subject ≤200, bodyHtml, bodyText?, templateId?, context?, inReplyTo?, threadId?, variables? }`. Sent from the company address. Returns 201 even if delivery failed (`status: failed`) |
| GET | `/thread/:threadId` | `emails.read` | Oldest first |
| GET | `/:id` | `emails.read` | |
| PATCH | `/:id/read` | `emails.read` | Marks as read |
| DELETE | `/:id` | `emails.write` | |
| POST | `/:id/resend` | `emails.write` | Failed emails only |

## ATS — Dashboard — `/ats/dashboard`

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | `dashboard.read` | Counts, 10 recent applications, 10 upcoming interviews, per-job stats |

---

## CRM

All CRM routes need app `crm`. Role lists are `requireRoles`; admin always passes. **VA** and **client** results are limited to their own records, and **account managers** to their own assignments (see `crm/BUSINESS_LOGIC.md`).

### Assignments — `/crm/assignments`

| Method | Path | Roles | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | admin, AM, client, VA | Query: `candidateId`, `clientId`, `accountManagerId`, `status`, `page`, `limit`. Adds `candidateName`, `companyName`, `accountManagerName/Email` |
| POST | `/` | admin, AM | `{ candidateId, clientId, serviceType, startDate, endDate?, accountManagerId, status?, notes? }`. An AM can only name themselves. Provisions the client user and creates survey reminders |
| GET | `/:id` | admin, AM, client, VA | |
| PATCH | `/:id` | admin, AM | `serviceType`, `startDate`, `endDate`, `accountManagerId`, `status`, `notes`. Not when ended |
| DELETE | `/:id` | admin, AM | Ends the assignment |

### Work entries — `/crm/work-entries`

| Method | Path | Roles | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | admin, AM, client, VA | Query: `assignmentId`, `candidateId`, `clientId`, `entryDate`, `dateFrom`, `dateTo`, `page`, `limit`. Deleted entries are excluded |
| POST | `/` | VA | `{ assignmentId, entryDate, entryTime HH:MM, taskCategory, taskDescription, timeSpent 1–480, status?, notes? }` |
| GET | `/:id` | admin, AM, client, VA | |
| PATCH | `/:id` | VA | Same fields except `assignmentId` |
| DELETE | `/:id` | VA | Soft delete |

### EOD submissions — `/crm/eod-submissions`

| Method | Path | Roles | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/context` | admin, AM, client, VA | `{ dateKey, timezone }`: the company's current business day |
| GET | `/` | admin, AM, client, VA | Query: `assignmentId`, `candidateId`, `clientId`, `date`, `dateFrom`, `dateTo` (company-day `YYYY-MM-DD`), `page`, `limit` |
| POST | `/` | VA | `{ assignmentId, date?, shiftStart, shiftEnd, workEntries[]?, summaryOfWork?, pendingTasks, blockers?, notes?, communicatedWithClient (yes\|no\|other, required), clientNote? }`. Needs `workEntries` or `summaryOfWork`. One per assignment per day (409). Hours are computed by the server |
| GET | `/:id` | admin, AM, client, VA | |
| PATCH | `/:id` | VA | Same fields, all optional, without `assignmentId` and `date` |
| DELETE | `/:id` | VA | Permanent |

### EOD reminders — `/crm/eod-reminders`

`GET /` (query `assignmentId`, `candidateId`, `status`, `page`, `limit`) and `GET /:id` — admin, AM. Written only by the 17:00 job.

### Survey reminders — `/crm/survey-reminders`

Admin, AM. `GET /` (query `relatedType`, `relatedId`, `status`, `assignedTo`, `page`, `limit`), `POST /` (`{ relatedType, relatedId, surveyType, dueDate, assignedTo }`), `GET /:id`, `PATCH /:id` (`status`, `completedDate`, `dueDate`, `assignedTo`). Not scoped by account manager.

### Performance reviews — `/crm/performance-reviews`

| Method | Path | Roles | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | admin, AM, VA | Query: `candidateId` (alias `vaId`), `clientId`, `reviewType`, `status`, `page`, `limit` |
| POST | `/` | admin, AM | AI generation. `{ candidateId, clientId, jobId?, jobDescription?, reviewType, reviewPeriodStart, reviewPeriodEnd, roleType, clientExpectations?, managerNotes? }` |
| GET | `/:id` | admin, AM, VA | Adds `candidateName`, `clientName`, `jobTitle` |
| PATCH | `/:id` | admin, AM | `status` (not `completed`), `aiGenerated`, `categories`, `overallRating`, `clientSatisfactionScore`, `managerRatingInputs`, `finalRecommendation`, `finalManagerSummary`, `reviewedByUserId`. Not when completed |
| PATCH | `/:id/complete` | admin, AM | Locks the review |
| DELETE | `/:id` | admin, AM | |
| GET | `/:id/export-pdf` | admin, AM, VA | PDF download |
| POST | `/:id/regenerate` | admin, AM | `{ section: categories\|goals\|summary }` |

### Scorecards — `/crm/scorecards`

Admin, AM. `GET /` (query `vaId`, `page`, `limit`), `GET /:id`, `POST /generate` (`{ vaId? }` — builds or refreshes the current week for active assignments).

### Client accounts — `/crm/client-accounts`

| Method | Path | Roles | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/provisioned` | admin, AM | Clients with an active CRM user |
| GET | `/:id/hired-vas` | admin, AM, client | A client may only ask for their own id |
| GET | `/` | admin, AM | Clients with a CRM profile; `page`, `limit` |
| GET | `/:id` | admin, AM | |
| PATCH | `/:id` | admin, AM | `healthStatus`, `baaSigned`, `baaSignedDate`, `emrSystem`, `onboardingComplete`, `sopReceived`, `satisfactionScore`, `openIssuesCount`, `lastClientCheckin`, `notes`, `accountOwnerId`, `serviceStartDate`, `primaryContact`, `secondaryContact` |

### VA profiles — `/crm/va-profiles`

| Method | Path | Roles | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/` | admin, AM | `page`, `limit` |
| GET | `/:id` | admin, AM, VA | `:id` is the candidate id; a VA may only read their own. Created on first read |
| PATCH | `/:id` | admin, AM | `workloadLevel` (`low\|normal\|high\|overloaded`), `satisfactionScore`, `burnoutRiskFlag`, `replacementRiskFlag`, `lastVaCheckin`, `notes` (upsert) |
| GET | `/:vaId/notes` | admin | Oldest first |
| POST | `/:vaId/notes` | admin | `{ method, content ≤5000 }` |

### CRM dashboard — `/crm/dashboard`

`GET /` — admin, AM (AM: own assignments only). Assignment counts, today's EODs and work entries, missing EODs, compliance %, recent EODs, weekly hours, per-VA and per-client breakdowns.

### Reports

Mounted at both `/crm/reports` and `/reports`. All return a file: `format=csv` (default) or `xlsx`, with optional `startDate`, `endDate` (`YYYY-MM-DD`), `candidateId`, `clientId`.

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| GET | `/work-entries/export` | app `crm`, admin / AM | Deleted entries excluded |
| GET | `/eod-submissions/export` | app `crm`, admin / AM | One row per EOD |
| GET | `/performance/export` | app `crm`, admin / AM | Completed reviews only |
| GET | `/ats/dispositions/export` | app `ats`, admin / AM | Rejections with reason and destination; also takes `jobId`. In practice admin only, since AMs have no ATS access |

CSV cells that start with `=`, `+`, `-` or `@` are prefixed with `'`.

---

## Webhooks — `/api/webhooks`

| Method | Path | Guard | Notes |
| ------ | ---- | ----- | ----- |
| POST | `/resend` | **Public**, signed | Resend events (Svix signature checked when `RESEND_WEBHOOK_SECRET` is set; timestamp older than 5 min rejected). Handles `email.sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `opened`, `clicked` and `email.received` (inbound; already-stored ids are skipped) |
| POST | `/resend/test` | **Public**, non-production only | `{ type, emailId? }`; 403 in production |

## Real-time

Socket.IO on the same host: namespace `/ats` and `/crm`, `auth: { token }`. Rooms and events are listed in `ats/BUSINESS_LOGIC.md` §8.
