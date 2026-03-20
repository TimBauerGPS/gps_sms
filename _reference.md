# _reference.md — Business logic & migration guide

This file explains the *intent* behind the original Google Sheets + Apps Script system so that Claude Code understands what to replicate in the new Next.js / Supabase / Twilio web app. The actual legacy code and spreadsheet are in the `_reference/` folder — read those for implementation detail. This doc explains the *why*.

---

## What the original system does

A restoration company (Allied Restoration Services, West Covina CA) manages jobs in Albi — a field service / project management platform. Albi exports job data as CSV. The team downloads that CSV and pastes it into a Google Sheet called the "Job Manager."

The Google Sheet has several tabs. A companion Apps Script runs on a time-based trigger (daily) and sends SMS messages to customers via the Twilio API based on rules the team configured. The goal of this web app is to replace the Google Sheet entirely with a proper multi-user UI, while keeping all the same business logic intact.

---

## Tab-by-tab migration guide

### Tab: Plan
**What it does in Sheets**: A table of rules. Each row defines one automated message. Columns are:
- "When to send" — a plain-English description like "1 day after Inspection Date"
- "What to send" — the exact SMS body, sometimes with placeholders
- "Date Modified/Added" — for auditing

**How it maps to the web app**: This becomes the `/plan` page. Each row is a `message_plans` record. The "When to send" field is split into two structured fields: `trigger_type` (date_offset or status_change), and either `trigger_date_field` + `trigger_offset_days` or `trigger_status_value`.

The UI should make it easy to build these rules without typing raw field names — use dropdowns for date fields and status values.

---

### Tab: Pulse Checks
**What it does in Sheets**: A one-off blast tool. The user picks a message to send, and the script finds all jobs currently in certain statuses (e.g. all jobs in "Mitigation" or "Reconstruction") and sends that message to all of them. There's a checkbox column so the user can opt specific customers out before sending.

Key behavior:
- This is NOT automated — it's manually triggered by the user clicking a button or running the script
- The message goes to every job in the selected statuses UNLESS unchecked
- It's used for things like "checking in on all active jobs" — hence "pulse check"
- There's no deduplication needed here (unlike Plan messages) — the user is intentionally sending to everyone right now

**How it maps to the web app**: The `/pulse-checks` page. User selects target statuses → sees a checklist of matching jobs → edits message → hits Send. Log it to `pulse_check_runs` and `sent_messages`.

---

### Tab: Inbox
**What it does in Sheets**: Originally just a log of inbound Twilio replies — a read-only table showing who replied and what they said. There was no two-way reply capability in the Sheet version.

**How it maps to the web app**: Upgrade this to full two-way conversation threads on the `/inbox` page. Each unique customer phone number gets a conversation thread. Inbound messages arrive via the Twilio webhook at `/api/twilio-inbound`. The UI should feel like a basic SMS inbox — left panel lists conversations, right panel shows the thread, reply box at bottom.

Use Supabase Realtime to push new inbound messages to the UI without polling.

---

### Tab: Send SMS
**What it does in Sheets**: A simple form — pick a job from a dropdown, type a message, click send. One-time manual SMS, not automated.

**How it maps to the web app**: The `/send-sms` page. Search or select a job, compose message with optional placeholder insertion, send. Simple.

---

### Tab: Send Messages (log)
**What it does in Sheets**: A running log of every outbound message sent — job name, phone number, message body, timestamp. Read-only.

**How it maps to the web app**: The `/messages` page. Full log of all `sent_messages` records (both inbound and outbound). Add filters for date range, job, direction.

---

### Tab: Do Not Text
**What it does in Sheets**: A simple list of phone numbers that should never receive automated messages. The Apps Script checks this list before every send.

**How it maps to the web app**: The `/do-not-text` page. Stored in the `do_not_text` table. The scheduler function and any manual send must check this table before calling Twilio. If a number is on the list, skip silently and log a note.

---

## How the Apps Script scheduler works (legacy)

The original script runs on a daily time trigger. Here is the core logic in plain English — use the actual script file in `_reference/` for exact implementation:

1. Read all rows from the Job Manager sheet (the Albi CSV data pasted in)
2. Read all rows from the Plan tab
3. For each Plan row:
   a. Parse the "When to send" text to extract the offset days and which date column to use
   b. For each job row, look up that date column
   c. If today == that date + offset days, check if a message was already sent (tracked in a sent log column or separate sheet)
   d. If not sent and phone not on Do Not Text list, send via Twilio and mark as sent
4. Status-based rules work similarly — if the job's current status matches the rule, and it hasn't been sent yet, send it

**Important**: The deduplication in the original script is likely done via a column flag or a separate log sheet. In the web app, deduplication is handled by checking `sent_messages` for an existing row with the same `(job_id, plan_id)` combo.

---

## Twilio integration notes

- The original script has the Twilio Account SID, Auth Token, and From number hardcoded (or stored in a Script Property). You'll find a placeholder in the reference code where the real credentials were.
- In the web app, each company stores its own Twilio credentials in the `companies` table. These are fetched server-side only — never sent to the browser.
- The Twilio phone number format must be E.164 (`+1XXXXXXXXXX`). Normalize customer phone numbers from the CSV on import.
- The Twilio inbound webhook URL needs to be registered in the Twilio console under the company's phone number → "A message comes in" → Webhook → POST → `https://your-netlify-site.netlify.app/api/twilio-inbound`

---

## Placeholder system

The original script likely does basic string replacement for customer name and possibly job details in message templates. In the web app, use `{{Column Name}}` syntax (matching CSV header names, case-insensitive). At send time, resolve all placeholders from `jobs.raw_csv_row` — the full original CSV row stored as JSON.

Supported placeholders are dynamic — any column header from the Albi CSV is valid. Common ones:
- `{{Customer Name}}`
- `{{Insurance Carrier}}`
- `{{Status}}`
- `{{Inspection Date}}`

The UI should help users discover available placeholders (e.g. a dropdown or tag-insert button that lists all columns from the most recently uploaded CSV).

---

## Data flow summary

```
Albi (job management)
  → CSV export (manual, periodic)
    → Upload page in web app
      → papaparse → normalize headers → upsert into jobs table

Daily cron (Netlify scheduled function)
  → reads message_plans + jobs
    → evaluates date offset and status rules
      → checks sent_messages (dedup) + do_not_text
        → calls Twilio API (server-side, using company credentials from DB)
          → logs to sent_messages

Customer replies via SMS
  → Twilio webhook → /api/twilio-inbound (Netlify Function)
    → logs to sent_messages (direction: inbound)
    → upserts conversations, increments unread_count
      → Supabase Realtime pushes update to /inbox UI
```

---

## Things to watch out for

- **Phone number formatting**: Albi CSV may export phone numbers in various formats (e.g. `(626) 555-1234` or `626-555-1234`). Normalize to E.164 on import using a library like `libphonenumber-js`.
- **Date parsing**: Albi date fields may be formatted inconsistently. Use `date-fns` or `dayjs` for robust parsing. Always store as UTC in Supabase.
- **Status values**: Status strings in Albi are free-text and may vary slightly. The Plan UI should let users type or select status values — don't hardcode them.
- **Duplicate jobs on re-upload**: Upsert on `(company_id, albi_job_id)` so re-uploading an updated CSV refreshes existing jobs rather than creating duplicates.
- **Do Not Text check**: Must happen for ALL send paths — scheduled sends, pulse checks, manual send SMS. Never send if number is on the list.
- **One-time status sends**: For status-based plan triggers, a message must only go out once per job even if the CSV is re-uploaded with the same status. Dedup via `sent_messages (job_id, plan_id)`.
