-- Registration payment through Razorpay. Until now only the demo provider could take it, so with demo payments off
-- residents saw "Online payment is not available yet". Both functions are for the Edge Functions only (service role):
-- razorpay-registration-order starts the payment, razorpay-verify / razorpay-webhook settle it.

alter table public.registration_payments drop constraint registration_payments_provider_check;
alter table public.registration_payments add constraint registration_payments_provider_check check (provider in ('demo', 'razorpay'));
alter table public.registration_payments add column provider_order_id text;
create unique index registration_payments_order_idx on public.registration_payments (provider_order_id) where provider_order_id is not null;

-- Starts (or reuses) a Razorpay payment for what p_user still owes. Returns the row's id, amount and Razorpay order id
-- (null until the Edge Function has made the order). A Razorpay order's amount cannot change, so an open payment is
-- reused only when the amount owed is the same.
create function public.razorpay_start_registration_payment(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tenant_profiles; amt int; em text; r public.registration_payments;
begin
  select * into t from public.tenant_profiles where user_id = p_user for update;
  if not found or t.registration_state is distinct from 'pending' or t.stay_type is null then
    raise exception 'Send your registration form first';
  end if;
  if t.payment_mode <> 'online' then raise exception 'Your manager is taking this payment offline'; end if;
  amt := public.registration_balance(t);
  if amt <= 0 then raise exception 'Nothing left to pay'; end if;
  select * into r from public.registration_payments
  where customer_id = p_user and provider = 'razorpay' and status = 'created' and amount = amt
    and created_at > now() - interval '30 minutes'
  order by created_at desc limit 1;
  if found then return jsonb_build_object('id', r.id, 'amount', r.amount, 'order_id', r.provider_order_id); end if;
  if (select count(*) from public.registration_payments where customer_id = p_user and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many payment attempts. Try again in an hour.';
  end if;
  select email into em from auth.users where id = p_user;
  insert into public.registration_payments (email, phone, property_id, amount, provider, is_simulated, customer_id, claimed_at)
  values (lower(coalesce(em, 'unknown@invalid')), '', t.property_id, amt, 'razorpay', false, p_user, now())
  returning * into r;
  return jsonb_build_object('id', r.id, 'amount', r.amount, 'order_id', null);
end $$;

-- Razorpay confirmed the money. Idempotent (verify and webhook may both call it). Credits at most what is still owed;
-- anything over that is real money already taken, so the managers are told to refund it.
create function public.apply_registration_payment(p_id uuid, p_provider_payment_id text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid; r public.registration_payments; t public.tenant_profiles; p public.profiles; owed int; credit int;
begin
  select customer_id into uid from public.registration_payments where id = p_id and provider = 'razorpay';
  if uid is null then raise exception 'Payment not found'; end if;
  -- lock the registration first, same order as the demo path
  select * into t from public.tenant_profiles where user_id = uid for update;
  select * into r from public.registration_payments where id = p_id for update;
  if r.status <> 'created' then return r.status; end if;
  owed := case when t.user_id is not null and t.registration_state = 'pending' and t.payment_mode = 'online' then public.registration_balance(t) else 0 end;
  credit := least(r.amount, coalesce(owed, 0));
  update public.registration_payments set status = 'succeeded', provider_payment_id = p_provider_payment_id, completed_at = now()
  where id = p_id;
  select * into p from public.profiles where id = uid;
  if credit > 0 then
    update public.tenant_profiles set amount_paid = amount_paid + credit where user_id = uid returning * into t;
    update public.tenant_profiles set payment_status = case when public.registration_balance(t) = 0 then 'paid' else 'partially_paid' end
    where user_id = uid returning * into t;
    perform public.registration_managers_notify(uid, t.property_id, 'Registration paid',
      coalesce(p.full_name, 'A new resident') || ' paid ₹' || credit || ' online for room ' || coalesce(t.room_no, '') || '. Ready to approve.',
      'registration-paid:' || r.id);
  end if;
  if r.amount > credit then
    perform public.registration_managers_notify(uid, coalesce(t.property_id, r.property_id), 'Refund needed',
      coalesce(p.full_name, 'A resident') || ' paid ₹' || (r.amount - credit) || ' more than was owed (Razorpay ' || p_provider_payment_id
        || '). Refund it from the Razorpay dashboard.',
      'registration-overpaid:' || r.id);
  end if;
  return 'succeeded';
end $$;

revoke all on function public.razorpay_start_registration_payment(uuid), public.apply_registration_payment(uuid, text)
  from public, anon, authenticated;
grant execute on function public.razorpay_start_registration_payment(uuid), public.apply_registration_payment(uuid, text) to service_role;
