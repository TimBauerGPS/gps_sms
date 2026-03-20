# CLAUDE.md — Allied SMS Scheduler

## Project overview
A web app that allows restoration company teams to schedule and send SMS messages to customers via Twilio, triggered either by date offsets relative to job milestone dates or by job status changes. Job data comes from Albi CSV exports. Multi-tenant: each company has its own plan, users, and Twilio credentials.

---

## Tech stack
- **Frontend**: Next.js 14 (App Router), hosted on Netlify
- **Backend**: Supabase (PostgreSQL, Auth, Realtime)
- **SMS**: Twilio Programmable Messaging
- **CSV parsing**: papaparse
- **Scheduling**: Supabase `pg_cron` or a Netlify scheduled function (daily cron)
- **Inbound webhooks**: Netlify Function at `/api/twilio-inbound`

Cost posture: stay on Supabase free tier and Netlify free tier as long as possible. Avoid Edge Functions for anything that runs frequently — use Netlify Functions instead.

---

## Reference files (in this repo root)
- `_reference.md` — additional product context and business logic notes
- `_sample.xlsx` — sample Albi export showing real column headers and data shape

Note: `_reference/` (legacy Apps Script files) is gitignored — contains company data.

Always read both files before making architectural decisions.

---

## Supabase schema

### companies
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| twilio_account_sid | text | encrypted at rest |
| twilio_auth_token | text | encrypted at rest |
| twilio_phone_number | text | E.164 format |
| albi_email | text | single email address connected to Albi; receives a copy of every outbound SMS so Albi can attach it to the job notes automatically |
| staff_notification_emails | text[] | email addresses notified when a new inbound SMS arrives (supplement to web push) |
| review_links | jsonb | array of `{match_string: text, url: text}` — ordered; first match wins when resolving `{{REVIEW_LINK}}`. Match is case-insensitive substring of job name. Example: `[{"match_string": "SNA", "url": "https://g.page/r/..."}, {"match_string": "", "url": "http://allied.pub/review"}]` — empty string = default fallback. |
| created_at | timestamptz | |

### users
| column | type | notes |
|---|---|---|
| id | uuid PK | references auth.users |
| company_id | uuid FK → companies | |
| email | text | |
| role | text | 'admin' or 'member' |

### message_plans
The core scheduling rules. Shared across all users in a company.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| trigger_type | text | 'date_offset' or 'status_change' |
| trigger_date_field | text | nullable — one of the canonical date fields below |
| trigger_offset_days | integer | nullable — positive integer, days after the date field |
| trigger_status_value | text | nullable — e.g. 'Paid', 'File Closed' |
| trigger_job_type_strings | text[] | nullable — optional job name substring filter (e.g. ['WTR', 'MLD']). If set, job name must contain at least one string (case-insensitive) for the plan to fire. If null/empty, applies to all job types. |
| message_template | text | may contain `{{placeholders}}` including the built-in `{{REVIEW_LINK}}` |
| is_active | boolean | default true |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### jobs
Imported from Albi CSV uploads. One row per job per company.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK | |
| albi_job_id | text | from CSV, unique per company |
| customer_name | text | |
| customer_phone | text | E.164 format |
| status | text | |
| created_at_albi | date | "Created At" column |
| inspection_date | date | "Inspection Date" |
| estimated_work_start_date | date | "Estimated Work Start Date" |
| file_closed | date | "File Closed" |
| estimate_sent | date | "Estimate sent" |
| contract_signed | date | "Contract Signed" |
| coc_cos_signed | date | "COC/COS Signed" |
| invoiced | date | "Invoiced" |
| work_start | date | "Work Start" |
| paid | date | "Paid" |
| estimated_completion_date | date | "Estimated Completion Date" |
| raw_csv_row | jsonb | full original row, for placeholder resolution |
| imported_at | timestamptz | |
| updated_at | timestamptz | |

### sent_messages
Deduplication and audit log.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK | |
| job_id | uuid FK → jobs | |
| plan_id | uuid FK → message_plans | nullable |
| direction | text | 'outbound' or 'inbound' |
| body | text | |
| to_phone | text | |
| from_phone | text | |
| twilio_sid | text | |
| sent_at | timestamptz | |

### conversations
For two-way threading. One row per unique (company, job/phone) pair.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK | |
| job_id | uuid FK → jobs | nullable — may not match a job |
| customer_phone | text | |
| last_message_at | timestamptz | |
| unread_count | integer | default 0 |

### do_not_text
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK | |
| phone_number | text | E.164 |
| added_at | timestamptz | |
| added_by | uuid FK → users | nullable — null if auto-added via STOP/UNSUBSCRIBE |
| reason | text | nullable — e.g. 'STOP reply', 'manual' |

### pulse_check_runs
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK | |
| message_template | text | |
| target_statuses | text[] | array of status strings |
| target_job_type_strings | text[] | job name substring filters used for this run (e.g. ['RBL', 'STR']). Empty = all job types. |
| sent_at | timestamptz | |
| job_ids_sent | uuid[] | deduplication |

### send_queue
Pre-send review queue for status-change plan triggers. The daily cron writes here instead of sending immediately for `status_change` plans. Users review and approve/remove before batch send.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK | |
| job_id | uuid FK → jobs | |
| plan_id | uuid FK → message_plans | |
| resolved_message | text | message with placeholders already resolved |
| queued_at | timestamptz | |
| status | text | 'pending', 'sent', 'skipped' |
| skipped_reason | text | nullable — e.g. 'user removed', 'do_not_text' |
| processed_at | timestamptz | nullable |

---

## Canonical Albi date field names
These are the exact CSV column headers from Albi exports. CSV parsing must be case-insensitive for header matching — normalize all headers to lowercase + trim before mapping.

| CSV header (original) | DB column |
|---|---|
| Created At | created_at_albi |
| Inspection Date | inspection_date |
| Estimated Work Start Date | estimated_work_start_date |
| File Closed | file_closed |
| Estimate sent | estimate_sent |
| Contract Signed | contract_signed |
| COC/COS Signed | coc_cos_signed |
| Invoiced | invoiced |
| Work Start | work_start |
| Paid | paid |
| Estimated Completion Date | estimated_completion_date |

---

## Message template placeholders
Templates may contain `{{column_name}}` placeholders where `column_name` matches any column header from the uploaded CSV (case-insensitive). At send time, resolve placeholders from `jobs.raw_csv_row` (the full JSON of the original CSV row).

**Built-in special placeholder:**
- `{{REVIEW_LINK}}` — resolved using `companies.review_links`. Iterate the ordered array; the first entry whose `match_string` is a case-insensitive substring of the job name is used. An empty `match_string` acts as a catch-all default. If no match, resolves to an empty string.

Example: `Hi {{Customer Name}}, your inspection is confirmed for {{Inspection Date}}.`
Example: `Great working with you! Leave us a review: {{REVIEW_LINK}}`

---

## Review link configuration
Each company configures their review links in `/settings` under "Review Links". This is an ordered list of `{match_string, url}` pairs. The match_string is a substring of the job name (e.g. office codes like "SNA", "WTR"). The first match wins. An empty match_string = default fallback for all jobs.

UI: a drag-reorder list, with add/remove rows and a "Test" input that previews which URL a given job name would resolve to.

---

## Job type strings
Job names in Albi encode metadata via substrings (e.g. "WTR" = water mitigation, "MLD" = mold, "RBL" = rebuild, "STR" = structure). These are company-defined and configured in `/settings` under "Job Types". Each entry has a label and substring.

Job type filtering is used in two places:
1. **Message plans** (`trigger_job_type_strings`): a plan only fires for jobs whose name contains one of the specified substrings.
2. **Pulse checks** (`target_job_type_strings`): ad-hoc blast only targets jobs whose name matches.

In both cases the filter is optional — if empty/null, applies to all job types.

---

## Multi-tenancy rules
- All tables have `company_id`. Apply Supabase Row Level Security (RLS) on every table.
- Users can only see data for their own `company_id`.
- Company Twilio credentials are stored in `companies` table. Never expose them to the frontend — all Twilio calls must go through Netlify Functions server-side.

---

## App pages / routes

### `/settings`
- Company profile (name)
- Twilio credentials input (account SID, auth token, phone number) — save to `companies` table
- **Albi email**: single email address field. Display note: _"This email receives a copy of every outbound text message. Connect it to Albi to automatically attach messages to job notes."_
- **Staff notifications**: list of staff email addresses to notify when a new inbound SMS arrives. Display note: _"These team members will be emailed when a customer replies. They will also receive browser push notifications if they've enabled them."_
- **Review links**: ordered list of `{match_string, url}` pairs with drag-to-reorder, add/remove. Includes a test input.
- **Job types**: list of `{label, substring}` pairs for the company's job name codes. Used to power dropdowns in Plans and Pulse Checks.
- User management (invite by email)

### `/plan`
Manage message_plans. Two trigger types:
1. **Date offset**: select a date field + number of days after → optionally filter by job type string(s) → write message template
2. **Status change**: select a status value → optionally filter by job type string(s) → write message template (queued, not sent immediately — see Send Queue)

UI columns: trigger description (including job type filter if set), message preview, active toggle, date added/modified, delete.

Note: Status-change plans feed the Send Queue rather than sending directly. Users must approve queued sends via `/send-queue`.

### `/send-queue`
Pre-send review for status-change plan triggers.
- Table of pending sends: job name, customer phone, plan trigger, resolved message preview, queued date
- Checkboxes to select/deselect individual rows
- "Remove selected" button — marks as 'skipped' with reason 'user removed'
- "Send selected" button — sends the selected batch via Twilio, marks as 'sent', logs to `sent_messages`
- Filterable by plan, status, job type
- Hardcoded rule: jobs with `created_at_albi` before 2026-01-01 are never queued — silently excluded at queue-population time.

### `/pulse-checks`
Ad-hoc blast to jobs matching configurable filters.
- User selects **target statuses** (multi-select from known statuses in current job data)
- User selects **target job types** (multi-select from company-configured job type strings; empty = all)
- System shows matching jobs with checkboxes — user selects which to include
- User writes/edits message template (with placeholder support, including `{{REVIEW_LINK}}`)
- Send button fires SMS to all selected, logs to `pulse_check_runs` and `sent_messages`

### `/inbox`
Two-way conversation threads.
- Left panel: list of conversations sorted by `last_message_at`, show unread badge
- Right panel: message thread (inbound + outbound) for selected conversation
- Reply box at bottom — sends via Twilio, logs to `sent_messages`, updates `conversations`, emails copy to `companies.albi_email` (subject: `[{job name}] SMS Message`) so the reply appears in Albi job notes alongside automated sends
- Realtime updates via Supabase Realtime subscription on `sent_messages`
- Push notification opt-in prompt visible in this view (if permission not yet granted)

### `/send-sms`
One-time manual SMS.
- Search/select a job or enter a phone number manually
- Write message (with placeholder support if job selected, including `{{REVIEW_LINK}}`)
- Send button — sends via Twilio, logs to `sent_messages`, emails copy to `companies.albi_email`

### `/messages`
Full sent messages log. Filterable by date range, job, status. Shows direction (inbound/outbound), body, timestamp.

### `/do-not-text`
- Table of blocked numbers with added-by and reason columns
- Add number manually or from job record
- Remove with confirmation
- Numbers added automatically when customer replies STOP or UNSUBSCRIBE (see inbound webhook)

### `/upload`
CSV upload for Albi job data.
- Parse with papaparse, normalize headers (lowercase + trim)
- Upsert into `jobs` on `(company_id, albi_job_id)`
- Show import summary (new, updated, skipped rows)

---

## Scheduling logic (daily cron job)
Run once per day (e.g. midnight PT). For each active `message_plan`:

**Date offset plans:**
1. For each job in the company, check if `trigger_date_field` is set and non-null
2. If `trigger_job_type_strings` is set, skip jobs whose name doesn't match any string (case-insensitive substring)
3. Compute `trigger_date + trigger_offset_days`
4. If that date == today AND no row exists in `sent_messages` for this `(job_id, plan_id)`, resolve placeholders (including `{{REVIEW_LINK}}`), send SMS
5. Check `do_not_text` before sending
6. Email a copy to `companies.albi_email`

**Status change plans (queued, not sent directly):**
1. For each job where `status == trigger_status_value`
2. Skip jobs with `created_at_albi` before 2026-01-01
3. If `trigger_job_type_strings` is set, skip jobs that don't match
4. If no row exists in `sent_messages` for this `(job_id, plan_id)` AND no pending row in `send_queue` for this `(job_id, plan_id)`, insert a row into `send_queue` with `status: 'pending'`
5. Do NOT send yet — user reviews and approves via `/send-queue`
6. When user approves a send_queue row: check `do_not_text`, send via Twilio, log to `sent_messages`, email copy to `companies.albi_email`, mark `send_queue` row as 'sent'

Implement cron as a Netlify scheduled function (`netlify/functions/scheduler.js`) with `schedule: "0 7 * * *"` (7am UTC = midnight PT).

---

## Twilio inbound webhook
Netlify Function at `netlify/functions/twilio-inbound.js`

1. Validate Twilio signature (use `twilio.validateRequest`)
2. Parse `From`, `To`, `Body` from POST body
3. Look up company by `twilio_phone_number == To`
4. **STOP/UNSUBSCRIBE handling**: if `Body.trim().toUpperCase()` is `'STOP'` or `'UNSUBSCRIBE'`, upsert the `From` number into `do_not_text` with `reason: 'STOP reply'`, `added_by: null`. Return TwiML `<Response/>` and stop processing.
5. Find matching job by `customer_phone == From` (normalize to E.164)
6. Upsert `conversations` row, increment `unread_count`
7. Insert into `sent_messages` with `direction: 'inbound'`
8. **Notify staff**: send email to each address in `companies.staff_notification_emails` with subject `[{job name or phone}] New SMS reply` and message body. Also send to `companies.albi_email`. (Web push is handled client-side via Supabase Realtime subscription — see below.)
9. Return TwiML `<Response/>` (empty — no auto-reply)

Register this URL in Twilio console as the inbound webhook for each company's phone number.

---

## Email notifications

### Outbound sends (all automated + manual sends)
Every outbound SMS (scheduled date-offset, send-queue approval, pulse check, manual send-sms) sends one email:
- **To**: `companies.albi_email`
- **Subject**: `[{job name}] SMS Message`
- **Body**: the SMS body text

This is how outbound texts appear in Albi job notes — Albi monitors a connected email inbox and attaches emails to job records by job name match. There is no direct Albi API for this.

If `albi_email` is empty, skip silently.

### Inbound SMS notifications
When a new inbound SMS arrives (via Twilio webhook):
- **Email**: send to all addresses in `companies.staff_notification_emails` AND to `companies.albi_email`
  - Subject: `[{job name or From phone}] New SMS reply`
  - Body: include sender phone, matched job name if found, and message text
- **Web push**: handled client-side — any logged-in user who has granted push permission receives a browser notification via the Supabase Realtime `sent_messages` subscription. Works even when the app tab is closed, as long as the browser is running. Users opt in per-device via a prompt in the `/inbox` UI.

Web push caveats to communicate to users in the UI:
- Requires granting notification permission in the browser
- Works on desktop and Android; on iOS requires adding the app to the home screen (PWA)
- Does not work if the browser is fully closed

---

## Environment variables
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # server-side only, never expose to client
```
Twilio credentials are per-company and stored in the DB — do NOT put them in env vars.

---

## Cost notes
- Supabase free tier: 500MB DB, 50MB storage, 2GB bandwidth — sufficient for this use case
- Netlify free tier: 125k function invocations/month, 100GB bandwidth
- Avoid Supabase Realtime for high-frequency polling — use it only for inbox live updates
- `pg_cron` is available on Supabase free tier as an alternative to Netlify scheduled functions
- Twilio costs are per-message (~$0.0079/SMS in US) — not controllable by this app

---

## Key conventions
- Use Next.js App Router (not Pages Router)
- Server Components for data fetching where possible; Client Components only where interactivity requires it
- All Twilio API calls must be server-side (Netlify Functions or Route Handlers) — never client-side
- Phone numbers stored and compared in E.164 format (`+1XXXXXXXXXX`)
- All DB timestamps in UTC
- RLS must be enabled on all tables before going to production

---

## Things to watch out for
- **Phone number formatting**: Albi CSV may export phone numbers in various formats (e.g. `(626) 555-1234` or `626-555-1234`). Normalize to E.164 on import using a library like `libphonenumber-js`.
- **Date parsing**: Albi date fields may be formatted inconsistently. Use `date-fns` or `dayjs` for robust parsing. Always store as UTC in Supabase.
- **Status values**: Status strings in Albi are free-text and may vary slightly. The Plan UI should let users type or select status values — don't hardcode them.
- **Duplicate jobs on re-upload**: Upsert on `(company_id, albi_job_id)` so re-uploading an updated CSV refreshes existing jobs rather than creating duplicates.
- **Do Not Text check**: Must happen for ALL send paths — scheduled sends, queue approvals, pulse checks, manual send SMS. Never send if number is on the list.
- **One-time status sends**: For status-based plan triggers, a message must only go out once per job even if the CSV is re-uploaded with the same status. Dedup via `sent_messages (job_id, plan_id)` AND `send_queue (job_id, plan_id)`.
- **Created At cutoff**: Status-change plans (and the send queue) never queue jobs with `created_at_albi` before 2026-01-01.
- **Job type string matching**: Always case-insensitive substring match against the job name field.
- **Review link resolution**: Always use the ordered `companies.review_links` array with first-match-wins logic. Empty `match_string` = catch-all default. Never hardcode review URLs in code.
- **Estimate sent column**: The correct Albi CSV header is `'Estimate sent'` (singular, lowercase 's') — maps to DB column `estimate_sent`.
