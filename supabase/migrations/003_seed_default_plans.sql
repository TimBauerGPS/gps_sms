-- Default message plans seeded from legacy Apps Script rules.
-- These are inserted into a special "seed" company row that is NOT used in production.
-- In production, when a new company is created, call the seed_default_plans() function
-- to copy these templates into their company.

-- Helper function: copy default plan templates into a new company.
-- Call this after inserting a new company row.
CREATE OR REPLACE FUNCTION seed_default_plans(target_company_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO public.message_plans
    (company_id, trigger_type, trigger_date_field, trigger_offset_days,
     trigger_status_value, trigger_job_type_strings, message_template, is_active)
  VALUES

    -- 1 day after Inspection Date → all jobs
    (target_company_id, 'date_offset', 'inspection_date', 1,
     NULL, NULL,
     'Thank you for allowing {{Guardian Office Name}} to inspect your property. You can text us here at any time with questions or type STOP to unsubscribe.',
     true),

    -- 3 days after Inspection Date → all jobs (review request)
    (target_company_id, 'date_offset', 'inspection_date', 3,
     NULL, NULL,
     'If our team has done a great job so far, would you please help us give them a shout out & leave a review at {{REVIEW_LINK}} ?',
     true),

    -- 5 days after Inspection Date → all jobs (insurance agent ask)
    (target_company_id, 'date_offset', 'inspection_date', 5,
     NULL, NULL,
     'Hello! This is {{Guardian Office Name}}. Do you have an insurance agent/broker who sold you your policy (NOT your adjuster) we can inform about your project? Please send us their info if yes! Even if you aren''t filing a claim, keeping your agent in the loop can help with future insurance.',
     true),

    -- 1 day after Contract Signed → all jobs
    (target_company_id, 'date_offset', 'contract_signed', 1,
     NULL, NULL,
     'Thank you for hiring {{Guardian Office Name}}. We''re excited to get started for you. How are we doing so far?',
     true),

    -- 2 days after Contract Signed → WTR or MLD jobs only (construction upsell)
    (target_company_id, 'date_offset', 'contract_signed', 2,
     NULL, ARRAY['WTR', 'MLD'],
     'Thank you for trusting {{Guardian Office Name}} with your mitigation project. Will you need help with construction after we''re done?',
     true),

    -- 14 days after Contract Signed → all jobs (review request)
    (target_company_id, 'date_offset', 'contract_signed', 14,
     NULL, NULL,
     'Our team depends on reviews if you have a moment we would appreciate it so much! {{REVIEW_LINK}}',
     true),

    -- 1 day after COC/COS Signed → all jobs (final review request)
    (target_company_id, 'date_offset', 'coc_cos_signed', 1,
     NULL, NULL,
     'Thank you for choosing {{Guardian Office Name}}. How''d we do? We''d love your feedback at {{REVIEW_LINK}}',
     true),

    -- Status = Lost → all jobs (goes to send queue for review)
    (target_company_id, 'status_change', NULL, NULL,
     'Lost', NULL,
     'This is {{Guardian Office Name}}! We''re sorry we didn''t get to work with you. Is there anything we could have done better to earn your business?',
     true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
