-- Trigger: automatically seed default message plans when a new company is created.
CREATE OR REPLACE FUNCTION trigger_seed_default_plans()
RETURNS trigger AS $$
BEGIN
  PERFORM seed_default_plans(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_company_created
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION trigger_seed_default_plans();
