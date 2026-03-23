-- Add albi_project_url column to jobs table
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS albi_project_url text;
