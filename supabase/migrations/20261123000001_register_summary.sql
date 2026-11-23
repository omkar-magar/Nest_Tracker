-- The guest register is where the PG's real guests live (tenants with logins, bookings and bills are still few), so the
-- owner's dashboard and the manager's day read their guest, room and rent figures from it. One call returns every
-- wing the caller may see, the grand total, who is leaving soon, whose rent is pending and the latest changes.
-- Counting follows the register screen: a room with 1 named guest is rented, 2 or more is PG, none is empty; rooms
-- are the property's active rooms (keyed "A-101" when the property has a wing) plus any room only the register uses.
-- Contact numbers are left out on purpose.

create function public.register_summary(p_property text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := public.ist_date(now());
  m date := date_trunc('month', public.ist_date(now()))::date;
  e date := (date_trunc('month', public.ist_date(now())) + interval '1 month' - interval '1 day')::date;
  res jsonb;
begin
  perform public.require_reports();
  with scope as (select public.report_scope(p_property) id),
  live as (
    select g.* from public.register_guests g
    where g.property_id in (select id from scope) and g.checked_out_on is null and btrim(g.name) <> ''),
  room_keys as (
    select r.property_id, case when coalesce(r.wing, '') <> '' then r.wing || '-' || r.room_no else r.room_no end room_no
    from public.rooms r where r.property_id in (select id from scope) and r.is_active
    union
    select g.property_id, g.room_no from public.register_guests g
    where g.property_id in (select id from scope) and g.checked_out_on is null),
  per_room as (
    select k.property_id, k.room_no, count(l.id) people
    from room_keys k left join live l on l.property_id = k.property_id and l.room_no = k.room_no
    group by k.property_id, k.room_no),
  rooms_sum as (
    select property_id, count(*) total, count(*) filter (where people > 0) occupied,
           count(*) filter (where people >= 2) pg_rooms, coalesce(sum(people) filter (where people >= 2), 0) pg_people,
           count(*) filter (where people = 1) rented_rooms, count(*) filter (where people = 0) empty_rooms
    from per_room group by property_id),
  guests_sum as (
    select property_id, count(*) guests, coalesce(sum(rent), 0) rent_roll,
           coalesce(sum(rent) filter (where rent_status = 'paid'), 0) rent_paid,
           coalesce(sum(rent) filter (where rent_status in ('pending', 'partially_paid')), 0) rent_pending,
           count(*) filter (where rent_status = 'pending') rent_pending_guests,
           count(*) filter (where rent_status = 'partially_paid') rent_partial_guests,
           count(*) filter (where rent_status = 'not_updated') rent_not_updated,
           coalesce(sum(deposit) filter (where deposit_status = 'paid'), 0) deposit_held,
           count(*) filter (where deposit_status in ('pending', 'partially_paid')) deposit_pending_guests,
           count(*) filter (where check_in between m and e) checkins_month,
           count(*) filter (where expected_checkout is not null and expected_checkout <= today + 7) leaving_week
    from live group by property_id),
  out_sum as (
    select property_id, count(*) checkouts_month from public.register_guests
    where property_id in (select id from scope) and checked_out_on between m and e group by property_id),
  per as (
    select p.id, p.name,
           coalesce(g.guests, 0) guests, coalesce(r.total, 0) rooms_total, coalesce(r.occupied, 0) rooms_occupied,
           coalesce(r.pg_rooms, 0) pg_rooms, coalesce(r.pg_people, 0) pg_people, coalesce(r.rented_rooms, 0) rented_rooms,
           coalesce(r.empty_rooms, 0) empty_rooms,
           coalesce(g.rent_roll, 0) rent_roll, coalesce(g.rent_paid, 0) rent_paid, coalesce(g.rent_pending, 0) rent_pending,
           coalesce(g.rent_pending_guests, 0) rent_pending_guests, coalesce(g.rent_partial_guests, 0) rent_partial_guests,
           coalesce(g.rent_not_updated, 0) rent_not_updated, coalesce(g.deposit_held, 0) deposit_held,
           coalesce(g.deposit_pending_guests, 0) deposit_pending_guests, coalesce(g.checkins_month, 0) checkins_month,
           coalesce(o.checkouts_month, 0) checkouts_month, coalesce(g.leaving_week, 0) leaving_week
    from public.properties p join scope s on s.id = p.id
    left join rooms_sum r on r.property_id = p.id left join guests_sum g on g.property_id = p.id
    left join out_sum o on o.property_id = p.id)
  select jsonb_build_object(
    'month', m,
    'totals', jsonb_build_object(
      'guests', coalesce(sum(guests), 0), 'rooms_total', coalesce(sum(rooms_total), 0), 'rooms_occupied', coalesce(sum(rooms_occupied), 0),
      'pg_rooms', coalesce(sum(pg_rooms), 0), 'pg_people', coalesce(sum(pg_people), 0), 'rented_rooms', coalesce(sum(rented_rooms), 0),
      'empty_rooms', coalesce(sum(empty_rooms), 0),
      'occupancy_pct', case when sum(rooms_total) > 0 then round(100.0 * sum(rooms_occupied) / sum(rooms_total), 1) else 0 end,
      'rent_roll', coalesce(sum(rent_roll), 0), 'rent_paid', coalesce(sum(rent_paid), 0), 'rent_pending', coalesce(sum(rent_pending), 0),
      'rent_pending_guests', coalesce(sum(rent_pending_guests), 0), 'rent_partial_guests', coalesce(sum(rent_partial_guests), 0),
      'rent_not_updated', coalesce(sum(rent_not_updated), 0), 'deposit_held', coalesce(sum(deposit_held), 0),
      'deposit_pending_guests', coalesce(sum(deposit_pending_guests), 0), 'checkins_month', coalesce(sum(checkins_month), 0),
      'checkouts_month', coalesce(sum(checkouts_month), 0), 'leaving_week', coalesce(sum(leaving_week), 0)),
    'properties', coalesce(jsonb_agg(to_jsonb(per) || jsonb_build_object('occupancy_pct',
       case when rooms_total > 0 then round(100.0 * rooms_occupied / rooms_total, 1) else 0 end) order by id), '[]'))
  into res from per;

  res := res || jsonb_build_object(
    'leaving', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'property_id', property_id, 'name', name, 'room', room_no,
        'date', expected_checkout, 'rent_status', rent_status) order by expected_checkout, room_no)
      from public.register_guests where property_id in (select public.report_scope(p_property)) and checked_out_on is null
        and btrim(name) <> '' and expected_checkout is not null and expected_checkout <= today + 45), '[]'),
    'rent_pending', coalesce((select jsonb_agg(x order by x ->> 'property_id', x ->> 'room') from (
        select jsonb_build_object('id', id, 'property_id', property_id, 'name', name, 'room', room_no, 'rent', rent,
          'rent_status', rent_status, 'check_in', check_in) x
        from public.register_guests where property_id in (select public.report_scope(p_property)) and checked_out_on is null
          and btrim(name) <> '' and rent_status in ('pending', 'partially_paid') limit 200) s), '[]'),
    -- arrivals, departures, returns and rent marked paid; other edits are in the register's change history
    'recent', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
        select jsonb_build_object('op', case when h.op = 'UPDATE' then 'PAID' else h.op end, 'property_id', h.property_id,
          'at', h.changed_at, 'by', h.changed_by_name,
          'name', coalesce(h.new_row ->> 'name', h.old_row ->> 'name'), 'room', coalesce(h.new_row ->> 'room_no', h.old_row ->> 'room_no'),
          'rent', (h.new_row ->> 'rent')::int) x
        from public.register_history h
        where h.property_id in (select public.report_scope(p_property))
          and btrim(coalesce(h.new_row ->> 'name', h.old_row ->> 'name', '')) <> ''
          and (h.op in ('INSERT', 'CHECKOUT', 'RETURN')
               or (h.op = 'UPDATE' and h.new_row ->> 'rent_status' = 'paid' and h.old_row ->> 'rent_status' is distinct from 'paid'))
        order by h.changed_at desc, h.id desc limit 8) s), '[]'));
  return res;
end $$;

revoke all on function public.register_summary(text) from public, anon;
grant execute on function public.register_summary(text) to authenticated, service_role;
