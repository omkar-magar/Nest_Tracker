-- Row Level Security. Default is deny: every table has RLS on, and writes that touch money, bookings or
-- roles have NO insert/update/delete policy at all. They go through the security-definer functions in the functions migration.

-- ---------------------------------------------------------------- helpers
create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

-- Admin always passes. An employee passes only if the named switch is on. perm is checked against a fixed list.
create function public.has_permission(perm text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := public.current_app_role(); ok boolean;
begin
  if r = 'admin' then return true; end if;
  if r is distinct from 'employee' then return false; end if;
  if perm not in ('can_view_customers', 'can_view_contacts', 'can_view_payments', 'can_manage_beds') then
    return false;
  end if;
  execute format('select %I from public.employee_permissions where employee_id = $1', perm)
    into ok using auth.uid();
  return coalesce(ok, false);
end $$;

revoke all on function public.current_app_role(), public.is_admin(), public.has_permission(text) from public;
grant execute on function public.current_app_role(), public.is_admin(), public.has_permission(text) to anon, authenticated;

-- ---------------------------------------------------------------- enable RLS everywhere
alter table public.profiles             enable row level security;
alter table public.employee_permissions enable row level security;
alter table public.app_settings         enable row level security;
alter table public.categories           enable row level security;
alter table public.rooms                enable row level security;
alter table public.beds                 enable row level security;
alter table public.amenities            enable row level security;
alter table public.bookings             enable row level security;
alter table public.booking_beds         enable row level security;
alter table public.bills                enable row level security;
alter table public.payments             enable row level security;
alter table public.customer_documents   enable row level security;
alter table public.reviews              enable row level security;
alter table public.activity_log         enable row level security;

-- ---------------------------------------------------------------- grants (defence in depth on top of RLS)
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on public.activity_log, public.employee_permissions from anon;

-- profiles: a user may edit only their own name and phone, never role or is_active
grant update (full_name, phone) on public.profiles to authenticated;
-- customers add documents and reviews directly; everything else is RPC-only
grant insert, delete on public.customer_documents to authenticated;
grant insert on public.reviews to authenticated;
-- admin catalogue editing (rooms, beds, amenities, categories, review moderation) is gated by is_admin() policies
grant insert, update, delete on public.categories, public.rooms, public.beds, public.amenities to authenticated;
grant update, delete on public.reviews to authenticated;

-- ---------------------------------------------------------------- policies
-- profiles
create policy profiles_self_read   on public.profiles for select using (id = auth.uid());
create policy profiles_admin_read  on public.profiles for select using (public.is_admin());
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- employee_permissions: read-only here, changed by admin_set_employee_permissions()
create policy perms_self_read  on public.employee_permissions for select using (employee_id = auth.uid());
create policy perms_admin_read on public.employee_permissions for select using (public.is_admin());

-- app_settings: harmless flags, readable by everyone, writable by nobody from the client
create policy settings_read on public.app_settings for select using (true);

-- public catalogue (nothing sensitive in these tables)
create policy categories_read on public.categories for select using (true);
create policy rooms_read      on public.rooms      for select using (is_active or public.is_admin());
create policy beds_read       on public.beds       for select using (true);
create policy amenities_read  on public.amenities  for select using (true);

create policy categories_admin on public.categories for all using (public.is_admin()) with check (public.is_admin());
create policy rooms_admin      on public.rooms      for all using (public.is_admin()) with check (public.is_admin());
create policy beds_admin       on public.beds       for all using (public.is_admin()) with check (public.is_admin());
create policy amenities_admin  on public.amenities  for all using (public.is_admin()) with check (public.is_admin());

-- bookings / bills / payments: customers see only their own, admin sees all. Staff use staff_* functions.
create policy bookings_own   on public.bookings for select using (customer_id = auth.uid());
create policy bookings_admin on public.bookings for select using (public.is_admin());

create policy booking_beds_own on public.booking_beds for select using (
  exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()));
create policy booking_beds_admin on public.booking_beds for select using (public.is_admin());

create policy bills_own   on public.bills for select using (customer_id = auth.uid());
create policy bills_admin on public.bills for select using (public.is_admin());

create policy payments_own   on public.payments for select using (customer_id = auth.uid());
create policy payments_admin on public.payments for select using (public.is_admin());

-- documents: owner reads / adds / deletes their own; admin reads all. The path must start with the owner's id.
create policy docs_own_read   on public.customer_documents for select using (customer_id = auth.uid());
create policy docs_admin_read on public.customer_documents for select using (public.is_admin());
create policy docs_own_insert on public.customer_documents for insert
  with check (customer_id = auth.uid() and file_path like auth.uid()::text || '/%');
create policy docs_own_delete on public.customer_documents for delete using (customer_id = auth.uid());

-- reviews: public sees published; a customer with a booking can write one (always starts pending)
create policy reviews_public on public.reviews for select using (status = 'published');
create policy reviews_own    on public.reviews for select using (customer_id = auth.uid());
create policy reviews_insert on public.reviews for insert with check (
  customer_id = auth.uid()
  and status = 'pending'
  and exists (select 1 from public.bookings b where b.customer_id = auth.uid() and b.status in ('active', 'completed')));
create policy reviews_admin  on public.reviews for all using (public.is_admin()) with check (public.is_admin());

-- activity log: admin only
create policy activity_admin on public.activity_log for select using (public.is_admin());

-- ---------------------------------------------------------------- realtime
-- Only the public-safe tables are published. Payments, bookings and documents never go over the public channel.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.beds, public.rooms;
  end if;
end $$;
