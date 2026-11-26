-- Registration v2, part 2: payment and approval.
-- The guest pays the amount of the chosen stay online on the account page (demo provider for now). A manager or
-- the owner approves: an online registration once it is paid, or straight away after switching it to offline and
-- recording what was collected (paid, partly paid or pending). Anything still owed is carried into the first rent
-- (register_guests.carry_forward). The old registration fee taken before the OTP is retired.

alter table public.register_guests
  add column carry_forward int not null default 0 check (carry_forward >= 0);   -- owed from registration, billed with the first rent

drop function public.start_registration_payment(text, text, text);
drop function public.demo_complete_registration_payment(uuid, text);
drop function public.registration_fee();
delete from public.app_settings where key = 'registration_fee';

-- what the guest still has to pay for the registration
create function public.registration_balance(t public.tenant_profiles) returns int
language sql stable as $$
  select greatest(coalesce(t.amount_due, 0) - coalesce(t.amount_paid, 0), 0)
$$;

create function public.registration_managers_notify(p_user uuid, p_property text, p_subject text, p_body text, p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  for mid in select pr.id from public.profiles pr where pr.is_active and (pr.role = 'admin' or (pr.role = 'manager'
    and exists (select 1 from public.property_members pm where pm.user_id = pr.id and pm.property_id = p_property))) loop
    perform public.notify(mid, array['in_app', 'push'], 'registration', p_subject, p_body,
      '/admin/register?wing=' || p_property || '&tab=new', p_key || ':' || mid, 'tenant', p_user::text);
  end loop;
end $$;

-- the guest starts an online payment of what is still owed
create function public.start_my_registration_payment() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tenant_profiles; demo_on boolean; amt int; em text; pid uuid;
begin
  select * into t from public.tenant_profiles where user_id = auth.uid() for update;
  if not found or t.registration_state is distinct from 'pending' or t.stay_type is null then
    raise exception 'Send your registration form first';
  end if;
  if t.payment_mode <> 'online' then raise exception 'Your manager is taking this payment offline'; end if;
  amt := public.registration_balance(t);
  if amt <= 0 then raise exception 'Nothing left to pay'; end if;
  select (value #>> '{}')::boolean into demo_on from public.app_settings where key = 'demo_payments_enabled';
  if not coalesce(demo_on, false) then
    raise exception 'Online payment is not available yet. Ask your manager to take it offline.';
  end if;
  if (select count(*) from public.registration_payments where customer_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many payment attempts. Try again in an hour.';
  end if;
  select email into em from auth.users where id = auth.uid();
  insert into public.registration_payments (email, phone, property_id, amount, provider, is_simulated, customer_id, claimed_at)
  values (lower(coalesce(em, 'unknown@invalid')), '', t.property_id, amt, 'demo', true, auth.uid(), now())
  returning id into pid;
  return jsonb_build_object('id', pid, 'amount', amt);
end $$;

-- the demo "gateway": the payer picks the outcome. Success adds the amount to what the registration has paid.
create function public.demo_complete_my_registration_payment(p_id uuid, p_outcome text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare demo_on boolean; r public.registration_payments; t public.tenant_profiles; p public.profiles;
begin
  select (value #>> '{}')::boolean into demo_on from public.app_settings where key = 'demo_payments_enabled';
  if not coalesce(demo_on, false) then raise exception 'Demo payments are disabled'; end if;
  if p_outcome not in ('success', 'failure') then raise exception 'Bad outcome'; end if;
  select * into r from public.registration_payments where id = p_id and customer_id = auth.uid() and provider = 'demo' for update;
  if not found then raise exception 'Payment not found'; end if;
  if r.status = 'created' then
    update public.registration_payments set status = case p_outcome when 'success' then 'succeeded' else 'failed' end,
      provider_payment_id = 'demo_pay_' || gen_random_uuid(), completed_at = now()
    where id = p_id returning * into r;
    if r.status = 'succeeded' then
      update public.tenant_profiles set amount_paid = amount_paid + r.amount where user_id = auth.uid() returning * into t;
      update public.tenant_profiles set payment_status = case when public.registration_balance(t) = 0 then 'paid' else 'partially_paid' end
      where user_id = auth.uid() returning * into t;
      select * into p from public.profiles where id = auth.uid();
      perform public.registration_managers_notify(auth.uid(), t.property_id, 'Registration paid',
        coalesce(p.full_name, 'A new resident') || ' paid ₹' || r.amount || ' online for room ' || coalesce(t.room_no, '') || '. Ready to approve.',
        'registration-paid:' || r.id);
    end if;
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'amount', r.amount, 'is_simulated', r.is_simulated);
end $$;

-- Approve. Online: only once paid. Offline: whatever was collected, and the rest is carried into the first rent.
-- p: room_no, rent, deposit, due_date, check_in, expected_checkout, room_type, notes,
--    payment_mode ('online' | 'offline'), payment_status ('paid' | 'partially_paid' | 'pending'), amount_paid
create or replace function public.approve_resident_registration(p_user uuid, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare t public.tenant_profiles; u public.profiles; gid bigint; mode text; pst text; paid int; owed int; st text;
begin
  select * into u from public.profiles where id = p_user for update;
  select * into t from public.tenant_profiles where user_id = p_user for update;
  if not found then raise exception 'Registration not found'; end if;
  perform public.require_manage(t.property_id);
  if t.registration_state is distinct from 'pending' then raise exception 'Registration is no longer pending'; end if;
  if not exists (select 1 from public.rooms where property_id = t.property_id and is_active
    and public.room_key(wing, room_no) = p ->> 'room_no') then
    raise exception 'Choose an active room in this property';
  end if;
  if nullif(p ->> 'rent', '') is null or nullif(p ->> 'deposit', '') is null
    or nullif(p ->> 'due_date', '') is null or nullif(p ->> 'check_in', '') is null then
    raise exception 'Rent, deposit, check-in and due date are required';
  end if;

  mode := coalesce(nullif(p ->> 'payment_mode', ''), t.payment_mode, 'online');
  if mode not in ('online', 'offline') then raise exception 'Payment is online or offline'; end if;
  if mode = 'online' then
    if t.payment_status <> 'paid' and t.stay_type is not null then
      raise exception 'Waiting for the online payment. Switch the payment to offline to approve now.';
    end if;
    paid := t.amount_paid;
    pst := case when t.stay_type is null then 'paid' else t.payment_status end;
  else
    pst := coalesce(nullif(p ->> 'payment_status', ''), 'pending');
    if pst not in ('paid', 'partially_paid', 'pending') then raise exception 'Payment is paid, partly paid or pending'; end if;
    paid := coalesce(nullif(p ->> 'amount_paid', '')::int, case pst when 'paid' then t.amount_due else 0 end, 0);
    if paid < 0 then raise exception 'The amount received cannot be negative'; end if;
    if pst = 'partially_paid' and paid <= 0 then raise exception 'Enter the amount received'; end if;
    if pst = 'pending' then paid := 0; end if;
  end if;
  -- what the registration should have collected: the rent and deposit the manager set
  owed := case when t.stay_type is null then 0 else greatest((p ->> 'rent')::int + (p ->> 'deposit')::int - paid, 0) end;
  if pst = 'paid' then owed := 0; end if;
  st := coalesce(t.stay_type, case when p ->> 'room_type' = 'rented' then 'flat' else 'pg' end);

  insert into public.register_guests(property_id, customer_id, room_no, name, contact, rent, deposit,
    check_in, expected_checkout, due_date, room_type, stay_type, notes, sort_order, rent_status, deposit_status, carry_forward)
  values (t.property_id, p_user, p ->> 'room_no', u.full_name, right(regexp_replace(u.phone, '\D', '', 'g'), 10),
    (p ->> 'rent')::int, (p ->> 'deposit')::int, (p ->> 'check_in')::date,
    nullif(p ->> 'expected_checkout', '')::date, (p ->> 'due_date')::date, coalesce(p ->> 'room_type', 'pg'), st,
    coalesce(p ->> 'notes', ''), coalesce((select max(sort_order) + 1 from public.register_guests where property_id = t.property_id), 0),
    case when t.stay_type is null then 'not_updated' else pst end, case when t.stay_type is null then 'not_updated' else pst end, owed)
  returning id into gid;
  update public.tenant_profiles set registration_state = 'active', approval_status = 'approved',
    approved_by = auth.uid(), approved_at = now(), payment_mode = mode, payment_status = pst, amount_paid = paid
  where user_id = p_user;
  perform public.log_activity('tenant.approval', 'tenant', p_user::text,
    jsonb_build_object('status', 'approved', 'room_no', p ->> 'room_no', 'property_id', t.property_id,
      'payment_mode', mode, 'payment_status', pst, 'amount_paid', paid, 'carried', owed));
  perform public.notify(p_user, array['in_app', 'push'], 'registration', 'Registration approved',
    'Welcome to YOLO Nest! Your stay in room ' || (p ->> 'room_no') || ' is confirmed.'
      || case when owed > 0 then ' ₹' || owed || ' still to pay is added to your first rent.' else '' end,
    '/account', 'registration-approved:' || gid, 'tenant', p_user::text);
  return gid;
end $$;

-- the resident's stay, now with what is carried from registration into the first rent
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
    'first_due', g.due_date, 'check_in', g.check_in, 'expected_checkout', g.expected_checkout,
    'months', (select jsonb_agg(jsonb_build_object('month', m, 'due_date', public.rent_due_in(g.due_date, m), 'rent', g.rent,
        'carried', case when m = first_mon then g.carry_forward else 0 end,
        'extras', coalesce((select jsonb_agg(jsonb_build_object('item', a.item, 'qty', a.qty, 'amount', a.qty * a.unit_price) order by a.id)
                            from public.resident_addons a where a.customer_id = auth.uid() and a.status = 'approved' and a.charge_month = m), '[]'),
        'total', coalesce(g.rent, 0) + case when m = first_mon then g.carry_forward else 0 end
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

revoke all on function public.registration_balance(public.tenant_profiles), public.registration_managers_notify(uuid, text, text, text, text),
  public.start_my_registration_payment(), public.demo_complete_my_registration_payment(uuid, text) from public, anon;
grant execute on function public.start_my_registration_payment(), public.demo_complete_my_registration_payment(uuid, text) to authenticated;

-- owner's registrations view: same as before plus the payment, so a sent registration shows "waiting for payment"
create or replace function public.admin_registrations(p_property text default null, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'Only the owner can see this' using errcode = '42501'; end if;
  with base as (
    select p.id, p.full_name, p.phone, p.created_at signed_up_at, t.property_id, t.approval_note,
      t.payment_mode, t.payment_status, t.room_no chosen_room, t.stay_type,
      case when t.registration_state is not null then t.rules_accepted_at end submitted_at,
      t.approved_at, ap.full_name approved_by,
      case when t.registration_state = 'ended' then 'ended'
           when t.registration_state = 'active' then 'living'
           when t.registration_state = 'pending' and t.approval_status = 'rejected' then 'rejected'
           when t.registration_state = 'pending' then 'waiting'
           -- older app tenants were approved without this flow; they are not "started"
           when t.user_id is null or t.approval_status = 'pending' then 'started' end stage
    from public.profiles p
    left join public.tenant_profiles t on t.user_id = p.id
    left join public.profiles ap on ap.id = t.approved_by
    where p.role = 'customer' and p.is_active
      and (p_property is null or t.property_id = p_property or t.property_id is null)
  ), regs as (select * from base where stage is not null)
  select jsonb_build_object(
    'counts', (select jsonb_object_agg(s, (select count(*) from regs where stage = s))
               from unnest(array['started', 'waiting', 'rejected', 'living', 'ended']) s),
    'rows', coalesce((select jsonb_agg(x order by x ->> 'sort_at' desc) from (
      select jsonb_build_object(
        'id', r.id, 'name', r.full_name, 'phone', r.phone, 'stage', r.stage, 'property_id', r.property_id,
        'signed_up_at', r.signed_up_at, 'submitted_at', r.submitted_at, 'approved_at', r.approved_at,
        'approved_by', r.approved_by, 'note', r.approval_note,
        'sort_at', coalesce(r.submitted_at, r.signed_up_at),
        'room_no', coalesce(g.room_no, r.chosen_room), 'stay_type', r.stay_type,
        'payment', case when r.stay_type is null then null when r.payment_mode = 'online' and r.payment_status <> 'paid' then 'waiting' else r.payment_status end,
        'payment_mode', r.payment_mode, 'check_in', g.check_in, 'checked_out_on', g.checked_out_on,
        'handlers', coalesce((select jsonb_agg(jsonb_build_object('name', m.full_name, 'seen', n.status = 'read') order by m.full_name)
          from public.notifications n join public.profiles m on m.id = n.user_id
          where n.kind = 'registration' and n.channel = 'in_app' and n.entity_id = r.id::text and m.role = 'manager'
            and n.created_at >= coalesce(r.submitted_at, r.signed_up_at)), '[]')) x
      from regs r
      left join lateral (select room_no, check_in, checked_out_on from public.register_guests rg
        where rg.customer_id = r.id order by rg.id desc limit 1) g on true
      order by coalesce(r.submitted_at, r.signed_up_at) desc
      limit least(greatest(coalesce(p_limit, 200), 1), 500)) s), '[]'))
  into res;
  return res;
end $$;

