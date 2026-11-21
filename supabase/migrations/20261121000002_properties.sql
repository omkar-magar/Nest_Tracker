-- PRD 2: properties, floors, rooms, beds, bed status, reservations, rent history, plus the property-scoped
-- access helpers every later PG-management migration uses.

-- ---------------------------------------------------------------- properties
create table public.properties (
  id          text primary key check (id ~ '^[A-Z0-9]{1,8}$'),   -- short code used in bed ids, e.g. P1
  name        text not null,
  address     text not null default '',
  city        text not null default '',
  map_query   text not null default '',                          -- Google Maps search text or a maps URL
  lat         double precision,                                  -- for staff GPS check-in
  lng         double precision,
  geofence_m  int not null default 200 check (geofence_m between 20 and 5000),
  phone       text not null default '',
  gst_no      text,
  license_no  text,
  photos      text[] not null default '{}',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- the existing single PG becomes property P1, so every existing room keeps working
insert into public.properties (id, name, address, city, map_query, phone)
values ('P1', 'YOLO Nest Hinjewadi', 'Near Hirai Sitai Mandir, Parkhe Vasti, Hinjewadi Phase 1, Pune 411057', 'Pune',
        'Hirai Sitai Mandir Parkhe Vasti Hinjewadi Phase 1 Pune', '8483878098');

-- who works where (managers, staff, sales). The owner (admin) sees every property without a row here.
create table public.property_members (
  property_id text not null references public.properties (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  primary key (property_id, user_id)
);
create index property_members_user_idx on public.property_members (user_id);

-- ---------------------------------------------------------------- access helpers
create function public.my_property_ids() returns setof text
language sql stable security definer set search_path = public as $$
  select id from public.properties where public.is_admin()
  union
  select m.property_id from public.property_members m
  where m.user_id = auth.uid() and public.current_app_role() in ('manager', 'employee', 'sales')
$$;

-- any staff role assigned to the property (or the owner)
create function public.can_access_property(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.property_members m
    where m.property_id = p and m.user_id = auth.uid()
      and public.current_app_role() in ('manager', 'employee', 'sales'))
$$;

-- owner, or a manager of that property
create function public.can_manage_property(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.current_app_role() = 'manager' and exists (
    select 1 from public.property_members m where m.property_id = p and m.user_id = auth.uid()))
$$;

-- owner, manager or sales executive of that property (enquiries, campaigns)
create function public.can_sell_property(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.current_app_role() in ('manager', 'sales') and exists (
    select 1 from public.property_members m where m.property_id = p and m.user_id = auth.uid()))
$$;

create function public.is_manager_or_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('admin', 'manager'), false)
$$;

create function public.require_manage(p text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_property(p) then
    raise exception 'You do not manage this property' using errcode = '42501';
  end if;
end $$;

revoke all on function public.my_property_ids(), public.can_access_property(text), public.can_manage_property(text),
  public.can_sell_property(text), public.is_manager_or_owner(), public.require_manage(text) from public;
grant execute on function public.my_property_ids(), public.can_access_property(text), public.can_manage_property(text),
  public.can_sell_property(text), public.is_manager_or_owner(), public.require_manage(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- floors / rooms / beds
create table public.floors (
  property_id text not null references public.properties (id) on delete cascade,
  number      int  not null,
  name        text not null default '',
  is_active   boolean not null default true,
  primary key (property_id, number)
);

alter table public.rooms
  add column property_id       text not null default 'P1' references public.properties (id),
  add column room_type         text not null default 'double'
                                 check (room_type in ('single', 'double', 'triple', 'dormitory', 'flat', 'other')),
  add column attached_bathroom boolean not null default true,
  add column furnishing        text not null default 'furnished'
                                 check (furnishing in ('furnished', 'semi-furnished', 'unfurnished')),
  add column photos            text[] not null default '{}';
create index rooms_property_idx on public.rooms (property_id);
-- room numbers were unique for the one PG; with several properties they are unique per property
alter table public.rooms drop constraint rooms_room_no_key;
create unique index rooms_property_room_no_key on public.rooms (property_id, room_no);

alter table public.beds
  add column code        text,                         -- P1-F2-R204-B1, kept in step by trigger
  add column rent        int check (rent is null or rent > 0),   -- null = use the room price
  add column is_active   boolean not null default true,
  add column is_reserved boolean not null default false,          -- mirror of an active reservation (for Realtime)
  add column block_reason text;
alter table public.beds drop constraint beds_status_check;
alter table public.beds add constraint beds_status_check check (status in ('available', 'maintenance', 'blocked'));
create unique index beds_code_key on public.beds (code);

-- room inserts/updates create the floor row and keep bed codes current
create function public.room_floor_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.floors (property_id, number) values (new.property_id, new.floor) on conflict do nothing;
  if tg_op = 'UPDATE' and (new.room_no, new.floor, new.property_id) is distinct from (old.room_no, old.floor, old.property_id) then
    update public.beds set code = null where room_id = new.id;   -- bed trigger rebuilds it
  end if;
  return new;
end $$;
create trigger rooms_floor_sync after insert or update on public.rooms
  for each row execute function public.room_floor_sync();

create function public.bed_number(label text) returns text
language sql immutable as $$
  select case when label ~ '^[A-Za-z]$' then (ascii(upper(label)) - 64)::text else regexp_replace(label, '\W', '', 'g') end
$$;

create function public.bed_code_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.rooms%rowtype;
begin
  select * into r from public.rooms where id = new.room_id;
  new.code := r.property_id || '-F' || r.floor || '-R' || regexp_replace(r.room_no, '\W', '', 'g') || '-B' || public.bed_number(new.label);
  return new;
end $$;
create trigger beds_code_fill before insert or update of label, room_id, code on public.beds
  for each row execute function public.bed_code_fill();

-- backfill floors and codes for rooms that existed before this migration
insert into public.floors (property_id, number) select distinct property_id, floor from public.rooms on conflict do nothing;
update public.beds set code = null;

-- ---------------------------------------------------------------- rent history (PRD 2.4)
create table public.rent_changes (
  id             bigint generated always as identity primary key,
  room_id        text references public.rooms (id) on delete cascade,
  bed_id         uuid references public.beds (id) on delete cascade,
  booking_id     uuid,                                   -- set when a tenant's own rent changed (transfer / revision)
  old_rent       int,
  new_rent       int,
  effective_from date not null default current_date,
  reason         text not null default '',
  changed_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index rent_changes_room_idx on public.rent_changes (room_id, effective_from desc);
create index rent_changes_bed_idx on public.rent_changes (bed_id, effective_from desc);

create function public.track_rent_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'rooms' and new.price is distinct from old.price then
    insert into public.rent_changes (room_id, old_rent, new_rent, changed_by, reason)
    values (new.id, old.price, new.price, auth.uid(), 'Room rent changed');
  elsif tg_table_name = 'beds' and new.rent is distinct from old.rent then
    insert into public.rent_changes (room_id, bed_id, old_rent, new_rent, changed_by, reason)
    values (new.room_id, new.id, old.rent, new.rent, auth.uid(), 'Bed rent changed');
  end if;
  return new;
end $$;
create trigger rooms_rent_history after update of price on public.rooms for each row execute function public.track_rent_change();
create trigger beds_rent_history after update of rent on public.beds for each row execute function public.track_rent_change();

-- ---------------------------------------------------------------- reservations (PRD 2.3)
create table public.reservations (
  id             uuid primary key default gen_random_uuid(),
  bed_id         uuid not null references public.beds (id) on delete cascade,
  tenant_name    text not null check (char_length(tenant_name) between 2 and 120),
  phone          text,
  customer_id    uuid references public.profiles (id) on delete set null,
  enquiry_id     uuid,                                       -- fk added by the sales migration
  advance_amount int not null default 0 check (advance_amount >= 0),
  advance_mode   text,
  expires_on     date not null,
  status         text not null default 'active' check (status in ('active', 'converted', 'released', 'cancelled')),
  notes          text not null default '',
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  closed_at      timestamptz
);
create unique index reservations_one_active_per_bed on public.reservations (bed_id) where status = 'active';

create function public.sync_bed_reserved() returns trigger
language plpgsql security definer set search_path = public as $$
declare b uuid := coalesce(new.bed_id, old.bed_id);
begin
  update public.beds set is_reserved = exists (select 1 from public.reservations where bed_id = b and status = 'active')
  where id = b;
  if tg_op = 'UPDATE' and old.bed_id <> new.bed_id then
    update public.beds set is_reserved = exists (select 1 from public.reservations where bed_id = old.bed_id and status = 'active')
    where id = old.bed_id;
  end if;
  return null;
end $$;
create trigger reservations_sync after insert or update or delete on public.reservations
  for each row execute function public.sync_bed_reserved();

-- online booking must not take a reserved / blocked / inactive bed
create or replace function public.guard_bed_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.active and exists (select 1 from public.beds b where b.id = new.bed_id
       and (not b.is_active or b.status <> 'available'
            or (b.is_reserved and not exists (select 1 from public.reservations r
                 where r.bed_id = b.id and r.status = 'active' and r.customer_id is not distinct from
                   (select customer_id from public.bookings where id = new.booking_id))))) then
    raise exception 'That bed is reserved or blocked';
  end if;
  return new;
end $$;
create trigger booking_beds_guard before insert on public.booking_beds
  for each row execute function public.guard_bed_booking();

-- derived status used everywhere (PRD 2.3 colour codes)
create function public.bed_state(b public.beds) returns text
language sql stable as $$
  select case
    when not b.is_active then 'inactive'
    when b.is_occupied then 'occupied'
    when b.is_reserved then 'reserved'
    when b.status <> 'available' then 'maintenance'
    else 'vacant' end
$$;

-- ---------------------------------------------------------------- RLS
alter table public.properties       enable row level security;
alter table public.property_members enable row level security;
alter table public.floors           enable row level security;
alter table public.rent_changes     enable row level security;
alter table public.reservations     enable row level security;

grant select on public.properties, public.floors to anon, authenticated;
grant select on public.property_members, public.rent_changes, public.reservations to authenticated;
grant insert, update, delete on public.properties, public.floors to authenticated;
grant update (name, address, city, map_query, lat, lng, geofence_m, phone, gst_no, license_no, photos, is_active)
  on public.properties to authenticated;

create policy properties_read   on public.properties for select using (is_active or public.can_access_property(id));
create policy properties_owner  on public.properties for insert with check (public.is_admin());
create policy properties_update on public.properties for update using (public.can_manage_property(id)) with check (public.can_manage_property(id));
create policy properties_delete on public.properties for delete using (public.is_admin());

create policy members_read on public.property_members for select
  using (user_id = auth.uid() or public.can_access_property(property_id));

create policy floors_read   on public.floors for select using (true);
create policy floors_manage on public.floors for all using (public.can_manage_property(property_id))
  with check (public.can_manage_property(property_id));

-- managers edit the catalogue of their own properties (admin policies from the RLS migration still apply)
create policy rooms_manager on public.rooms for all using (public.can_manage_property(property_id))
  with check (public.can_manage_property(property_id));
create policy beds_manager on public.beds for all
  using (public.can_manage_property((select property_id from public.rooms r where r.id = room_id)))
  with check (public.can_manage_property((select property_id from public.rooms r where r.id = room_id)));
create policy rooms_staff_read on public.rooms for select using (public.can_access_property(property_id));

create policy rent_changes_read on public.rent_changes for select
  using (public.can_manage_property((select property_id from public.rooms r where r.id = room_id)));

create policy reservations_read on public.reservations for select using (
  customer_id = auth.uid()
  or public.can_access_property((select r.property_id from public.beds b join public.rooms r on r.id = b.room_id where b.id = bed_id)));

-- ---------------------------------------------------------------- RPCs
create function public.bed_property(p_bed uuid) returns text
language sql stable security definer set search_path = public as $$
  select r.property_id from public.beds b join public.rooms r on r.id = b.room_id where b.id = p_bed
$$;

create function public.admin_assign_member(p_property text, p_user uuid, p_assigned boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Owner only' using errcode = '42501'; end if;
  if p_assigned then
    insert into public.property_members values (p_property, p_user) on conflict do nothing;
  else
    delete from public.property_members where property_id = p_property and user_id = p_user;
  end if;
  perform public.log_activity('property.member', 'property', p_property,
                              jsonb_build_object('user', p_user, 'assigned', p_assigned));
end $$;

-- owner changes a user's role (profiles.role is never client-writable)
create function public.admin_set_role(p_user uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Owner only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role'; end if;
  update public.profiles set role = p_role where id = p_user;
  if p_role = 'employee' then insert into public.employee_permissions (employee_id) values (p_user) on conflict do nothing; end if;
  perform public.log_activity('user.role', 'user', p_user::text, jsonb_build_object('role', p_role));
end $$;

-- PRD 2.2 bulk creation: e.g. 10 rooms with 3 beds each in one step
create function public.bulk_create_rooms(p_property text, p_floor int, p_first_room_no int, p_count int,
                                         p_beds_per_room int, p_category text, p_room_type text, p_ac_type text,
                                         p_price int, p_deposit int default 0, p_billing text default 'month')
returns int language plpgsql security definer set search_path = public as $$
declare i int; rid text; made int := 0;
begin
  perform public.require_manage(p_property);
  if p_count not between 1 and 100 or p_beds_per_room not between 1 and 20 then
    raise exception 'Between 1 and 100 rooms, 1 and 20 beds each';
  end if;
  if p_price is null or p_price <= 0 then raise exception 'Enter a rent above zero'; end if;
  for i in 0 .. p_count - 1 loop
    rid := lower(p_property) || '-' || (p_first_room_no + i);
    if exists (select 1 from public.rooms where id = rid or (property_id = p_property and room_no = (p_first_room_no + i)::text)) then
      raise exception 'Room % already exists', p_first_room_no + i;
    end if;
    insert into public.rooms (id, property_id, category_id, room_no, floor, ac_type, room_type, rent_basis,
                              billing_period, price, deposit, is_demo_price)
    values (rid, p_property, p_category, (p_first_room_no + i)::text, p_floor, p_ac_type, p_room_type, 'bed',
            p_billing, p_price, coalesce(p_deposit, 0), false);
    insert into public.beds (room_id, label) select rid, chr(64 + n) from generate_series(1, p_beds_per_room) n;
    made := made + 1;
  end loop;
  perform public.log_activity('rooms.bulk_created', 'property', p_property,
                              jsonb_build_object('rooms', made, 'beds_each', p_beds_per_room, 'floor', p_floor));
  return made;
end $$;

-- deactivating a floor hides its rooms; reactivating shows them again
create function public.set_floor_active(p_property text, p_floor int, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_manage(p_property);
  if not p_active and exists (select 1 from public.beds b join public.rooms r on r.id = b.room_id
                              where r.property_id = p_property and r.floor = p_floor and b.is_occupied) then
    raise exception 'Some beds on this floor are occupied';
  end if;
  update public.floors set is_active = p_active where property_id = p_property and number = p_floor;
  update public.rooms set is_active = p_active where property_id = p_property and floor = p_floor;
end $$;

create function public.reserve_bed(p_bed uuid, p_name text, p_phone text, p_advance int, p_expires date,
                                   p_customer uuid default null, p_enquiry uuid default null, p_mode text default null,
                                   p_notes text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.beds%rowtype; rid uuid;
begin
  if not public.can_sell_property(public.bed_property(p_bed)) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into b from public.beds where id = p_bed for update;
  if not found then raise exception 'Bed not found'; end if;
  if b.is_occupied or b.is_reserved or b.status <> 'available' or not b.is_active then
    raise exception 'Bed % is not vacant', b.code;
  end if;
  if p_expires is null or p_expires < current_date then raise exception 'Expiry date must be today or later'; end if;
  insert into public.reservations (bed_id, tenant_name, phone, customer_id, enquiry_id, advance_amount, advance_mode,
                                   expires_on, notes, created_by)
  values (p_bed, trim(p_name), nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''), p_customer, p_enquiry,
          coalesce(p_advance, 0), p_mode, p_expires, coalesce(p_notes, ''), auth.uid())
  returning id into rid;
  perform public.log_activity('bed.reserved', 'bed', p_bed::text, jsonb_build_object('reservation', rid, 'advance', p_advance));
  return rid;
end $$;

create function public.cancel_reservation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reservations%rowtype;
begin
  select * into r from public.reservations where id = p_id for update;
  if not found or not public.can_sell_property(public.bed_property(r.bed_id)) then raise exception 'Reservation not found'; end if;
  if r.status <> 'active' then raise exception 'Reservation is already closed'; end if;
  update public.reservations set status = 'cancelled', closed_at = now() where id = p_id;
  perform public.log_activity('bed.reservation_cancelled', 'reservation', p_id::text, '{}');
end $$;

create function public.set_bed_block(p_bed uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_manage_property(public.bed_property(p_bed))
          or (public.has_permission('can_manage_beds') and public.can_access_property(public.bed_property(p_bed)))) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_status not in ('available', 'maintenance', 'blocked') then raise exception 'Bad status'; end if;
  if p_status <> 'available' and exists (select 1 from public.beds where id = p_bed and (is_occupied or is_reserved)) then
    raise exception 'That bed is occupied or reserved';
  end if;
  update public.beds set status = p_status, block_reason = case when p_status = 'available' then null else p_reason end
  where id = p_bed;
  perform public.log_activity('bed.status', 'bed', p_bed::text, jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

revoke all on function public.bed_property(uuid), public.admin_assign_member(text, uuid, boolean),
  public.admin_set_role(uuid, public.app_role),
  public.bulk_create_rooms(text, int, int, int, int, text, text, text, int, int, text), public.set_floor_active(text, int, boolean),
  public.reserve_bed(uuid, text, text, int, date, uuid, uuid, text, text), public.cancel_reservation(uuid),
  public.set_bed_block(uuid, text, text) from public, anon;
grant execute on function public.bed_property(uuid), public.admin_assign_member(text, uuid, boolean),
  public.admin_set_role(uuid, public.app_role),
  public.bulk_create_rooms(text, int, int, int, int, text, text, text, int, int, text), public.set_floor_active(text, int, boolean),
  public.reserve_bed(uuid, text, text, int, date, uuid, uuid, text, text), public.cancel_reservation(uuid),
  public.set_bed_block(uuid, text, text) to authenticated, service_role;
grant execute on function public.bed_state(public.beds) to anon, authenticated, service_role;
