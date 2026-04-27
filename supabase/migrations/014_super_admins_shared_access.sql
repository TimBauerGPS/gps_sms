-- Shared across Allied apps. Existing rows make a user a platform-level
-- super admin for apps that opt into this table.

CREATE TABLE IF NOT EXISTS public.super_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'super_admins'
      AND policyname = 'super_admins: users read own row'
  ) THEN
    CREATE POLICY "super_admins: users read own row"
      ON public.super_admins FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;
