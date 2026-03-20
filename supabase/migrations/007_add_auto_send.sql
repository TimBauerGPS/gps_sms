-- Add auto_send_enabled flag to companies.
-- When true, date_offset plans are sent automatically each morning.
-- When false (default), all plans go to the send_queue for manual review.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS auto_send_enabled boolean NOT NULL DEFAULT false;
