-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. CREATE ALL TABLES (no functions yet)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.companies (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                      text NOT NULL,
  twilio_account_sid        text,
  twilio_auth_token         text,
  twilio_phone_number       text,
  albi_email                text,
  staff_notification_emails text[]      NOT NULL DEFAULT '{}',
  review_links              jsonb       NOT NULL DEFAULT '[]',
  job_types                 jsonb       NOT NULL DEFAULT '[]',
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.users (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member'))
);

CREATE TABLE IF NOT EXISTS public.message_plans (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id               uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  trigger_type             text NOT NULL CHECK (trigger_type IN ('date_offset', 'status_change')),
  trigger_date_field       text,
  trigger_offset_days      integer,
  trigger_status_value     text,
  trigger_job_type_strings text[],
  message_template         text NOT NULL,
  is_active                boolean     NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jobs (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id                uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  albi_job_id               text NOT NULL,
  customer_name             text,
  customer_phone            text,
  status                    text,
  created_at_albi           date,
  inspection_date           date,
  estimated_work_start_date date,
  file_closed               date,
  estimate_sent             date,
  contract_signed           date,
  coc_cos_signed            date,
  invoiced                  date,
  work_start                date,
  paid                      date,
  estimated_completion_date date,
  raw_csv_row               jsonb       NOT NULL DEFAULT '{}',
  imported_at               timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sent_messages (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id      uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  plan_id     uuid REFERENCES public.message_plans(id) ON DELETE SET NULL,
  direction   text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body        text NOT NULL,
  to_phone    text NOT NULL,
  from_phone  text NOT NULL,
  twilio_sid  text,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id          uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  customer_phone  text NOT NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  unread_count    integer     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.do_not_text (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  added_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reason       text,
  UNIQUE (company_id, phone_number)
);

CREATE TABLE IF NOT EXISTS public.pulse_check_runs (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id              uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  message_template        text   NOT NULL,
  target_statuses         text[] NOT NULL DEFAULT '{}',
  target_job_type_strings text[] NOT NULL DEFAULT '{}',
  sent_at                 timestamptz NOT NULL DEFAULT now(),
  job_ids_sent            text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS public.send_queue (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id           uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  plan_id          uuid NOT NULL REFERENCES public.message_plans(id) ON DELETE CASCADE,
  resolved_message text NOT NULL,
  queued_at        timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  skipped_reason   text,
  processed_at     timestamptz
);

-- ============================================================
-- 2. INDEXES
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS jobs_company_albi_job_idx       ON public.jobs(company_id, albi_job_id);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_company_phone_idx ON public.conversations(company_id, customer_phone);

CREATE INDEX IF NOT EXISTS message_plans_company_id_idx    ON public.message_plans(company_id);
CREATE INDEX IF NOT EXISTS sent_messages_job_plan_idx      ON public.sent_messages(job_id, plan_id);
CREATE INDEX IF NOT EXISTS sent_messages_company_id_idx    ON public.sent_messages(company_id);
CREATE INDEX IF NOT EXISTS send_queue_job_plan_idx         ON public.send_queue(job_id, plan_id);
CREATE INDEX IF NOT EXISTS send_queue_company_status_idx   ON public.send_queue(company_id, status);
CREATE INDEX IF NOT EXISTS pulse_check_runs_company_id_idx ON public.pulse_check_runs(company_id);

-- ============================================================
-- 3. HELPER FUNCTION (must come after public.users exists)
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_company_id()
RETURNS uuid AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- 4. ENABLE RLS + POLICIES
-- ============================================================

ALTER TABLE public.companies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_plans   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sent_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.do_not_text     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_check_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.send_queue      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "companies: company members only"
  ON public.companies FOR ALL
  USING (id = get_user_company_id());

CREATE POLICY "users: company members only"
  ON public.users FOR ALL
  USING (company_id = get_user_company_id());

CREATE POLICY "message_plans: company members only"
  ON public.message_plans FOR ALL
  USING (company_id = get_user_company_id());

CREATE POLICY "jobs: company members only"
  ON public.jobs FOR ALL
  USING (company_id = get_user_company_id());

CREATE POLICY "sent_messages: company members only"
  ON public.sent_messages FOR ALL
  USING (company_id = get_user_company_id());

CREATE POLICY "conversations: company members only"
  ON public.conversations FOR ALL
  USING (company_id = get_user_company_id());

CREATE POLICY "do_not_text: company members only"
  ON public.do_not_text FOR ALL
  USING (company_id = get_user_company_id());

CREATE POLICY "pulse_check_runs: company members only"
  ON public.pulse_check_runs FOR ALL
  USING (company_id = get_user_company_id());

CREATE POLICY "send_queue: company members only"
  ON public.send_queue FOR ALL
  USING (company_id = get_user_company_id());
