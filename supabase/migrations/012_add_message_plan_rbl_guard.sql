ALTER TABLE public.message_plans
ADD COLUMN IF NOT EXISTS require_no_attached_rbl_file boolean NOT NULL DEFAULT false;
