-- Add any company columns that may be missing from earlier migration runs
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS twilio_account_sid        text,
  ADD COLUMN IF NOT EXISTS twilio_auth_token         text,
  ADD COLUMN IF NOT EXISTS twilio_phone_number       text,
  ADD COLUMN IF NOT EXISTS albi_email                text,
  ADD COLUMN IF NOT EXISTS staff_notification_emails text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS review_links              jsonb   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS job_types                 jsonb   NOT NULL DEFAULT '[]';

-- Force PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
