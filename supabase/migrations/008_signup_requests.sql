-- Signup requests table — stores access requests from new users pending admin approval.

CREATE TABLE public.signup_requests (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text        NOT NULL,
  email                  text        NOT NULL,
  requested_company_name text        NOT NULL,
  status                 text        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'approved', 'rejected')),
  company_id             uuid        REFERENCES public.companies(id) ON DELETE SET NULL,
  admin_notes            text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Service role only — no public access
ALTER TABLE public.signup_requests ENABLE ROW LEVEL SECURITY;
