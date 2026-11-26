-- Registration v2, part 3: the first due date. A monthly guest pays one full month when registering, which covers
-- check-in to the same day next month. When the chosen due day falls inside that month (joined after the 10th), the
-- first due date bills only the extra days from the end of the paid month up to the next due date (rent / 30 per
-- day); after that the usual monthly rent applies. Joining on the 1st-10th makes the joining day the due day, so
-- there are no extra days.

alter table public.register_guests
  add column first_bill      int check (first_bill >= 0),       -- billed on due_date instead of the rent
  add column first_bill_days int check (first_bill_days >= 0);

create function public.first_bill_for(p_rent int, p_check_in date, p_due date) returns jsonb
language plpgsql immutable as $$
declare paid_until date; days int;
begin
  if p_rent is null or p_check_in is null or p_due is null then return null; end if;
  paid_until := (p_check_in + interval '1 month')::date;          -- first day not covered by the month paid at registration
  if p_due <= p_check_in or p_due >= paid_until then return null; end if;
  days := (p_due + interval '1 month')::date - paid_until;         -- up to the day before the next due date
  return jsonb_build_object('days', days, 'amount', round(p_rent * days / 30.0)::int);
end $$;

-- registrations approved for a monthly stay get their first bill worked out from the rent, check-in and due date
create function public.register_first_bill() returns trigger
language plpgsql as $$
declare b jsonb;
begin
  if new.customer_id is not null and new.stay_type in ('pg', 'flat') and new.first_bill is null then
    b := public.first_bill_for(new.rent, new.check_in, new.due_date);
    if b is not null then
      new.first_bill := (b ->> 'amount')::int;
      new.first_bill_days := (b ->> 'days')::int;
    end if;
  end if;
  return new;
end $$;
create trigger register_guests_first_bill before insert on public.register_guests
  for each row execute function public.register_first_bill();

-- the resident's stay: the first due date shows the extra days instead of the rent
create or replace function public.my_stay() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g public.register_guests; today date := public.ist_date(now()); this_mon date := date_trunc('month', today)::date;
  next_mon date := (date_trunc('month', today) + interval '1 month')::date; plain text; first_mon date;
begin
  if auth.uid() is null then return null; end if;
  select * into g from public.register_guests where customer_id = auth.uid() and checked_out_on is null order by id desc limit 1;
  if not found then return null; end if;
  plain := regexp_replace(g.room_no, '^[A-Za-z]+-', '');
  first_mon := date_trunc('month', g.due_date)::date;
  return jsonb_build_object(
    'guest_id', g.id, 'property_id', g.property_id,
    'property_name', (select name from public.properties where id = g.property_id),
    'room_no', g.room_no, 'room_type', g.room_type, 'stay_type', g.stay_type, 'rent', g.rent, 'deposit', g.deposit,
    'rent_status', g.rent_status, 'deposit_status', g.deposit_status, 'carry_forward', g.carry_forward,
    'first_bill', g.first_bill, 'first_bill_days', g.first_bill_days,
    'first_due', g.due_date, 'check_in', g.check_in, 'expected_checkout', g.expected_checkout,
    'months', (select jsonb_agg(jsonb_build_object('month', m, 'due_date', public.rent_due_in(g.due_date, m),
        'rent', case when m = first_mon and g.first_bill is not null then g.first_bill else g.rent end,
        'extra_days', case when m = first_mon then g.first_bill_days end,
        'carried', case when m = first_mon then g.carry_forward else 0 end,
        'extras', coalesce((select jsonb_agg(jsonb_build_object('item', a.item, 'qty', a.qty, 'amount', a.qty * a.unit_price) order by a.id)
                            from public.resident_addons a where a.customer_id = auth.uid() and a.status = 'approved' and a.charge_month = m), '[]'),
        'total', coalesce(case when m = first_mon and g.first_bill is not null then g.first_bill else g.rent end, 0) + case when m = first_mon then g.carry_forward else 0 end
          + coalesce((select sum(a.qty * a.unit_price) from public.resident_addons a
                      where a.customer_id = auth.uid() and a.status = 'approved' and a.charge_month = m), 0),
        'status', case when m = this_mon then g.rent_status else 'upcoming' end) order by m)
      from unnest(array[this_mon, next_mon]) m),
    'inventory', coalesce((select jsonb_object_agg(i.item, i.qty) from public.room_inventory i
                           where i.property_id = g.property_id and i.room_no = plain and i.qty > 0), '{}'),
    'addons', coalesce((select jsonb_agg(to_jsonb(a) - 'customer_id' - 'decided_by' order by a.created_at desc)
                        from (select * from public.resident_addons where customer_id = auth.uid() order by created_at desc limit 50) a), '[]'),
    'addon_prices', coalesce((select value from public.app_settings where key = 'addon_prices'), '{}'));
end $$;


grant execute on function public.first_bill_for(int, date, date) to authenticated;
