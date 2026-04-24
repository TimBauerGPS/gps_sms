UPDATE public.message_plans
SET require_no_attached_rbl_file = true,
    updated_at = now()
WHERE trigger_type = 'date_offset'
  AND trigger_date_field = 'contract_signed'
  AND trigger_offset_days = 2
  AND coalesce(trigger_status_value, '') = ''
  AND coalesce(trigger_job_type_strings, ARRAY[]::text[]) = ARRAY['WTR', 'MLD']::text[]
  AND message_template = 'Thank you for trusting {{Guardian Office Name}} with your mitigation project. Will you need help with construction after we''re done?';
