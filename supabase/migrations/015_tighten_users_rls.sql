-- Members can read users in their company, but role/company assignment is
-- managed through service-role admin routes only.

DROP POLICY IF EXISTS "users: company members only" ON public.users;
DROP POLICY IF EXISTS "users: company members read company users" ON public.users;

CREATE POLICY "users: company members read company users"
  ON public.users FOR SELECT
  USING (company_id = get_user_company_id());
