-- A wing and B wing are run as two separate properties: P1 = A wing, P2 = B wing. Beds, tenants, money,
-- expenses, staff, complaints and reports already split by property, and "All properties" gives the combined
-- totals. Managers of the old single property get both wings. Each login can have a default wing to open on.

-- ---------------------------------------------------------------- one wing per property
alter table public.properties add column wing text check (wing ~ '^[A-Z]$');

update public.properties set wing = 'A', name = 'YOLO Nest A wing' where id = 'P1';
insert into public.properties (id, name, address, city, map_query, lat, lng, geofence_m, phone, gst_no, license_no, wing)
select 'P2', 'YOLO Nest B wing', address, city, map_query, lat, lng, geofence_m, phone, gst_no, license_no, 'B'
from public.properties where id = 'P1'
on conflict (id) do update set wing = 'B';

-- a room takes the wing of its property, so A/B can't disagree with the building it is in
create function public.room_wing_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare w text := (select wing from public.properties where id = new.property_id);
begin
  if w is not null then new.wing := w; end if;
  return new;
end $$;

-- bulk creation uses the property's wing when it has one (same signature, so grants stay)
create or replace function public.bulk_create_rooms(p_property text, p_floor int, p_first_room_no int, p_count int,
                                                    p_beds_per_room int, p_category text, p_room_type text, p_ac_type text,
                                                    p_price int, p_deposit int default 0, p_billing text default 'month',
                                                    p_wing text default 'A')
returns int language plpgsql security definer set search_path = public as $$
declare i int; rid text; made int := 0;
        w text := upper(coalesce((select wing from public.properties where id = p_property), p_wing, 'A'));
begin
  perform public.require_manage(p_property);
  if p_count not between 1 and 100 or p_beds_per_room not between 1 and 20 then
    raise exception 'Between 1 and 100 rooms, 1 and 20 beds each';
  end if;
  if p_price is null or p_price <= 0 then raise exception 'Enter a rent above zero'; end if;
  if w !~ '^[A-Z]$' then raise exception 'Wing must be a single letter'; end if;
  for i in 0 .. p_count - 1 loop
    rid := lower(p_property) || '-' || lower(w) || '-' || (p_first_room_no + i);
    if exists (select 1 from public.rooms where id = rid
               or (property_id = p_property and wing = w and room_no = (p_first_room_no + i)::text)) then
      raise exception 'Room %-% already exists', w, p_first_room_no + i;
    end if;
    insert into public.rooms (id, property_id, wing, category_id, room_no, floor, ac_type, room_type, rent_basis,
                              billing_period, price, deposit, is_demo_price)
    values (rid, p_property, w, p_category, (p_first_room_no + i)::text, p_floor, p_ac_type, p_room_type, 'bed',
            p_billing, p_price, coalesce(p_deposit, 0), false);
    insert into public.beds (room_id, label) select rid, chr(64 + n) from generate_series(1, p_beds_per_room) n;
    made := made + 1;
  end loop;
  perform public.log_activity('rooms.bulk_created', 'property', p_property,
                              jsonb_build_object('rooms', made, 'beds_each', p_beds_per_room, 'floor', p_floor, 'wing', w));
  return made;
end $$;

-- ---------------------------------------------------------------- move B wing rooms and everything tied to them
update public.rooms set property_id = 'P2' where property_id = 'P1' and wing = 'B';

create trigger rooms_wing_fill before insert or update of property_id, wing on public.rooms
  for each row execute function public.room_wing_fill();

update public.bookings b set property_id = r.property_id
from public.rooms r where r.id = b.room_id and b.property_id is distinct from r.property_id;

update public.agreements a set property_id = b.property_id
from public.bookings b where b.id = a.booking_id and a.property_id is distinct from b.property_id;

update public.security_deposits d set property_id = b.property_id
from public.bookings b where b.id = d.booking_id and d.property_id is distinct from b.property_id;

update public.complaints c set property_id = r.property_id
from public.rooms r where r.id = c.room_id and c.property_id <> r.property_id;

-- a tenant belongs to the wing of their latest stay
update public.tenant_profiles t set property_id = s.property_id
from (select distinct on (customer_id) customer_id, property_id from public.bookings
      where property_id is not null order by customer_id, created_at desc) s
where s.customer_id = t.user_id and t.property_id is distinct from s.property_id;

-- the guest register names rooms "B-101"
update public.register_guests set property_id = 'P2' where property_id = 'P1' and room_no like 'B-%';
update public.register_history h set property_id = g.property_id
from public.register_guests g where g.id = h.guest_id and h.property_id <> g.property_id;

-- floors left empty in A wing by the move
delete from public.floors f where f.property_id = 'P1'
  and not exists (select 1 from public.rooms r where r.property_id = 'P1' and r.floor = f.number);

-- ---------------------------------------------------------------- managers see both wings, open on a default one
alter table public.property_members add column is_default boolean not null default false;
create unique index property_members_one_default on public.property_members (user_id) where is_default;

update public.property_members set is_default = true where property_id = 'P1';
insert into public.property_members (property_id, user_id)
select 'P2', user_id from public.property_members where property_id = 'P1'
on conflict do nothing;

-- owner picks which wing a login opens on (null = none, they open on their first wing)
create function public.admin_set_default_property(p_user uuid, p_property text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Owner only' using errcode = '42501'; end if;
  if p_property is not null and not exists (
    select 1 from public.property_members where user_id = p_user and property_id = p_property) then
    raise exception 'Assign the property to this login first' using errcode = '22023';
  end if;
  update public.property_members set is_default = false where user_id = p_user and is_default;
  update public.property_members set is_default = true where user_id = p_user and property_id = p_property;
  perform public.log_activity('property.default', 'profile', p_user::text, jsonb_build_object('property', p_property));
end $$;

-- unassigning the default wing just clears the default
create or replace function public.admin_assign_member(p_property text, p_user uuid, p_assigned boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Owner only' using errcode = '42501'; end if;
  if p_assigned then
    insert into public.property_members (property_id, user_id) values (p_property, p_user) on conflict do nothing;
  else
    delete from public.property_members where property_id = p_property and user_id = p_user;
  end if;
  perform public.log_activity('property.member', 'property', p_property,
                              jsonb_build_object('user', p_user, 'assigned', p_assigned));
end $$;

revoke all on function public.admin_set_default_property(uuid, text) from public, anon;
grant execute on function public.admin_set_default_property(uuid, text) to authenticated;
revoke all on function public.room_wing_fill() from public, anon, authenticated;
