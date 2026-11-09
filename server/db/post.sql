-- Runs after every migration pass (safe to repeat). Supabase hands these table grants out by default;
-- on plain Postgres they must be explicit. RLS (rls.sql) still decides which rows each role may see,
-- and rls.sql has already removed insert/update/delete from anon and authenticated.
-- Lists are explicit on purpose: a new table is NOT readable until it is added here.

grant select on public.app_settings, public.categories, public.rooms, public.beds, public.amenities, public.reviews
  to anon;

grant select on
  public.profiles, public.employee_permissions, public.app_settings, public.categories, public.rooms,
  public.beds, public.amenities, public.bookings, public.booking_beds, public.bills, public.payments,
  public.customer_documents, public.reviews, public.activity_log
  to authenticated;

-- service_role = trusted server code (payments, webhooks)
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
