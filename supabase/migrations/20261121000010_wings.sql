-- The PG has two buildings, A wing and B wing. Every room belongs to one wing; room numbers repeat
-- across wings (A-101 and B-101), so uniqueness and bed codes include the wing.

alter table public.rooms
  add column wing text not null default 'A' check (wing ~ '^[A-Z]$');
create index rooms_wing_idx on public.rooms (property_id, wing);

drop index public.rooms_property_room_no_key;
create unique index rooms_property_wing_room_no_key on public.rooms (property_id, wing, room_no);

-- bed codes gain the wing: P1-A-F2-R204-B1
create or replace function public.bed_code_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.rooms%rowtype;
begin
  select * into r from public.rooms where id = new.room_id;
  new.code := r.property_id || '-' || r.wing || '-F' || r.floor || '-R' || regexp_replace(r.room_no, '\W', '', 'g')
              || '-B' || public.bed_number(new.label);
  return new;
end $$;

create or replace function public.room_floor_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.floors (property_id, number) values (new.property_id, new.floor) on conflict do nothing;
  if tg_op = 'UPDATE' and (new.room_no, new.floor, new.property_id, new.wing)
                          is distinct from (old.room_no, old.floor, old.property_id, old.wing) then
    update public.beds set code = null where room_id = new.id;   -- bed trigger rebuilds it
  end if;
  return new;
end $$;

update public.beds set code = null;

-- bulk creation takes the wing too
drop function public.bulk_create_rooms(text, int, int, int, int, text, text, text, int, int, text);
create function public.bulk_create_rooms(p_property text, p_floor int, p_first_room_no int, p_count int,
                                         p_beds_per_room int, p_category text, p_room_type text, p_ac_type text,
                                         p_price int, p_deposit int default 0, p_billing text default 'month',
                                         p_wing text default 'A')
returns int language plpgsql security definer set search_path = public as $$
declare i int; rid text; made int := 0; w text := upper(coalesce(p_wing, 'A'));
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
revoke all on function public.bulk_create_rooms(text, int, int, int, int, text, text, text, int, int, text, text) from public, anon;
grant execute on function public.bulk_create_rooms(text, int, int, int, int, text, text, text, int, int, text, text) to authenticated, service_role;

-- room numbers repeat across wings, so the rent report also returns the room id (and wing) to match on
drop function public.report_rent_collection(date, date, text, int, text, uuid);
create function public.report_rent_collection(p_from date, p_to date, p_property text default null, p_floor int default null,
                                              p_room text default null, p_tenant uuid default null)
returns table (invoice_no text, property_id text, room_no text, tenant text, customer_id uuid, description text, kind text, due_date date,
               billed int, collected int, outstanding int, state text, paid_at timestamptz, room_id text, wing text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  select b.invoice_no, bk.property_id, r.room_no, p.full_name, b.customer_id, b.description, b.kind, b.due_date, b.amount, b.amount_paid,
         case when b.status = 'unpaid' then b.amount - b.amount_paid else 0 end, public.bill_state(b), b.paid_at, r.id, r.wing
  from public.bills b join public.bookings bk on bk.id = b.booking_id join public.rooms r on r.id = bk.room_id
  join public.profiles p on p.id = b.customer_id
  where b.status <> 'void' and b.due_date between p_from and p_to and bk.property_id in (select public.report_scope(p_property))
    and (p_floor is null or r.floor = p_floor) and (p_room is null or r.id = p_room) and (p_tenant is null or b.customer_id = p_tenant)
  order by b.due_date, p.full_name;
end $$;
revoke all on function public.report_rent_collection(date, date, text, int, text, uuid) from public, anon;
grant execute on function public.report_rent_collection(date, date, text, int, text, uuid) to authenticated, service_role;
