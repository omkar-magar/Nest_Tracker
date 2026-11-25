-- 1. Registration payment, taken on the signup form BEFORE the email OTP (no account exists yet), so it is keyed by
--    email and claimed by submit_resident_registration once the account is verified. Demo provider only for now;
--    the owner sets the amount in Settings (0 = no payment needed).
-- 2. Resident dashboard: my_stay() returns the live register stay, this month's and next month's rent with extras,
--    and the furniture recorded in the resident's room.
-- 3. Extra furniture (chair, table, cupboard): residents request it, a manager approves, and the price is added to
--    the next rent. Approved items are added to the room's inventory.

insert into public.app_settings (key, value) values
  ('registration_fee', '1000'::jsonb),
  ('addon_prices', '{"chair": 100, "table": 400, "cupboard": 500}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- registration payment
create table public.registration_payments (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null check (email ~ '^[^@\s]+@[^@\s]+$' and length(email) <= 254),
  phone               text not null default '' check (phone ~ '^[0-9]{0,15}$'),
  property_id         text references public.properties (id),
  amount              int  not null check (amount > 0),
  provider            text not null check (provider in ('demo')),
  is_simulated        boolean not null default true,
  status              text not null default 'created' check (status in ('created', 'succeeded', 'failed')),
  provider_payment_id text,
  customer_id         uuid references public.profiles (id) on delete set null,   -- set when the registration claims it
  claimed_at          timestamptz,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);
create index registration_payments_email_idx on public.registration_payments (lower(email), created_at desc);
create index registration_payments_customer_idx on public.registration_payments (customer_id) where customer_id is not null;

alter table public.registration_payments enable row level security;
grant select on public.registration_payments to authenticated;
-- written only by the functions below; read by the payer and by the wing's managers
create policy regpay_read on public.registration_payments for select
  using (customer_id = auth.uid() or public.is_admin() or (property_id is not null and public.can_manage_property(property_id)));

create function public.registration_fee() returns int
language sql stable security definer set search_path = public as $$
  select greatest(coalesce((select (value #>> '{}')::int from public.app_settings where key = 'registration_fee'), 0), 0)
$$;

create function public.start_registration_payment(p_email text, p_phone text default '', p_property text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare fee int := public.registration_fee(); demo_on boolean; em text := lower(trim(coalesce(p_email, ''))); pid uuid;
begin
  if fee <= 0 then raise exception 'No registration payment is needed'; end if;
  if em !~ '^[^@\s]+@[^@\s]+$' then raise exception 'Enter a valid email first'; end if;
  if p_property is not null and not exists (select 1 from public.properties where id = p_property and is_active) then
    raise exception 'Choose an active property';
  end if;
  select (value #>> '{}')::boolean into demo_on from public.app_settings where key = 'demo_payments_enabled';
  if not coalesce(demo_on, false) then
    raise exception 'Online registration payment is not available yet. Please contact the office.';
  end if;
  if (select count(*) from public.registration_payments where lower(email) = em and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many payment attempts. Try again in an hour.';
  end if;
  insert into public.registration_payments (email, phone, property_id, amount, provider, is_simulated)
  values (em, right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 15), p_property, fee, 'demo', true)
  returning id into pid;
  return jsonb_build_object('id', pid, 'amount', fee);
end $$;

-- the demo "gateway": the payer picks the outcome; refused once demo payments are switched off
create function public.demo_complete_registration_payment(p_id uuid, p_outcome text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare demo_on boolean; r public.registration_payments;
begin
  select (value #>> '{}')::boolean into demo_on from public.app_settings where key = 'demo_payments_enabled';
  if not coalesce(demo_on, false) then raise exception 'Demo payments are disabled'; end if;
  if p_outcome not in ('success', 'failure') then raise exception 'Bad outcome'; end if;
  select * into r from public.registration_payments where id = p_id and provider = 'demo' for update;
  if not found then raise exception 'Payment not found'; end if;
  if r.status = 'created' then
    update public.registration_payments set status = case p_outcome when 'success' then 'succeeded' else 'failed' end,
      provider_payment_id = 'demo_pay_' || gen_random_uuid(), completed_at = now()
    where id = p_id returning * into r;
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'amount', r.amount, 'is_simulated', r.is_simulated);
end $$;

-- same checks as before, plus: when a fee is set, a succeeded registration payment made with this account's email
create or replace function public.submit_resident_registration(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare manager_id uuid; fee int := public.registration_fee(); pay public.registration_payments; pay_id uuid; my_email text;
begin
  if public.current_app_role() is distinct from 'customer' then raise exception 'Tenants only'; end if;
  perform 1 from public.profiles where id = auth.uid() for update;
  if exists (select 1 from public.register_guests where customer_id = auth.uid() and checked_out_on is null) then
    raise exception 'Your stay is active. Contact your manager to change it';
  end if;
  if not exists (select 1 from public.properties where id = p ->> 'property_id' and is_active) then
    raise exception 'Choose an active property';
  end if;
  if not coalesce((p ->> 'rules_accepted')::boolean, false) then raise exception 'Accept the rules and regulations to register'; end if;
  if fee > 0 then
    begin pay_id := nullif(p ->> 'payment_id', '')::uuid; exception when others then pay_id := null; end;
    select email into my_email from auth.users where id = auth.uid();
    select * into pay from public.registration_payments where id = pay_id for update;
    if not found or pay.status <> 'succeeded' or lower(pay.email) <> lower(coalesce(my_email, '')) then
      raise exception 'Pay the registration amount before registering';
    end if;
    -- a payment belongs to one registration; resubmitting the same pending registration may reuse it
    if pay.customer_id is not null and not (pay.customer_id = auth.uid()
      and exists (select 1 from public.tenant_profiles where user_id = auth.uid() and registration_state = 'pending')) then
      raise exception 'This registration payment has already been used';
    end if;
    update public.registration_payments set customer_id = auth.uid(), claimed_at = coalesce(claimed_at, now()),
      property_id = p ->> 'property_id' where id = pay.id;
  end if;
  perform public.save_my_tenant_profile(p - 'payment_id');
  update public.tenant_profiles set property_id = p ->> 'property_id', registration_state = 'pending',
    approval_status = 'pending', approved_by = null, approved_at = null, approval_note = '',
    rules_accepted_at = now(), rules_signature = coalesce(nullif(trim(p ->> 'rules_signature'), ''), p ->> 'full_name')
  where user_id = auth.uid();
  for manager_id in select pr.id from public.profiles pr where pr.is_active and
    (pr.role = 'admin' or (pr.role = 'manager' and exists (select 1 from public.property_members pm
      where pm.user_id = pr.id and pm.property_id = p ->> 'property_id'))) loop
    perform public.notify(manager_id, array['in_app', 'push'], 'registration', 'New registration',
      coalesce(p ->> 'full_name', 'A new resident') || ' registered and is waiting for approval.',
      '/admin/register?wing=' || (p ->> 'property_id') || '&tab=new',
      'registration:' || auth.uid() || ':' || manager_id || ':' || txid_current(), 'tenant', auth.uid()::text);
  end loop;
end $$;

-- status for the resident, now with the registration payment
create or replace function public.my_registration() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('state', t.registration_state, 'approval', t.approval_status, 'property_id', t.property_id,
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

-- ---------------------------------------------------------------- extra furniture
create table public.resident_addons (
  id           bigint generated always as identity primary key,
  customer_id  uuid not null references public.profiles (id) on delete cascade,
  guest_id     bigint references public.register_guests (id) on delete set null,
  property_id  text not null references public.properties (id),
  room_no      text not null,                                  -- as in the register: 'A-101'
  item         text not null check (item ~ '^[a-z_]{1,30}$'),
  qty          int  not null check (qty between 1 and 5),
  unit_price   int  not null check (unit_price >= 0),          -- price when requested, so a later price change does not move it
  status       text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'cancelled')),
  charge_month date,                                           -- first day of the month whose rent includes it
  note         text not null default '',
  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index resident_addons_customer_idx on public.resident_addons (customer_id, created_at desc);
create index resident_addons_open_idx on public.resident_addons (property_id, created_at desc) where status = 'requested';

alter table public.resident_addons enable row level security;
grant select on public.resident_addons to authenticated;
create policy addons_read on public.resident_addons for select
  using (customer_id = auth.uid() or public.can_manage_property(property_id));

create function public.addon_price(p_item text) returns int
language sql stable security definer set search_path = public as $$
  select (value ->> p_item)::int from public.app_settings where key = 'addon_prices' and jsonb_typeof(value -> p_item) = 'number'
$$;

-- the due date in a month for a stay whose first rent is due on p_first (same day of month, clamped to month end)
create function public.rent_due_in(p_first date, p_month date) returns date
language sql immutable as $$
  select case when p_first is null or date_trunc('month', p_month) < date_trunc('month', p_first) then null
    else least(date_trunc('month', p_month)::date + (extract(day from p_first)::int - 1),
               (date_trunc('month', p_month) + interval '1 month - 1 day')::date) end
$$;

create function public.request_addon(p_item text, p_qty int default 1) returns bigint
language plpgsql security definer set search_path = public as $$
declare g public.register_guests; price int := public.addon_price(p_item); nid bigint; mid uuid;
begin
  if public.current_app_role() is distinct from 'customer' then raise exception 'Residents only' using errcode = '42501'; end if;
  select * into g from public.register_guests where customer_id = auth.uid() and checked_out_on is null order by id desc limit 1;
  if not found then raise exception 'You can ask for extras once your stay has started'; end if;
  if price is null then raise exception 'This item is not available'; end if;
  if p_qty is null or p_qty not between 1 and 5 then raise exception 'Choose 1 to 5'; end if;
  if (select count(*) from public.resident_addons where customer_id = auth.uid() and status = 'requested') >= 10 then
    raise exception 'You already have 10 requests waiting. Wait for the manager to answer them.';
  end if;
  insert into public.resident_addons (customer_id, guest_id, property_id, room_no, item, qty, unit_price)
  values (auth.uid(), g.id, g.property_id, g.room_no, p_item, p_qty, price) returning id into nid;
  for mid in select pr.id from public.profiles pr where pr.is_active and (pr.role = 'admin' or (pr.role = 'manager'
    and exists (select 1 from public.property_members pm where pm.user_id = pr.id and pm.property_id = g.property_id))) loop
    perform public.notify(mid, array['in_app', 'push'], 'addon', 'Extra furniture request',
      coalesce(nullif(g.name, ''), 'A resident') || ' (room ' || g.room_no || ') asked for ' || p_qty || ' ' || replace(p_item, '_', ' ') || '.',
      '/admin/inventory?wing=' || g.property_id, 'addon:' || nid || ':' || mid, 'addon', nid::text);
  end loop;
  return nid;
end $$;

create function public.cancel_addon(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.resident_addons set status = 'cancelled', decided_at = now()
  where id = p_id and customer_id = auth.uid() and status = 'requested';
  if not found then raise exception 'Only a waiting request can be cancelled'; end if;
end $$;

-- manager approves (charged with the next unpaid rent, added to the room's stock) or rejects
create function public.decide_addon(p_id bigint, p_approve boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare a public.resident_addons; g public.register_guests; today date := public.ist_date(now()); due date; mon date;
begin
  select * into a from public.resident_addons where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  perform public.require_manage(a.property_id);
  if a.status <> 'requested' then raise exception 'This request has already been answered'; end if;
  if p_approve then
    select * into g from public.register_guests where id = a.guest_id;
    -- the first due date on or after today; skip this month if its rent is already marked paid
    due := coalesce(public.rent_due_in(g.due_date, today), g.due_date);
    if due is null then due := today; end if;
    if due < today or (date_trunc('month', due) = date_trunc('month', today) and g.rent_status = 'paid') then
      due := coalesce(public.rent_due_in(g.due_date, (date_trunc('month', today) + interval '1 month')::date), due);
    end if;
    mon := date_trunc('month', greatest(due, coalesce(g.due_date, due)))::date;
    update public.resident_addons set status = 'approved', charge_month = mon, note = coalesce(p_note, ''),
      decided_by = auth.uid(), decided_at = now() where id = a.id;
    insert into public.room_inventory (property_id, room_no, item, qty)
    values (a.property_id, regexp_replace(a.room_no, '^[A-Za-z]+-', ''), a.item, a.qty)
    on conflict (property_id, room_no, item) do update set qty = least(public.room_inventory.qty + excluded.qty, 999);
  else
    update public.resident_addons set status = 'rejected', note = coalesce(p_note, ''), decided_by = auth.uid(), decided_at = now()
    where id = a.id;
  end if;
  perform public.notify(a.customer_id, array['in_app', 'push'], 'addon',
    case when p_approve then 'Extra furniture approved' else 'Extra furniture request declined' end,
    a.qty || ' ' || replace(a.item, '_', ' ') || case when p_approve
      then ' approved. ₹' || (a.qty * a.unit_price) || ' will be added to your rent for ' || to_char(mon, 'FMMonth YYYY') || '.'
      else ' was not approved.' || coalesce(' ' || nullif(trim(p_note), ''), '') end,
    '/account#my-stay', 'addon-decided:' || a.id, 'addon', a.id::text);
end $$;

-- ---------------------------------------------------------------- resident dashboard
create function public.my_stay() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g public.register_guests; today date := public.ist_date(now()); this_mon date := date_trunc('month', today)::date;
  next_mon date := (date_trunc('month', today) + interval '1 month')::date; plain text;
begin
  if auth.uid() is null then return null; end if;
  select * into g from public.register_guests where customer_id = auth.uid() and checked_out_on is null order by id desc limit 1;
  if not found then return null; end if;
  plain := regexp_replace(g.room_no, '^[A-Za-z]+-', '');
  return jsonb_build_object(
    'guest_id', g.id, 'property_id', g.property_id,
    'property_name', (select name from public.properties where id = g.property_id),
    'room_no', g.room_no, 'room_type', g.room_type, 'rent', g.rent, 'deposit', g.deposit,
    'rent_status', g.rent_status, 'deposit_status', g.deposit_status,
    'first_due', g.due_date, 'check_in', g.check_in, 'expected_checkout', g.expected_checkout,
    'months', (select jsonb_agg(jsonb_build_object('month', m, 'due_date', public.rent_due_in(g.due_date, m), 'rent', g.rent,
        'extras', coalesce((select jsonb_agg(jsonb_build_object('item', a.item, 'qty', a.qty, 'amount', a.qty * a.unit_price) order by a.id)
                            from public.resident_addons a where a.customer_id = auth.uid() and a.status = 'approved' and a.charge_month = m), '[]'),
        'total', coalesce(g.rent, 0) + coalesce((select sum(a.qty * a.unit_price) from public.resident_addons a
                            where a.customer_id = auth.uid() and a.status = 'approved' and a.charge_month = m), 0),
        'status', case when m = this_mon then g.rent_status else 'upcoming' end) order by m)
      from unnest(array[this_mon, next_mon]) m),
    'inventory', coalesce((select jsonb_object_agg(i.item, i.qty) from public.room_inventory i
                           where i.property_id = g.property_id and i.room_no = plain and i.qty > 0), '{}'),
    'addons', coalesce((select jsonb_agg(to_jsonb(a) - 'customer_id' - 'decided_by' order by a.created_at desc)
                        from (select * from public.resident_addons where customer_id = auth.uid() order by created_at desc limit 50) a), '[]'),
    'addon_prices', coalesce((select value from public.app_settings where key = 'addon_prices'), '{}'));
end $$;

-- managers: requests for their wings, newest first
create function public.addon_requests(p_property text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.waiting desc, x.created_at desc), '[]') from (
    select a.id, a.property_id, a.room_no, a.item, a.qty, a.unit_price, a.qty * a.unit_price amount, a.status,
      a.charge_month, a.note, a.created_at, a.status = 'requested' waiting,
      coalesce(nullif(g.name, ''), pr.full_name) resident
    from public.resident_addons a
    left join public.register_guests g on g.id = a.guest_id
    left join public.profiles pr on pr.id = a.customer_id
    where public.can_manage_property(a.property_id) and (p_property is null or a.property_id = p_property)
    order by a.status = 'requested' desc, a.created_at desc limit 100) x
$$;

revoke all on function public.registration_fee(), public.start_registration_payment(text, text, text),
  public.demo_complete_registration_payment(uuid, text), public.addon_price(text), public.request_addon(text, int),
  public.cancel_addon(bigint), public.decide_addon(bigint, boolean, text), public.my_stay(), public.addon_requests(text) from public;
grant execute on function public.registration_fee(), public.start_registration_payment(text, text, text),
  public.demo_complete_registration_payment(uuid, text) to anon, authenticated;
grant execute on function public.request_addon(text, int), public.cancel_addon(bigint), public.decide_addon(bigint, boolean, text),
  public.my_stay(), public.addon_requests(text) to authenticated;
grant execute on function public.rent_due_in(date, date) to authenticated;
