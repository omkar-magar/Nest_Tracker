-- Registration v2, part 1: the guest verifies (OTP) first, then fills the form and chooses the stay themselves:
-- stay type (PG, flat, PG daily, flat daily), a free room, move-in date, check-out date for daily stays, and a rent
-- due day of 1-10 for monthly stays (joining on the 1st-10th makes the joining day the due day). Prices come from
-- Settings (stay_prices). A sent registration waits for payment (online by default) before the manager approves.
-- The old registration fee paid before the OTP is no longer required.

insert into public.app_settings (key, value) values
  ('stay_prices', '{"pg_rent": 7000, "pg_deposit": 7000, "flat_rent": 18000, "flat_deposit": 18000,
    "pg_daily_rate": 800, "pg_daily_deposit": 1000, "flat_daily_rate": 2500, "flat_daily_deposit": 2000}'::jsonb)
on conflict (key) do nothing;

alter table public.tenant_profiles
  add column stay_type      text check (stay_type in ('pg', 'flat', 'pg_daily', 'flat_daily')),
  add column room_no        text,            -- register room key (A-101) the guest chose
  add column checkout_date  date,            -- daily stays
  add column due_day        smallint check (due_day between 1 and 10),
  add column payment_mode   text not null default 'online' check (payment_mode in ('online', 'offline')),
  add column payment_status text not null default 'waiting' check (payment_status in ('waiting', 'paid', 'partially_paid', 'pending')),
  add column amount_due     int check (amount_due >= 0),
  add column amount_paid    int not null default 0 check (amount_paid >= 0);

alter table public.register_guests
  add column stay_type text check (stay_type in ('pg', 'flat', 'pg_daily', 'flat_daily'));

create function public.room_key(p_wing text, p_room text) returns text
language sql immutable as $$
  select case when coalesce(p_wing, '') <> '' then p_wing || '-' || p_room else p_room end
$$;

-- what a stay costs. Monthly: one month's rent + deposit. Daily: rate x nights + deposit, where every 30 nights
-- cost one month's rent and the nights left over never cost more than a month.
create function public.stay_quote(p_type text, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s jsonb := coalesce((select value from public.app_settings where key = 'stay_prices'), '{}');
  base text := case when p_type like 'flat%' then 'flat' else 'pg' end;
  month_rent int := greatest(coalesce((s ->> (base || '_rent'))::int, 0), 0);
  dep int := greatest(coalesce((s ->> (p_type || '_deposit'))::int, 0), 0);
  rate int; nights int; charge int;
begin
  if p_type is null or p_type not in ('pg', 'flat', 'pg_daily', 'flat_daily') then raise exception 'Choose PG, flat, PG daily or flat daily'; end if;
  if p_type in ('pg', 'flat') then
    return jsonb_build_object('stay_type', p_type, 'daily', false, 'rent', month_rent, 'deposit', dep, 'amount', month_rent + dep);
  end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'Choose a check-out date after the move-in date'; end if;
  rate := greatest(coalesce((s ->> (p_type || '_rate'))::int, 0), 0);
  nights := p_to - p_from;
  charge := (nights / 30) * month_rent + least((nights % 30) * rate, month_rent);
  return jsonb_build_object('stay_type', p_type, 'daily', true, 'rate', rate, 'nights', nights, 'monthly_rent', month_rent,
    'rent', charge, 'deposit', dep, 'amount', charge + dep);
end $$;

-- first rent due date after joining: same day next month when joining on the 1st-10th, otherwise the chosen due
-- day of the next month (the extra days up to the cycle are billed then).
create function public.registration_first_due(p_check_in date, p_due_day int) returns date
language sql immutable as $$
  select case when p_check_in is null then null
    when extract(day from p_check_in) <= 10 then (p_check_in + interval '1 month')::date
    when p_due_day is null then null
    else (date_trunc('month', p_check_in) + interval '1 month')::date + (p_due_day - 1) end
$$;

-- rooms a guest may pick: active rooms with a free bed (PG) or completely free (flat). Register guests take beds.
-- Only counts leave this function, never names.
create function public.registration_rooms(p_property text, p_type text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('room_no', x.k, 'floor', x.floor, 'free', x.free, 'beds', x.beds, 'ac_type', x.ac_type)
                            order by x.floor, x.k), '[]')
  from (
    select r.floor, r.ac_type, public.room_key(r.wing, r.room_no) k,
      count(b.id) filter (where b.is_active) beds,
      count(b.id) filter (where b.is_active and b.status = 'available' and not b.is_occupied and not b.is_reserved)
        - (select count(*) from public.register_guests g where g.property_id = r.property_id and g.checked_out_on is null
             and btrim(g.name) <> '' and g.room_no = public.room_key(r.wing, r.room_no)) free
    from public.rooms r left join public.beds b on b.room_id = r.id
    where r.property_id = p_property and r.is_active
      and (r.room_type = 'flat') = (p_type in ('flat', 'flat_daily'))
    group by r.id
  ) x
  where x.free > 0 and (p_type not in ('flat', 'flat_daily') or x.free = x.beds)
$$;

create or replace function public.submit_resident_registration(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare manager_id uuid; st text := p ->> 'stay_type'; daily boolean; mv date; out_d date; dd int; q jsonb;
  pid text := p ->> 'property_id';
begin
  if public.current_app_role() is distinct from 'customer' then raise exception 'Tenants only'; end if;
  perform 1 from public.profiles where id = auth.uid() for update;
  if exists (select 1 from public.register_guests where customer_id = auth.uid() and checked_out_on is null) then
    raise exception 'Your stay is active. Contact your manager to change it';
  end if;
  if not exists (select 1 from public.properties where id = pid and is_active) then raise exception 'Choose an active property'; end if;
  if not coalesce((p ->> 'rules_accepted')::boolean, false) then raise exception 'Accept the rules and regulations to register'; end if;
  if st is null or st not in ('pg', 'flat', 'pg_daily', 'flat_daily') then raise exception 'Choose PG, flat, PG daily or flat daily'; end if;
  daily := st in ('pg_daily', 'flat_daily');
  begin
    mv := nullif(p ->> 'move_in_date', '')::date;
    out_d := nullif(p ->> 'checkout_date', '')::date;
  exception when others then raise exception 'Check the dates';
  end;
  if mv is null then raise exception 'Choose your move-in date'; end if;
  if mv < public.ist_date(now()) then raise exception 'The move-in date cannot be in the past'; end if;
  if daily then
    if out_d is null or out_d <= mv then raise exception 'Choose a check-out date after the move-in date'; end if;
  else
    out_d := null;
    dd := case when extract(day from mv) <= 10 then extract(day from mv)::int else nullif(p ->> 'due_day', '')::int end;
    if dd is null or dd not between 1 and 10 then raise exception 'Choose a rent due day from 1 to 10'; end if;
  end if;
  if not exists (select 1 from jsonb_array_elements(public.registration_rooms(pid, st)) r where r ->> 'room_no' = p ->> 'room_no') then
    raise exception 'That room is no longer free. Choose another room';
  end if;
  q := public.stay_quote(st, mv, out_d);
  perform public.save_my_tenant_profile(p - 'payment_id');
  update public.tenant_profiles set property_id = pid, registration_state = 'pending',
    approval_status = 'pending', approved_by = null, approved_at = null, approval_note = '',
    rules_accepted_at = now(), rules_signature = coalesce(nullif(trim(p ->> 'rules_signature'), ''), p ->> 'full_name'),
    stay_type = st, room_no = p ->> 'room_no', move_in_date = mv, checkout_date = out_d, due_day = dd,
    amount_due = (q ->> 'amount')::int, amount_paid = 0, payment_mode = 'online', payment_status = 'waiting'
  where user_id = auth.uid();
  for manager_id in select pr.id from public.profiles pr where pr.is_active and
    (pr.role = 'admin' or (pr.role = 'manager' and exists (select 1 from public.property_members pm
      where pm.user_id = pr.id and pm.property_id = pid))) loop
    perform public.notify(manager_id, array['in_app', 'push'], 'registration', 'New registration',
      coalesce(p ->> 'full_name', 'A new resident') || ' registered for room ' || (p ->> 'room_no') || ' and is waiting for payment.',
      '/admin/register?wing=' || pid || '&tab=new',
      'registration:' || auth.uid() || ':' || manager_id || ':' || txid_current(), 'tenant', auth.uid()::text);
  end loop;
end $$;

-- status for the resident, now with the chosen stay and its payment
create or replace function public.my_registration() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('state', t.registration_state, 'approval', t.approval_status, 'property_id', t.property_id,
    'stay_type', t.stay_type, 'room_no', t.room_no, 'move_in_date', t.move_in_date, 'checkout_date', t.checkout_date,
    'due_day', t.due_day, 'first_due', public.registration_first_due(t.move_in_date, t.due_day),
    'payment_mode', t.payment_mode, 'payment_status', t.payment_status, 'amount_due', t.amount_due, 'amount_paid', t.amount_paid,
    'payment', (select jsonb_build_object('amount', r.amount, 'status', r.status, 'is_simulated', r.is_simulated, 'paid_at', r.completed_at)
                from public.registration_payments r where r.customer_id = auth.uid() order by r.claimed_at desc nulls last limit 1),
    'stays', coalesce((select jsonb_agg(s.row_data order by s.guest_id desc) from (
      select distinct on (h.guest_id) h.guest_id,
        coalesce(h.new_row, h.old_row) || jsonb_build_object('removed', h.op = 'DELETE') as row_data
      from public.register_history h
      where coalesce(h.new_row ->> 'customer_id', h.old_row ->> 'customer_id') = auth.uid()::text
      order by h.guest_id desc, h.id desc limit 100
    ) s), '[]'::jsonb))
  from public.tenant_profiles t where t.user_id = auth.uid()
$$;

revoke all on function public.stay_quote(text, date, date), public.registration_rooms(text, text) from public;
grant execute on function public.stay_quote(text, date, date), public.registration_rooms(text, text) to anon, authenticated;
grant execute on function public.room_key(text, text), public.registration_first_due(date, int) to anon, authenticated;
