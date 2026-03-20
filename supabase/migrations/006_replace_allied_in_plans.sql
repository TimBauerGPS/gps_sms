-- Replace hardcoded "Allied Restoration" and "Allied" in existing message_plan templates
-- with the {{Guardian Office Name}} placeholder so they work for any company.

UPDATE public.message_plans
SET message_template = replace(message_template, 'Allied Restoration', '{{Guardian Office Name}}')
WHERE message_template LIKE '%Allied Restoration%';

UPDATE public.message_plans
SET message_template = replace(message_template, 'This is Allied!', 'This is {{Guardian Office Name}}!')
WHERE message_template LIKE '%This is Allied!%';

UPDATE public.message_plans
SET message_template = replace(message_template, 'This is Allied.', 'This is {{Guardian Office Name}}.')
WHERE message_template LIKE '%This is Allied.%';

-- Catch any remaining standalone "Allied" references (e.g. "allowing Allied to")
UPDATE public.message_plans
SET message_template = replace(message_template, ' Allied ', ' {{Guardian Office Name}} ')
WHERE message_template LIKE '% Allied %'
  AND message_template NOT LIKE '%{{Guardian Office Name}}%';
