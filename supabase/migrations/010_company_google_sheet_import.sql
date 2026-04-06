ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS google_sheet_url text,
  ADD COLUMN IF NOT EXISTS google_sheet_last_imported_at timestamptz;

NOTIFY pgrst, 'reload schema';
