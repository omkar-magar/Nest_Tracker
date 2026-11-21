-- PG management roles (PRD 1.2). Enum values must be committed before use, so they get their own migration.
--   admin    = Super Admin / Owner (all properties)
--   manager  = Property Manager (assigned properties only)
--   employee = Staff (own tasks, attendance, assigned complaints)
--   sales    = Sales / Marketing Executive (leads, follow-ups, campaigns, visits)
--   customer = Tenant
alter type public.app_role add value if not exists 'manager';
alter type public.app_role add value if not exists 'sales';
