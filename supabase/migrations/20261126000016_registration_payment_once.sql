-- Two quick clicks on "Pay" made two payment orders and both succeeded, so a guest who owed ₹13,000 paid ₹26,000.
-- Now an open order is reused instead of starting a second one, and a payment never credits more than is still owed:
-- an order for a registration that is already paid fails without moving money.

create or replace function public.start_my_registration_payment() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tenant_profiles; demo_on boolean; amt int; em text; pid uuid; open_id uuid;
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
  -- a payment already started (e.g. a second click) is reused, at what is owed now
  select id into open_id from public.registration_payments
  where customer_id = auth.uid() and status = 'created' and created_at > now() - interval '30 minutes'
  order by created_at desc limit 1 for update;
  if found then
    update public.registration_payments set amount = amt where id = open_id;
    return jsonb_build_object('id', open_id, 'amount', amt);
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

create or replace function public.demo_complete_my_registration_payment(p_id uuid, p_outcome text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare demo_on boolean; r public.registration_payments; t public.tenant_profiles; p public.profiles; owed int;
begin
  select (value #>> '{}')::boolean into demo_on from public.app_settings where key = 'demo_payments_enabled';
  if not coalesce(demo_on, false) then raise exception 'Demo payments are disabled'; end if;
  if p_outcome not in ('success', 'failure') then raise exception 'Bad outcome'; end if;
  -- lock the registration first so two completions run one after the other
  select * into t from public.tenant_profiles where user_id = auth.uid() for update;
  select * into r from public.registration_payments where id = p_id and customer_id = auth.uid() and provider = 'demo' for update;
  if not found then raise exception 'Payment not found'; end if;
  if r.status = 'created' then
    owed := case when t.registration_state = 'pending' and t.payment_mode = 'online' then public.registration_balance(t) else 0 end;
    if p_outcome = 'success' and owed <= 0 then
      update public.registration_payments set status = 'failed', completed_at = now() where id = p_id returning * into r;
      return jsonb_build_object('id', r.id, 'status', r.status, 'amount', r.amount, 'is_simulated', r.is_simulated, 'note', 'Nothing left to pay');
    end if;
    update public.registration_payments set status = case p_outcome when 'success' then 'succeeded' else 'failed' end,
      amount = case p_outcome when 'success' then least(amount, owed) else amount end,
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
