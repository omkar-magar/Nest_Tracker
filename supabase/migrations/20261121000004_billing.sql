-- PRD 4 (rent and payments) and PRD 3.3 (check-in / check-out / transfer).
-- Bills become invoices made of lines (rent, charges, late fee, discount, adjustment). A bill's amount is
-- the sum of its lines; amount_paid grows with each payment, so part payments work. Overdue and
-- "partially paid" are derived (status stays unpaid / paid / void, so existing queries keep working).

-- ---------------------------------------------------------------- settings
insert into public.app_settings (key, value) values
  ('rent_cycle', '"fixed"'::jsonb),                 -- fixed: due on rent_due_day each month; checkin: monthly from the check-in date
  ('rent_due_day', '1'::jsonb),
  ('invoice_lead_days', '3'::jsonb),                -- create next month's invoice this many days before it is due
  ('late_fee', '{"mode":"per_day","amount":50,"percent":2,"grace_days":5,"cap":1500}'::jsonb),
  ('reminder_schedule', '{"before":[3],"on_due":true,"after":[2],"weekly_after":true,"channels":["in_app","push","sms","whatsapp","email"],"copy_guardian":true}'::jsonb),
  ('site_url', '"https://yolonest.in"'::jsonb),
  ('risk_late_count', '3'::jsonb)                   -- late payments in 12 months that flag a repeat defaulter
on conflict (key) do nothing;

create function public.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = p_key
$$;
grant execute on function public.setting(text) to authenticated, service_role;

-- owner edits settings (the RLS migration gave app_settings no write path)
create function public.admin_set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Owner only' using errcode = '42501'; end if;
  insert into public.app_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
  perform public.log_activity('setting.changed', 'setting', p_key, jsonb_build_object('value', p_value));
end $$;

-- ---------------------------------------------------------------- invoices
create sequence public.invoice_no_seq;
create sequence public.receipt_no_seq;

alter table public.bills
  add column amount_paid  int not null default 0 check (amount_paid >= 0),
  add column period_start date,
  add column period_end   date,
  add column invoice_no   text unique default ('INV-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.invoice_no_seq')::text, 5, '0')),
  add column notes        text not null default '';
alter table public.bills drop constraint bills_amount_check;
alter table public.bills add constraint bills_amount_check check (amount >= 0);
alter table public.bills drop constraint bills_kind_check;
alter table public.bills add constraint bills_kind_check check (kind in ('deposit', 'rent', 'charges', 'final'));
create index bills_booking_period_idx on public.bills (booking_id, kind, period_start);

create table public.bill_lines (
  id          bigint generated always as identity primary key,
  bill_id     uuid not null references public.bills (id) on delete cascade,
  kind        text not null check (kind in ('rent', 'deposit', 'electricity', 'ac', 'laundry', 'food', 'parking', 'maintenance',
                                            'wifi', 'fine', 'damage', 'notice_shortfall', 'late_fee', 'discount',
                                            'adjustment', 'other')),
  description text not null,
  amount      int not null,                       -- negative for discounts / credits
  meta        jsonb not null default '{}',        -- meter readings, offer code, auto flags
  reason      text not null default '',           -- required for manual adjustments (audit)
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index bill_lines_bill_idx on public.bill_lines (bill_id);

-- every existing bill gets one line so lines are the single source of an invoice's amount
insert into public.bill_lines (bill_id, kind, description, amount)
select id, kind, description, amount from public.bills;
update public.bills b set amount_paid = b.amount where b.status = 'paid';
update public.bills b set period_start = b.due_date, period_end = (b.due_date + interval '1 month' - interval '1 day')::date
from public.bookings bk where bk.id = b.booking_id and b.kind = 'rent' and bk.billing_period = 'month' and b.period_start is null;

-- bills written the old way (amount only, e.g. book_room) get their first line automatically
create function public.bill_seed_line() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.amount > 0 and not exists (select 1 from public.bill_lines where bill_id = new.id) then
    insert into public.bill_lines (bill_id, kind, description, amount)
    values (new.id, case when new.kind in ('rent', 'deposit') then new.kind else 'other' end, new.description, new.amount);
  end if;
  return null;
end $$;
create trigger bills_seed_line after insert on public.bills for each row execute function public.bill_seed_line();

-- credit ledger: advance payments, overpayments, unused rent at check-out, referral rewards (+), uses (-)
create table public.tenant_credits (
  id          bigint generated always as identity primary key,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  booking_id  uuid references public.bookings (id) on delete set null,
  amount      int not null check (amount <> 0),
  reason      text not null,
  mode        text,
  reference   text,
  payment_id  uuid,
  bill_id     uuid references public.bills (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index tenant_credits_customer_idx on public.tenant_credits (customer_id);

create function public.credit_balance(p_customer uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from public.tenant_credits where customer_id = p_customer
$$;

-- recompute the invoice from its lines. A paid invoice that grows becomes unpaid again;
-- one that shrinks below what was paid moves the surplus to the tenant's credit.
create function public.bill_recalc(p_bill uuid) returns void
language plpgsql security definer set search_path = public as $$
declare bl public.bills%rowtype; total int; surplus int;
begin
  select * into bl from public.bills where id = p_bill for update;
  if not found or bl.status = 'void' then return; end if;
  select coalesce(sum(amount), 0) into total from public.bill_lines where bill_id = p_bill;
  if total < 0 then raise exception 'Discounts cannot exceed the invoice total'; end if;
  surplus := bl.amount_paid - total;
  if surplus > 0 then
    insert into public.tenant_credits (customer_id, booking_id, amount, reason, bill_id)
    values (bl.customer_id, bl.booking_id, surplus, 'Overpaid ' || coalesce(bl.invoice_no, ''), bl.id);
  end if;
  update public.bills set amount = total, amount_paid = least(amount_paid, total),
    status = case when least(amount_paid, total) >= total then 'paid' else 'unpaid' end,
    paid_at = case when least(amount_paid, total) >= total then coalesce(paid_at, now()) else null end
  where id = p_bill;
end $$;

create function public.bill_lines_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.bill_recalc(coalesce(new.bill_id, old.bill_id));
  return null;
end $$;
create trigger bill_lines_recalc after insert or update or delete on public.bill_lines
  for each row execute function public.bill_lines_changed();

-- outstanding = amount - amount_paid, and the label the UI shows
create function public.bill_state(b public.bills) returns text
language sql stable as $$
  select case
    when b.status = 'void' then 'void'
    when b.status = 'paid' then 'paid'
    when b.due_date < current_date then 'overdue'
    when b.amount_paid > 0 then 'partially_paid'
    else 'pending' end
$$;
grant execute on function public.bill_state(public.bills) to authenticated, service_role;

-- ---------------------------------------------------------------- payments
drop index public.payments_one_success_per_bill;   -- part payments: many succeeded payments per bill
alter table public.payments drop constraint payments_provider_check;
alter table public.payments add constraint payments_provider_check
  check (provider in ('demo', 'razorpay', 'cash', 'bank_transfer', 'cheque', 'upi', 'credit', 'deposit'));
alter table public.payments
  add column reference   text,
  add column proof_path  text,                 -- customer-documents bucket
  add column paid_on     date,
  add column notes       text not null default '',
  add column recorded_by uuid references public.profiles (id) on delete set null,
  add column receipt_no  text unique;

create table public.security_deposits (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null unique references public.bookings (id) on delete cascade,
  customer_id      uuid not null references public.profiles (id) on delete cascade,
  property_id      text references public.properties (id),
  amount           int not null check (amount >= 0),         -- agreed deposit
  received_amount  int not null default 0 check (received_amount >= 0),
  received_on      date,
  mode             text,
  reference        text,
  status           text not null default 'pending'
                     check (status in ('pending', 'held', 'partially_refunded', 'refunded', 'adjusted')),
  deductions       jsonb not null default '[]',              -- [{ "description": "...", "amount": 500 }]
  refund_amount    int not null default 0,
  refunded_on      date,
  refund_mode      text,
  refund_reference text,
  notes            text not null default '',
  created_at       timestamptz not null default now()
);
create index security_deposits_property_idx on public.security_deposits (property_id, status);
insert into public.security_deposits (booking_id, customer_id, property_id, amount, received_amount, received_on, status)
select b.id, b.customer_id, b.property_id, b.deposit,
       coalesce((select sum(amount_paid) from public.bills where booking_id = b.id and kind = 'deposit'), 0),
       (select max(paid_at)::date from public.bills where booking_id = b.id and kind = 'deposit'),
       case when exists (select 1 from public.bills where booking_id = b.id and kind = 'deposit' and status = 'paid') then 'held' else 'pending' end
from public.bookings b where b.deposit > 0 and b.status in ('pending', 'active');

-- The single place where money lands on an invoice. Idempotent (a replayed webhook returns the stored status).
-- Only the part still owed is applied; any surplus (or money for an already-settled bill) becomes credit.
create or replace function public.apply_payment_result(p_payment_id uuid, p_status text,
                                                       p_provider_payment_id text default null,
                                                       p_failure_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare pay public.payments%rowtype; bl public.bills%rowtype; bk public.bookings%rowtype; applied int; extra int;
  vars jsonb; t record;
begin
  if p_status not in ('succeeded', 'failed') then raise exception 'Bad status'; end if;
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if pay.status <> 'created' then return pay.status; end if;

  if p_status = 'failed' then
    update public.payments set status = 'failed', failure_reason = coalesce(p_failure_reason, 'Payment failed'),
           completed_at = now() where id = pay.id;
    return 'failed';
  end if;

  select * into bl from public.bills where id = pay.bill_id for update;
  applied := case when bl.status = 'unpaid' then least(pay.amount, bl.amount - bl.amount_paid) else 0 end;
  extra := pay.amount - applied;

  update public.payments set status = 'succeeded', provider_payment_id = p_provider_payment_id, completed_at = now(),
         paid_on = coalesce(paid_on, current_date),
         receipt_no = 'RCPT-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.receipt_no_seq')::text, 5, '0')
  where id = pay.id;
  if applied > 0 then
    update public.bills set amount_paid = amount_paid + applied,
      status = case when amount_paid + applied >= amount then 'paid' else 'unpaid' end,
      paid_at = case when amount_paid + applied >= amount then now() else paid_at end
    where id = bl.id;
  end if;
  if extra > 0 and pay.provider not in ('credit', 'deposit') then
    insert into public.tenant_credits (customer_id, booking_id, amount, reason, payment_id, bill_id)
    values (pay.customer_id, bl.booking_id, extra, 'Paid in advance', pay.id, bl.id);
  end if;

  select * into bk from public.bookings where id = bl.booking_id for update;
  -- an online booking goes live once everything billed so far is paid
  if bk.status = 'pending' and not exists (select 1 from public.bills where booking_id = bk.id and status = 'unpaid') then
    update public.bookings set status = 'active', hold_expires_at = null where id = bk.id;
  end if;

  if bl.kind = 'deposit' then
    update public.security_deposits set received_amount = received_amount + applied, received_on = current_date,
      mode = coalesce(mode, pay.provider), status = 'held'
    where booking_id = bl.booking_id;
  end if;

  if pay.provider not in ('credit', 'deposit') then
    vars := jsonb_build_object('name', (select full_name from public.profiles where id = pay.customer_id),
      'amount', pay.amount, 'description', bl.description,
      'link', coalesce(public.setting('site_url') #>> '{}', '') || '/account?receipt=' || pay.id);
    select * into t from public.render_template('payment_receipt', vars);
    perform public.notify(pay.customer_id, array['in_app', 'email'], 'receipt', t.subject, t.body,
                          '/account?receipt=' || pay.id, 'receipt:' || pay.id, 'payment', pay.id::text);
  end if;
  perform public.log_activity('payment.succeeded', 'payment', pay.id::text,
                              jsonb_build_object('provider', pay.provider, 'amount', pay.amount, 'applied', applied));
  return 'succeeded';
end $$;
revoke all on function public.apply_payment_result(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_payment_result(uuid, text, text, text) to service_role;

-- online pay: amount defaults to everything still owed; a smaller amount is a part payment
drop function public.payment_create_order(uuid, text);
create function public.payment_create_order(p_bill_id uuid, p_provider text default 'demo', p_amount int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare bl public.bills%rowtype; pay_id uuid; demo_on boolean; due int;
begin
  select * into bl from public.bills where id = p_bill_id and customer_id = auth.uid();
  if not found then raise exception 'Bill not found'; end if;
  if bl.status <> 'unpaid' then raise exception 'This bill is not payable'; end if;
  due := bl.amount - bl.amount_paid;
  if p_amount is not null and (p_amount < 1 or p_amount > due) then raise exception 'Enter an amount between 1 and %', due; end if;
  if p_provider = 'demo' then
    select (value #>> '{}')::boolean into demo_on from public.app_settings where key = 'demo_payments_enabled';
    if not coalesce(demo_on, false) then raise exception 'Demo payments are disabled'; end if;
  else
    raise exception 'Unsupported payment provider';
  end if;
  insert into public.payments (bill_id, customer_id, amount, provider, is_simulated, provider_order_id)
  values (bl.id, bl.customer_id, coalesce(p_amount, due), p_provider, p_provider = 'demo', 'demo_order_' || gen_random_uuid())
  returning id into pay_id;
  return pay_id;
end $$;

-- PRD 4.3 manual entry: cash / bank transfer / cheque / UPI outside the gateway, with reference and proof
create function public.record_manual_payment(p_bill uuid, p_amount int, p_mode text, p_reference text default null,
                                             p_paid_on date default current_date, p_proof_path text default null,
                                             p_notes text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare bl public.bills%rowtype; pay_id uuid;
begin
  select * into bl from public.bills where id = p_bill;
  if not found then raise exception 'Bill not found'; end if;
  perform public.require_manage(public.booking_property(bl.booking_id));
  if bl.status <> 'unpaid' then raise exception 'This bill is not payable'; end if;
  if p_mode not in ('cash', 'bank_transfer', 'cheque', 'upi') then raise exception 'Choose cash, bank transfer, cheque or UPI'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'Enter the amount received'; end if;
  if p_mode <> 'cash' and coalesce(trim(p_reference), '') = '' then raise exception 'Enter the reference number'; end if;
  if p_paid_on > current_date then raise exception 'Payment date cannot be in the future'; end if;
  insert into public.payments (bill_id, customer_id, amount, provider, is_simulated, reference, proof_path, paid_on, notes, recorded_by)
  values (bl.id, bl.customer_id, p_amount, p_mode, false, nullif(trim(p_reference), ''), p_proof_path, p_paid_on, coalesce(p_notes, ''), auth.uid())
  returning id into pay_id;
  perform public.apply_payment_result(pay_id, 'succeeded', p_mode || '_' || pay_id);
  return pay_id;
end $$;

-- the original cash button keeps working: full outstanding amount in cash
create or replace function public.admin_record_cash_payment(p_bill_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare bl public.bills%rowtype;
begin
  select * into bl from public.bills where id = p_bill_id;
  if not found or bl.status <> 'unpaid' then raise exception 'This bill is not payable'; end if;
  perform public.record_manual_payment(p_bill_id, bl.amount - bl.amount_paid, 'cash');
  return 'succeeded';
end $$;

-- advance money received without an invoice (kept as credit, used by the next invoices)
create function public.record_advance(p_customer uuid, p_amount int, p_mode text, p_reference text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_see_user(p_customer) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'Enter the amount received'; end if;
  insert into public.tenant_credits (customer_id, booking_id, amount, reason, mode, reference, created_by)
  values (p_customer, (select id from public.bookings where customer_id = p_customer and status = 'active' limit 1),
          p_amount, 'Advance payment', p_mode, p_reference, auth.uid());
  perform public.log_activity('credit.advance', 'tenant', p_customer::text, jsonb_build_object('amount', p_amount, 'mode', p_mode));
end $$;

-- spend credit on an invoice (as a 'credit' payment so receipts and reports see it)
create function public.apply_credit(p_bill uuid) returns int
language plpgsql security definer set search_path = public as $$
declare bl public.bills%rowtype; bal int; use int; pay_id uuid;
begin
  select * into bl from public.bills where id = p_bill;
  if not found or bl.status <> 'unpaid' then return 0; end if;
  bal := public.credit_balance(bl.customer_id);
  use := least(bal, bl.amount - bl.amount_paid);
  if use <= 0 then return 0; end if;
  insert into public.payments (bill_id, customer_id, amount, provider, is_simulated, notes)
  values (bl.id, bl.customer_id, use, 'credit', false, 'Paid from credit balance') returning id into pay_id;
  insert into public.tenant_credits (customer_id, booking_id, amount, reason, payment_id, bill_id)
  values (bl.customer_id, bl.booking_id, -use, 'Used on ' || bl.invoice_no, pay_id, bl.id);
  perform public.apply_payment_result(pay_id, 'succeeded', 'credit_' || pay_id);
  return use;
end $$;

-- PRD 4.1 discounts / adjustments with reason and audit log; also extra charges (PRD 4.6)
create function public.add_bill_line(p_bill uuid, p_kind text, p_description text, p_amount int,
                                     p_reason text default '', p_meta jsonb default '{}')
returns bigint language plpgsql security definer set search_path = public as $$
declare bl public.bills%rowtype; lid bigint;
begin
  select * into bl from public.bills where id = p_bill;
  if not found then raise exception 'Bill not found'; end if;
  if auth.uid() is not null then perform public.require_manage(public.booking_property(bl.booking_id)); end if;
  if bl.status = 'void' then raise exception 'This bill is void'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'Enter an amount'; end if;
  if p_kind in ('discount', 'adjustment') and coalesce(trim(p_reason), '') = '' and auth.uid() is not null then
    raise exception 'Give a reason for the adjustment';
  end if;
  if p_kind = 'discount' and p_amount > 0 then p_amount := -p_amount; end if;
  insert into public.bill_lines (bill_id, kind, description, amount, reason, meta, created_by)
  values (p_bill, p_kind, coalesce(nullif(trim(p_description), ''), initcap(replace(p_kind, '_', ' '))), p_amount,
          coalesce(p_reason, ''), coalesce(p_meta, '{}'), auth.uid())
  returning id into lid;
  perform public.log_activity('bill.line_added', 'bill', p_bill::text,
    jsonb_build_object('kind', p_kind, 'amount', p_amount, 'reason', p_reason));
  return lid;
end $$;

create function public.remove_bill_line(p_line bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.bill_lines%rowtype;
begin
  select * into l from public.bill_lines where id = p_line;
  if not found then raise exception 'Line not found'; end if;
  perform public.require_manage(public.booking_property((select booking_id from public.bills where id = l.bill_id)));
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason'; end if;
  if l.kind = 'rent' then raise exception 'Rent lines cannot be removed; add an adjustment instead'; end if;
  delete from public.bill_lines where id = p_line;
  perform public.log_activity('bill.line_removed', 'bill', l.bill_id::text,
    jsonb_build_object('kind', l.kind, 'amount', l.amount, 'reason', p_reason));
end $$;

create function public.void_bill(p_bill uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare bl public.bills%rowtype;
begin
  select * into bl from public.bills where id = p_bill for update;
  if not found then raise exception 'Bill not found'; end if;
  perform public.require_manage(public.booking_property(bl.booking_id));
  if bl.status <> 'unpaid' then raise exception 'Only unpaid bills can be voided'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason'; end if;
  if bl.amount_paid > 0 then
    insert into public.tenant_credits (customer_id, booking_id, amount, reason, bill_id)
    values (bl.customer_id, bl.booking_id, bl.amount_paid, 'Refund of voided ' || bl.invoice_no, bl.id);
  end if;
  update public.bills set status = 'void', notes = notes || ' Voided: ' || p_reason where id = p_bill;
  perform public.log_activity('bill.voided', 'bill', p_bill::text, jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------- rent periods and generation
-- The billing period that starts on p_start: fixed cycle ends the day before the next due day;
-- check-in cycle runs one month. Also returns the full cycle length for pro-rata.
create function public.rent_period(p_start date, p_checkin date, out period_end date, out cycle_days int)
language plpgsql stable security definer set search_path = public as $$
declare cyc text := coalesce(public.setting('rent_cycle') #>> '{}', 'fixed');
  d int := least(greatest(coalesce((public.setting('rent_due_day') #>> '{}')::int, 1), 1), 28);
  next_due date; prev_due date;
begin
  if cyc = 'checkin' then
    -- cycle anchored on the check-in day of month
    period_end := (p_start + interval '1 month' - interval '1 day')::date;
    cycle_days := period_end - p_start + 1;
    return;
  end if;
  next_due := make_date(extract(year from p_start)::int, extract(month from p_start)::int, d);
  if next_due <= p_start then next_due := (next_due + interval '1 month')::date; end if;
  prev_due := (next_due - interval '1 month')::date;
  period_end := next_due - 1;
  cycle_days := next_due - prev_due;
end $$;

-- monthly rent units: beds held (bed basis) or 1 (whole room)
create function public.booking_units(p_booking uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when r.rent_basis = 'room' then 1 else greatest((select count(*) from public.booking_beds bb
              where bb.booking_id = b.id and bb.active), 1)::int end
  from public.bookings b join public.rooms r on r.id = b.room_id where b.id = p_booking
$$;

create table public.recurring_charges (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  kind        text not null check (kind in ('electricity', 'ac', 'laundry', 'food', 'parking', 'maintenance', 'wifi', 'other')),
  description text not null,
  amount      int not null check (amount > 0),
  active      boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Creates every monthly invoice that should exist for one stay up to p_until (idempotent).
create function public.generate_invoices_for_booking(p_booking uuid, p_until date default null) returns int
language plpgsql security definer set search_path = public as $$
declare b public.bookings%rowtype; last_end date; s date; e date; cyc int; full_rent int; rent int; bid uuid;
  made int := 0; units int; lead int := coalesce((public.setting('invoice_lead_days') #>> '{}')::int, 3); rc record;
  stop_at date; first boolean;
begin
  select * into b from public.bookings where id = p_booking;
  if not found or b.status <> 'active' or b.billing_period <> 'month' then return 0; end if;
  units := public.booking_units(b.id);
  stop_at := coalesce(b.actual_checkout, b.expected_checkout);
  loop
    select max(period_end) into last_end from public.bills
    where booking_id = b.id and kind = 'rent' and status <> 'void' and period_end is not null;
    first := last_end is null;
    s := coalesce(last_end + 1, b.check_in);
    exit when s > coalesce(p_until, current_date + lead) or (stop_at is not null and s >= stop_at) or made >= 12;
    select r.period_end, r.cycle_days into e, cyc from public.rent_period(s, b.check_in) r;
    if stop_at is not null and e >= stop_at then e := stop_at - 1; end if;
    full_rent := b.rate * units;
    rent := case when e - s + 1 >= cyc then full_rent else round(full_rent::numeric * (e - s + 1) / cyc)::int end;

    insert into public.bills (booking_id, customer_id, kind, description, amount, due_date, period_start, period_end)
    values (b.id, b.customer_id, 'rent', 'Rent ' || to_char(s, 'DD Mon') || ' - ' || to_char(e, 'DD Mon YYYY'), 0, s, s, e)
    returning id into bid;
    insert into public.bill_lines (bill_id, kind, description, amount, meta)
    values (bid, 'rent',
            case when rent = full_rent then 'Monthly rent' else 'Rent for ' || (e - s + 1) || ' of ' || cyc || ' days (pro-rata)' end,
            rent, jsonb_build_object('days', e - s + 1, 'cycle_days', cyc, 'rate', b.rate, 'units', units));
    for rc in select * from public.recurring_charges where booking_id = b.id and active loop
      insert into public.bill_lines (bill_id, kind, description, amount, meta)
      values (bid, rc.kind, rc.description, rc.amount, jsonb_build_object('recurring', rc.id));
    end loop;
    if first and b.offer_code is not null then perform public.apply_offer_to_bill(bid, b.offer_code); end if;
    perform public.apply_credit(bid);
    made := made + 1;
  end loop;
  return made;
end $$;

-- placeholder replaced by the sales migration (offers live there)
create function public.apply_offer_to_bill(p_bill uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$ begin return; end $$;

create function public.generate_monthly_invoices() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; b uuid;
begin
  if auth.uid() is not null and not public.is_manager_or_owner() then raise exception 'Not allowed' using errcode = '42501'; end if;
  for b in select id from public.bookings where status = 'active' and billing_period = 'month'
           and (auth.uid() is null or public.can_manage_property(property_id)) loop
    n := n + public.generate_invoices_for_booking(b);
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- charges (PRD 4.6)
-- Adds a charge (or credit) line to the stay's open invoice for the current period, else to a new charges invoice.
create function public.add_charge(p_booking uuid, p_kind text, p_description text, p_amount int, p_meta jsonb default '{}',
                                  p_reason text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings%rowtype; bid uuid; open_due int;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Stay not found'; end if;
  select id, amount - amount_paid into bid, open_due from public.bills
  where booking_id = b.id and status = 'unpaid' and kind in ('rent', 'charges')
    and coalesce(period_end, due_date) >= date_trunc('month', current_date)::date
  order by due_date desc limit 1;
  if p_amount < 0 and (bid is null or open_due + p_amount < 0) then
    insert into public.tenant_credits (customer_id, booking_id, amount, reason, created_by)
    values (b.customer_id, b.id, -p_amount, p_description, auth.uid());
    return null;
  end if;
  if bid is null then
    insert into public.bills (booking_id, customer_id, kind, description, amount, due_date)
    values (b.id, b.customer_id, 'charges', 'Charges ' || to_char(current_date, 'Mon YYYY'), 0, current_date + 7)
    returning id into bid;
  end if;
  insert into public.bill_lines (bill_id, kind, description, amount, meta, reason, created_by)
  values (bid, p_kind, p_description, p_amount, coalesce(p_meta, '{}'), coalesce(p_reason, ''), auth.uid());
  return bid;
end $$;

create function public.staff_add_charge(p_booking uuid, p_kind text, p_description text, p_amount int, p_recurring boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  perform public.require_manage(public.booking_property(p_booking));
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero'; end if;
  if p_kind not in ('electricity', 'ac', 'laundry', 'food', 'parking', 'maintenance', 'wifi', 'fine', 'damage', 'other') then
    raise exception 'Unknown charge type';
  end if;
  if p_recurring then
    if p_kind in ('fine', 'damage') then raise exception 'Fines and damages cannot be recurring'; end if;
    insert into public.recurring_charges (booking_id, kind, description, amount, created_by)
    values (p_booking, p_kind, p_description, p_amount, auth.uid());
  end if;
  bid := public.add_charge(p_booking, p_kind, p_description, p_amount);
  perform public.log_activity('bill.charge', 'booking', p_booking::text,
    jsonb_build_object('kind', p_kind, 'amount', p_amount, 'recurring', p_recurring));
  return bid;
end $$;

create table public.meter_readings (
  id          uuid primary key default gen_random_uuid(),
  room_id     text not null references public.rooms (id) on delete cascade,
  month       date not null,                   -- first day of the month billed
  mode        text not null check (mode in ('fixed', 'split', 'meter')),
  prev_reading numeric,
  curr_reading numeric,
  unit_rate   numeric,
  units       numeric,
  amount      int not null check (amount >= 0),
  shares      jsonb not null default '[]',     -- [{ booking_id, name, amount }]
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (room_id, month)
);

-- PRD 4.6 electricity: fixed per tenant, split equally among the room's occupants (by beds), or sub-meter
create function public.add_electricity(p_room text, p_month date, p_mode text, p_amount int default null,
                                       p_prev numeric default null, p_curr numeric default null, p_rate numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare total int; units_used numeric; occ record; n_units int; share int; shares jsonb := '[]'; rest int; i int := 0; cnt int;
  m date := date_trunc('month', p_month)::date; label text;
begin
  perform public.require_manage((select property_id from public.rooms where id = p_room));
  if p_mode not in ('fixed', 'split', 'meter') then raise exception 'Choose fixed, split or meter'; end if;
  if p_mode = 'meter' then
    if p_prev is null or p_curr is null or p_rate is null then raise exception 'Enter previous and current reading and unit rate'; end if;
    if p_curr < p_prev then raise exception 'Current reading is lower than the previous reading'; end if;
    if p_rate <= 0 then raise exception 'Unit rate must be above zero'; end if;
    units_used := p_curr - p_prev;
    total := round(units_used * p_rate)::int;
  else
    if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero'; end if;
    total := p_amount;
  end if;
  select count(*), coalesce(sum(public.booking_units(b.id)), 0) into cnt, n_units
  from public.bookings b where b.room_id = p_room and b.status = 'active';
  if cnt = 0 then raise exception 'Nobody is staying in this room'; end if;
  label := 'Electricity ' || to_char(m, 'Mon YYYY');
  rest := case when p_mode = 'fixed' then 0 else total end;
  for occ in select b.id, b.customer_id, public.booking_units(b.id) u, p.full_name
             from public.bookings b join public.profiles p on p.id = b.customer_id
             where b.room_id = p_room and b.status = 'active' order by b.check_in, b.id loop
    i := i + 1;
    if p_mode = 'fixed' then share := total;
    elsif i = cnt then share := rest;                                   -- last share absorbs rounding
    else share := round(total::numeric * occ.u / n_units)::int; end if;
    rest := rest - case when p_mode = 'fixed' then 0 else share end;
    if share > 0 then
      perform public.add_charge(occ.id, 'electricity',
        label || case p_mode when 'meter' then ' (' || units_used || ' units x Rs ' || p_rate || ', shared)'
                             when 'split' then ' (shared equally)' else '' end,
        share, jsonb_build_object('month', m, 'mode', p_mode, 'prev', p_prev, 'curr', p_curr, 'rate', p_rate));
    end if;
    shares := shares || jsonb_build_object('booking_id', occ.id, 'name', occ.full_name, 'amount', share);
  end loop;
  insert into public.meter_readings (room_id, month, mode, prev_reading, curr_reading, unit_rate, units, amount, shares, created_by)
  values (p_room, m, p_mode, p_prev, p_curr, p_rate, units_used, case when p_mode = 'fixed' then total * cnt else total end, shares, auth.uid());
  perform public.log_activity('bill.electricity', 'room', p_room, jsonb_build_object('month', m, 'total', total, 'mode', p_mode));
  return shares;
end $$;

-- ---------------------------------------------------------------- late fees (PRD 4.5)
create function public.apply_late_fees() returns int
language plpgsql security definer set search_path = public as $$
declare cfg jsonb := coalesce(public.setting('late_fee'), '{}'); mode text := coalesce(cfg ->> 'mode', 'none');
  grace int := coalesce((cfg ->> 'grace_days')::int, 0); cap int := nullif((cfg ->> 'cap')::int, 0); r record; fee int; n int := 0;
  base int;
begin
  if mode = 'none' then return 0; end if;
  for r in select b.* from public.bills b where b.status = 'unpaid' and b.kind in ('rent', 'charges', 'final')
           and b.due_date + grace < current_date loop
    select coalesce(sum(amount), 0) into base from public.bill_lines where bill_id = r.id and kind <> 'late_fee';
    fee := case mode
      when 'per_day' then coalesce((cfg ->> 'amount')::int, 0) * (current_date - r.due_date - grace)
      when 'percent' then round(base * coalesce((cfg ->> 'percent')::numeric, 0) / 100)::int
      else 0 end;
    if cap is not null then fee := least(fee, cap); end if;
    continue when fee <= 0;
    if exists (select 1 from public.bill_lines where bill_id = r.id and kind = 'late_fee' and meta ? 'auto') then
      update public.bill_lines set amount = fee,
        description = 'Late fee (' || (current_date - r.due_date) || ' days late)'
      where bill_id = r.id and kind = 'late_fee' and meta ? 'auto' and amount <> fee;
    else
      insert into public.bill_lines (bill_id, kind, description, amount, meta)
      values (r.id, 'late_fee', 'Late fee (' || (current_date - r.due_date) || ' days late)', fee, '{"auto":true}');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- repeat defaulter flag: invoices paid after due date + grace in the last 12 months, or 30+ days overdue now
create function public.refresh_risk_flags() returns void
language plpgsql security definer set search_path = public as $$
declare grace int := coalesce((public.setting('late_fee') ->> 'grace_days')::int, 0);
  lim int := coalesce((public.setting('risk_late_count') #>> '{}')::int, 3);
begin
  update public.tenant_profiles t set risk_flag = (
    (select count(*) from public.bills b where b.customer_id = t.user_id and b.kind = 'rent'
       and b.due_date > current_date - 365
       and ((b.status = 'paid' and b.paid_at::date > b.due_date + grace) or (b.status = 'unpaid' and b.due_date + grace < current_date))) >= lim
    or exists (select 1 from public.bills b where b.customer_id = t.user_id and b.status = 'unpaid' and b.due_date < current_date - 30));
end $$;

-- ---------------------------------------------------------------- reminders (PRD 4.2)
create function public.send_bill_reminder(p_bill uuid, p_manual boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare bl public.bills%rowtype; cfg jsonb := coalesce(public.setting('reminder_schedule'), '{}'); tpl text; vars jsonb; t record;
  ch text[]; tp public.tenant_profiles%rowtype; link text; dk text; n int := 0;
begin
  select * into bl from public.bills where id = p_bill;
  if not found or bl.status <> 'unpaid' then raise exception 'Nothing to remind'; end if;
  if auth.uid() is not null then perform public.require_manage(public.booking_property(bl.booking_id)); end if;
  tpl := case when bl.due_date > current_date then 'rent_reminder_before' when bl.due_date = current_date then 'rent_reminder_due'
              else 'rent_reminder_overdue' end;
  link := coalesce(public.setting('site_url') #>> '{}', '') || '/account?pay=' || bl.id;
  vars := jsonb_build_object('name', (select full_name from public.profiles where id = bl.customer_id),
    'amount', bl.amount - bl.amount_paid, 'due_date', to_char(bl.due_date, 'DD Mon YYYY'), 'description', bl.description,
    'link', link, 'invoice', bl.invoice_no);
  select * into t from public.render_template(tpl, vars);
  ch := coalesce(array(select jsonb_array_elements_text(cfg -> 'channels')), array['in_app', 'email']);
  dk := case when p_manual then null else 'rent:' || bl.id || ':' || current_date end;
  perform public.notify(bl.customer_id, ch, 'rent_reminder', t.subject, t.body, '/account?pay=' || bl.id, dk, 'bill', bl.id::text);
  n := 1;
  select * into tp from public.tenant_profiles where user_id = bl.customer_id;
  if coalesce((cfg ->> 'copy_guardian')::boolean, false) and tp.guardian_consent_payments and tp.guardian_phone <> '' then
    perform public.notify(null, array['sms', 'whatsapp', 'email'] , 'rent_reminder', t.subject,
      'Copy for guardian: ' || t.body, null, case when dk is null then null else dk || ':guardian' end, 'bill', bl.id::text,
      tp.guardian_phone, nullif(tp.guardian_email, ''));
    n := 2;
  end if;
  if p_manual then perform public.log_activity('bill.reminder', 'bill', bl.id::text, '{}'); end if;
  return n;
end $$;

-- scheduled: N days before, on the due date, N days after, then weekly until paid
create function public.queue_rent_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare cfg jsonb := coalesce(public.setting('reminder_schedule'), '{}'); r record; d int; last_after int; n int := 0;
  before int[] := array(select jsonb_array_elements_text(coalesce(cfg -> 'before', '[]'))::int);
  after int[] := array(select jsonb_array_elements_text(coalesce(cfg -> 'after', '[]'))::int);
begin
  last_after := coalesce((select max(x) from unnest(after) x), 0);
  for r in select id, due_date from public.bills where status = 'unpaid' and kind in ('rent', 'charges', 'final') and amount > amount_paid loop
    d := current_date - r.due_date;
    if (d < 0 and -d = any (before)) or (d = 0 and coalesce((cfg ->> 'on_due')::boolean, true)) or (d > 0 and d = any (after))
       or (d > last_after and coalesce((cfg ->> 'weekly_after')::boolean, true) and (d - last_after) % 7 = 0) then
      perform public.send_bill_reminder(r.id, false);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- booking (online) respects reservations
create or replace function public.book_room(p_room_id text, p_bed_count int, p_check_in date, p_check_out date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); r public.rooms%rowtype; units int; bed_ids uuid[]; b_id uuid; rent_total int; deposit_total int;
  hold_min int; p_end date;
begin
  if uid is null or public.current_app_role() is distinct from 'customer' then
    raise exception 'Log in with a customer account to book' using errcode = '42501';
  end if;
  if p_check_in is null or p_check_in < current_date then raise exception 'Check-in date cannot be in the past'; end if;
  perform public.release_expired_holds();
  select * into r from public.rooms where id = p_room_id and is_active for update;
  if not found then raise exception 'Room not found'; end if;
  if r.billing_period = 'night' and (p_check_out is null or p_check_out <= p_check_in) then
    raise exception 'Choose a check-out date after check-in';
  end if;
  if r.rent_basis = 'room' then
    select array_agg(id) into bed_ids from public.beds where room_id = r.id and is_active;
    if bed_ids is null or exists (select 1 from public.beds where room_id = r.id and is_active
        and (is_occupied or is_reserved or status <> 'available')) then
      raise exception 'This room is not fully available';
    end if;
    units := 1;
  else
    if p_bed_count is null or p_bed_count < 1 or p_bed_count > 4 then raise exception 'Choose between 1 and 4 beds'; end if;
    select array_agg(id) into bed_ids from (
      select id from public.beds where room_id = r.id and is_active and not is_occupied and not is_reserved and status = 'available'
      order by label limit p_bed_count) s;
    if coalesce(array_length(bed_ids, 1), 0) < p_bed_count then
      raise exception 'Only % bed(s) left in this room', coalesce(array_length(bed_ids, 1), 0);
    end if;
    units := p_bed_count;
  end if;
  select (value #>> '{}')::int into hold_min from public.app_settings where key = 'hold_minutes';
  begin
    insert into public.bookings (customer_id, room_id, status, billing_period, rate, deposit, check_in, check_out, hold_expires_at)
    values (uid, r.id, 'pending', r.billing_period, r.price, r.deposit * units, p_check_in,
            case when r.billing_period = 'night' then p_check_out end, now() + make_interval(mins => coalesce(hold_min, 30)))
    returning id into b_id;
    insert into public.booking_beds (booking_id, bed_id) select b_id, unnest(bed_ids);
  exception when unique_violation then
    if exists (select 1 from public.bookings where customer_id = uid and status in ('pending', 'active')) then
      raise exception 'You already have a booking. Cancel it before booking another room.';
    end if;
    raise exception 'Sorry, one of those beds was just booked by someone else';
  end;
  rent_total := r.price * units * case when r.billing_period = 'night' then (p_check_out - p_check_in) else 1 end;
  deposit_total := r.deposit * units;
  if deposit_total > 0 then
    insert into public.bills (booking_id, customer_id, kind, description, amount, due_date)
    values (b_id, uid, 'deposit', 'Security deposit, room ' || r.room_no, deposit_total, current_date);
    insert into public.security_deposits (booking_id, customer_id, property_id, amount)
    values (b_id, uid, r.property_id, deposit_total);
  end if;
  p_end := case when r.billing_period = 'month' then (p_check_in + interval '1 month' - interval '1 day')::date else p_check_out - 1 end;
  insert into public.bills (booking_id, customer_id, kind, description, amount, due_date, period_start, period_end)
  values (b_id, uid, 'rent',
          case when r.billing_period = 'month' then 'First month rent, room ' || r.room_no
               else 'Stay in room ' || r.room_no || ', ' || (p_check_out - p_check_in) || ' night(s)' end,
          rent_total, current_date, p_check_in, p_end);
  perform public.log_activity('booking.created', 'booking', b_id::text, jsonb_build_object('room', r.id, 'units', units));
  return b_id;
end $$;

-- ---------------------------------------------------------------- check-in (PRD 3.3)
create function public.check_in_tenant(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare cust uuid := (p ->> 'customer_id')::uuid; v_beds uuid[] := array(select jsonb_array_elements_text(p -> 'bed_ids')::uuid);
  r public.rooms%rowtype; units int; bk uuid; v_rate int; dep int; cin date := coalesce(nullif(p ->> 'check_in', '')::date, current_date);
  cout date := nullif(p ->> 'check_out', '')::date; bad text; did uuid; nights int; resv uuid := nullif(p ->> 'reservation_id', '')::uuid;
begin
  if cust is null or coalesce(array_length(v_beds, 1), 0) = 0 then raise exception 'Choose a tenant and at least one bed'; end if;
  select r2.* into r from public.rooms r2 where r2.id = (select room_id from public.beds where id = v_beds[1]);
  perform public.require_manage(r.property_id);
  if exists (select 1 from public.beds where id = any (v_beds) and room_id <> r.id) then raise exception 'All beds must be in the same room'; end if;
  if (select role from public.profiles where id = cust) is distinct from 'customer' then raise exception 'Not a tenant account'; end if;
  if not public.tenant_profile_complete(cust) then raise exception 'Add the tenant''s emergency contact before check-in'; end if;
  if exists (select 1 from public.bookings where customer_id = cust and status in ('pending', 'active')) then
    raise exception 'This tenant already has a live stay. Transfer or check them out first.';
  end if;
  if r.rent_basis = 'room' and array_length(v_beds, 1) <> (select count(*) from public.beds where room_id = r.id and is_active) then
    raise exception 'This room is let as a whole: select every bed';
  end if;
  if r.billing_period = 'night' and (cout is null or cout <= cin) then raise exception 'Choose a check-out date after check-in'; end if;
  -- reservations on these beds: the tenant's own (or the one named) converts; anyone else's blocks
  update public.reservations set status = 'converted', closed_at = now(), customer_id = cust
  where bed_id = any (v_beds) and status = 'active' and (id = resv or customer_id = cust);
  select string_agg(code, ', ') into bad from public.beds
  where id = any (v_beds) and (is_occupied or is_reserved or status <> 'available' or not is_active);
  if bad is not null then raise exception 'Not vacant: %', bad; end if;

  units := case when r.rent_basis = 'room' then 1 else array_length(v_beds, 1) end;
  v_rate := coalesce(nullif(p ->> 'rent', '')::int,
                   case when r.rent_basis = 'bed' then (select max(coalesce(rent, r.price)) from public.beds where id = any (v_beds)) else r.price end);
  dep := coalesce(nullif(p ->> 'deposit', '')::int, r.deposit * units);
  if v_rate <= 0 or dep < 0 then raise exception 'Rent must be above zero and deposit zero or more'; end if;

  insert into public.bookings (customer_id, room_id, status, billing_period, rate, deposit, check_in, check_out, expected_checkout,
                               notice_period_days, lock_in_months, source, enquiry_id, offer_code, checked_in_by)
  values (cust, r.id, 'active', r.billing_period, v_rate, dep, cin, case when r.billing_period = 'night' then cout end,
          coalesce(nullif(p ->> 'expected_checkout', '')::date, cout),
          coalesce(nullif(p ->> 'notice_period_days', '')::int, 30), coalesce(nullif(p ->> 'lock_in_months', '')::int, 0),
          'office', nullif(p ->> 'enquiry_id', '')::uuid, nullif(upper(trim(p ->> 'offer_code')), ''), auth.uid())
  returning id into bk;
  insert into public.booking_beds (booking_id, bed_id) select bk, unnest(v_beds);

  if dep > 0 then
    insert into public.security_deposits (booking_id, customer_id, property_id, amount, received_amount, received_on, mode, reference, status)
    values (bk, cust, r.property_id, dep,
            case when (p ->> 'deposit_paid')::boolean then dep else 0 end,
            case when (p ->> 'deposit_paid')::boolean then cin end,
            case when (p ->> 'deposit_paid')::boolean then coalesce(p ->> 'deposit_mode', 'cash') end,
            p ->> 'deposit_reference',
            case when (p ->> 'deposit_paid')::boolean then 'held' else 'pending' end)
    returning id into did;
    if not coalesce((p ->> 'deposit_paid')::boolean, false) then
      insert into public.bills (booking_id, customer_id, kind, description, amount, due_date)
      values (bk, cust, 'deposit', 'Security deposit, room ' || r.room_no, dep, cin);
    end if;
  end if;

  if r.billing_period = 'night' then
    nights := cout - cin;
    insert into public.bills (booking_id, customer_id, kind, description, amount, due_date, period_start, period_end)
    values (bk, cust, 'rent', 'Stay in room ' || r.room_no || ', ' || nights || ' night(s)', v_rate * units * nights, cin, cin, cout - 1);
  else
    perform public.generate_invoices_for_booking(bk, greatest(cin, current_date));
  end if;

  update public.tenant_profiles set property_id = r.property_id, approval_status = 'approved',
    approved_by = coalesce(approved_by, auth.uid()), approved_at = coalesce(approved_at, now())
  where user_id = cust;

  if nullif(p ->> 'agreement_document_id', '') is not null or nullif(p ->> 'agreement_end', '') is not null then
    if nullif(p ->> 'agreement_document_id', '') is not null then
      perform public.record_agreement(bk, cin, coalesce(nullif(p ->> 'agreement_end', '')::date, (cin + interval '11 months')::date),
        coalesce(nullif(p ->> 'lock_in_months', '')::int, 0), coalesce(nullif(p ->> 'notice_period_days', '')::int, 30), v_rate, dep,
        coalesce(public.setting('house_rules') #>> '{}', ''), (p ->> 'agreement_document_id')::uuid);
    else
      perform public.generate_agreement(bk, (p ->> 'agreement_end')::date);
    end if;
  end if;
  perform public.log_activity('tenant.checked_in', 'booking', bk::text,
    jsonb_build_object('room', r.id, 'beds', array_length(v_beds, 1), 'rate', v_rate, 'deposit', dep));
  return bk;
end $$;

-- ---------------------------------------------------------------- transfer (PRD 3.3)
create function public.transfer_stay(p_booking uuid, p_to_beds uuid[], p_date date, p_new_rate int default null, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings%rowtype; r_to public.rooms%rowtype; old_beds text; new_beds text; bad text; old_units int; new_units int;
  v_rate int; cur public.bills%rowtype; remaining int; diff int; days int;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.status <> 'active' then raise exception 'Only an active stay can be transferred'; end if;
  perform public.require_manage(b.property_id);
  if coalesce(array_length(p_to_beds, 1), 0) = 0 then raise exception 'Choose the new bed(s)'; end if;
  select r2.* into r_to from public.rooms r2 where r2.id = (select room_id from public.beds where id = p_to_beds[1]);
  perform public.require_manage(r_to.property_id);
  if exists (select 1 from public.beds where id = any (p_to_beds) and room_id <> r_to.id) then raise exception 'All new beds must be in one room'; end if;
  select string_agg(code, ', ') into bad from public.beds where id = any (p_to_beds)
    and (is_occupied or is_reserved or status <> 'available' or not is_active)
    and id not in (select bed_id from public.booking_beds where booking_id = b.id and active);
  if bad is not null then raise exception 'Not vacant: %', bad; end if;
  if p_date is null or p_date < b.check_in then raise exception 'Transfer date must be after check-in'; end if;

  old_units := public.booking_units(b.id);
  select string_agg(be.code, ', ') into old_beds from public.booking_beds bb join public.beds be on be.id = bb.bed_id
  where bb.booking_id = b.id and bb.active;
  update public.booking_beds set active = false where booking_id = b.id and active;
  insert into public.booking_beds (booking_id, bed_id) select b.id, unnest(p_to_beds)
  on conflict (booking_id, bed_id) do update set active = true;
  select string_agg(code, ', ') into new_beds from public.beds where id = any (p_to_beds);
  v_rate := coalesce(p_new_rate, case when r_to.rent_basis = 'bed'
                    then (select max(coalesce(rent, r_to.price)) from public.beds where id = any (p_to_beds)) else r_to.price end);
  update public.bookings set room_id = r_to.id, rate = v_rate where id = b.id;
  new_units := public.booking_units(b.id);
  insert into public.stay_transfers (booking_id, from_room_id, to_room_id, from_beds, to_beds, old_rate, new_rate, transfer_date, reason, created_by)
  values (b.id, b.room_id, r_to.id, coalesce(old_beds, ''), new_beds, b.rate, v_rate, p_date, coalesce(p_reason, ''), auth.uid());
  insert into public.rent_changes (room_id, booking_id, old_rent, new_rent, effective_from, reason, changed_by)
  values (r_to.id, b.id, b.rate * old_units, v_rate * new_units, p_date, 'Transfer: ' || coalesce(p_reason, ''), auth.uid());

  -- difference for the rest of the current period
  select * into cur from public.bills where booking_id = b.id and kind = 'rent' and status <> 'void'
    and p_date between period_start and period_end order by period_start desc limit 1;
  if found and b.billing_period = 'month' then
    remaining := cur.period_end - p_date + 1;
    days := cur.period_end - cur.period_start + 1;
    diff := round(((v_rate * new_units) - (b.rate * old_units))::numeric * remaining
                  / greatest((select (meta ->> 'cycle_days')::int from public.bill_lines where bill_id = cur.id and kind = 'rent' limit 1), days))::int;
    if diff <> 0 then
      perform public.add_charge(b.id, 'adjustment', 'Rent difference after room change (' || remaining || ' days)', diff, '{}', 'Transfer');
    end if;
  end if;
  perform public.log_activity('booking.transferred', 'booking', b.id::text,
    jsonb_build_object('from', old_beds, 'to', new_beds, 'rate', v_rate));
end $$;

-- ---------------------------------------------------------------- check-out (PRD 3.3, 4.4)
-- Final bill = pending dues + extras (electricity, damages) + notice shortfall - unused rent; minus deposit = refund / payable.
create function public.checkout_quote(p_booking uuid, p_date date, p_extras jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.bookings%rowtype; units int; pending int; cur public.bills%rowtype; used int; credit int := 0; rentline int;
  cyc int; notice_given int; shortfall int; notice_charge int; extras int; dep public.security_deposits%rowtype; held int;
  future_paid int; future_unpaid int; bal int; total int; lock_end date;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Stay not found'; end if;
  perform public.require_manage(b.property_id);
  if p_date is null or p_date < b.check_in then raise exception 'Check-out date must be on or after check-in'; end if;
  units := public.booking_units(b.id);

  -- rent bills that start after the check-out date are not owed
  select coalesce(sum(amount_paid), 0), coalesce(sum(amount - amount_paid) filter (where status = 'unpaid'), 0)
    into future_paid, future_unpaid
  from public.bills where booking_id = b.id and kind = 'rent' and status <> 'void' and period_start >= p_date;

  pending := coalesce((select sum(amount - amount_paid) from public.bills where booking_id = b.id and status = 'unpaid'
                       and not (kind = 'rent' and period_start >= p_date)), 0);

  -- current period: owe only the days stayed
  if b.billing_period = 'month' then
    select * into cur from public.bills where booking_id = b.id and kind = 'rent' and status <> 'void'
      and p_date between period_start and period_end order by period_start desc limit 1;
    if found then
      select coalesce(sum(amount), 0), max((meta ->> 'cycle_days')::int) into rentline, cyc
      from public.bill_lines where bill_id = cur.id and kind = 'rent';
      used := round((b.rate * units)::numeric * (p_date - cur.period_start) / coalesce(cyc, cur.period_end - cur.period_start + 1))::int;
      credit := greatest(rentline - used, 0);
    end if;
  end if;

  notice_given := case when b.notice_date is null then 0 else p_date - b.notice_date end;
  shortfall := case when b.billing_period = 'month' then greatest(b.notice_period_days - notice_given, 0) else 0 end;
  notice_charge := round((b.rate * units)::numeric / 30 * shortfall)::int;
  extras := coalesce((select sum((e ->> 'amount')::int) from jsonb_array_elements(coalesce(p_extras, '[]')) e), 0);

  select * into dep from public.security_deposits where booking_id = b.id;
  held := coalesce(dep.received_amount, 0) - coalesce(dep.refund_amount, 0);
  bal := public.credit_balance(b.customer_id);
  total := pending + notice_charge + extras - credit;
  lock_end := (b.check_in + make_interval(months => b.lock_in_months))::date;
  return jsonb_build_object(
    'pending_dues', pending, 'unused_rent_credit', credit, 'future_paid_credit', future_paid,
    'notice_period_days', b.notice_period_days, 'notice_days_given', notice_given, 'notice_shortfall_days', shortfall,
    'notice_charge', notice_charge, 'extras', extras, 'total_due', total,
    'deposit_held', held, 'credit_balance', bal,
    'net', held + bal + future_paid - total,           -- > 0 refund to tenant, < 0 tenant still pays
    'within_lock_in', p_date < lock_end, 'lock_in_ends', lock_end);
end $$;

create function public.check_out_tenant(p_booking uuid, p_date date, p_extras jsonb default '[]', p_refund_mode text default null,
                                        p_refund_reference text default null, p_notes text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.bookings%rowtype; q jsonb; fb uuid; cur public.bills%rowtype; e jsonb; r record; avail_dep int; avail_credit int;
  use int; pay_id uuid; deds jsonb := '[]'; refund int; dep public.security_deposits%rowtype; payable int; cyc int; used int; rentline int;
  units int;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.status <> 'active' then raise exception 'Only an active stay can be checked out'; end if;
  q := public.checkout_quote(p_booking, p_date, p_extras);
  units := public.booking_units(b.id);

  -- 1. future periods: void unpaid ones, credit what was paid
  for r in select * from public.bills where booking_id = b.id and kind = 'rent' and status <> 'void' and period_start >= p_date loop
    if r.amount_paid > 0 then
      insert into public.tenant_credits (customer_id, booking_id, amount, reason, bill_id)
      values (b.customer_id, b.id, r.amount_paid, 'Unused rent ' || r.invoice_no, r.id);
    end if;
    update public.bills set status = 'void', notes = notes || ' Voided at check-out' where id = r.id;
  end loop;

  -- 2. current period: reduce to the days stayed (adjustment line on the invoice; surplus becomes credit)
  if (q ->> 'unused_rent_credit')::int > 0 then
    select * into cur from public.bills where booking_id = b.id and kind = 'rent' and status <> 'void'
      and p_date between period_start and period_end order by period_start desc limit 1;
    insert into public.bill_lines (bill_id, kind, description, amount, reason, created_by)
    values (cur.id, 'adjustment', 'Unused days after check-out on ' || to_char(p_date, 'DD Mon'),
            -(q ->> 'unused_rent_credit')::int, 'Check-out', auth.uid());
  end if;

  -- 3. final bill: notice shortfall + extras
  if (q ->> 'notice_charge')::int > 0 or (q ->> 'extras')::int > 0 then
    insert into public.bills (booking_id, customer_id, kind, description, amount, due_date)
    values (b.id, b.customer_id, 'final', 'Final settlement', 0, p_date) returning id into fb;
    if (q ->> 'notice_charge')::int > 0 then
      insert into public.bill_lines (bill_id, kind, description, amount, created_by)
      values (fb, 'notice_shortfall', 'Notice period shortfall (' || (q ->> 'notice_shortfall_days') || ' days)', (q ->> 'notice_charge')::int, auth.uid());
    end if;
    for e in select * from jsonb_array_elements(coalesce(p_extras, '[]')) loop
      if coalesce((e ->> 'amount')::int, 0) > 0 then
        insert into public.bill_lines (bill_id, kind, description, amount, created_by)
        values (fb, coalesce(nullif(e ->> 'kind', ''), 'damage'), coalesce(nullif(e ->> 'description', ''), 'Charge'), (e ->> 'amount')::int, auth.uid());
      end if;
    end loop;
  end if;

  -- 4. settle open bills from credit first, then the deposit
  for r in select * from public.bills where booking_id = b.id and status = 'unpaid' order by due_date loop
    perform public.apply_credit(r.id);
  end loop;
  select * into dep from public.security_deposits where booking_id = b.id for update;
  avail_dep := coalesce(dep.received_amount, 0) - coalesce(dep.refund_amount, 0);
  for r in select * from public.bills where booking_id = b.id and status = 'unpaid' order by due_date loop
    exit when avail_dep <= 0;
    use := least(avail_dep, r.amount - r.amount_paid);
    insert into public.payments (bill_id, customer_id, amount, provider, notes, recorded_by)
    values (r.id, r.customer_id, use, 'deposit', 'Deducted from security deposit', auth.uid()) returning id into pay_id;
    perform public.apply_payment_result(pay_id, 'succeeded', 'deposit_' || pay_id);
    deds := deds || jsonb_build_object('description', r.description, 'amount', use, 'bill_id', r.id);
    avail_dep := avail_dep - use;
  end loop;

  -- 5. what is left: refund (deposit leftover + remaining credit) or payable
  avail_credit := public.credit_balance(b.customer_id);
  refund := avail_dep + greatest(avail_credit, 0);
  if avail_credit > 0 then
    insert into public.tenant_credits (customer_id, booking_id, amount, reason, created_by)
    values (b.customer_id, b.id, -avail_credit, 'Refunded at check-out', auth.uid());
  end if;
  payable := coalesce((select sum(amount - amount_paid) from public.bills where booking_id = b.id and status = 'unpaid'), 0);
  if dep.id is not null then
    update public.security_deposits set deductions = deds, refund_amount = refund_amount + avail_dep,
      refunded_on = case when refund > 0 then p_date end, refund_mode = p_refund_mode, refund_reference = p_refund_reference,
      notes = coalesce(p_notes, ''),
      status = case when coalesce(received_amount, 0) = 0 then status
                    when jsonb_array_length(deds) = 0 then 'refunded'
                    when avail_dep > 0 then 'partially_refunded' else 'adjusted' end
    where id = dep.id;
  end if;

  update public.bookings set status = 'completed', actual_checkout = p_date, expected_checkout = coalesce(expected_checkout, p_date)
  where id = b.id;
  update public.booking_beds set active = false where booking_id = b.id and active;
  update public.recurring_charges set active = false where booking_id = b.id;
  update public.agreements set status = 'terminated' where booking_id = b.id and status in ('sent', 'active');
  perform public.notify(b.customer_id, array['in_app', 'email'], 'checkout', 'Check-out settlement',
    'Your check-out on ' || to_char(p_date, 'DD Mon YYYY') || ' is complete. Refund: Rs ' || refund ||
    case when payable > 0 then '. Still payable: Rs ' || payable else '' end || '.', '/account', 'checkout:' || b.id, 'booking', b.id::text);
  perform public.log_activity('tenant.checked_out', 'booking', b.id::text,
    jsonb_build_object('date', p_date, 'refund', refund, 'payable', payable));
  return q || jsonb_build_object('refund', refund, 'payable', payable, 'deductions', deds);
end $$;

-- ---------------------------------------------------------------- deposits (manual edits)
create function public.record_deposit_received(p_booking uuid, p_amount int, p_mode text, p_reference text default null,
                                               p_date date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Stay not found'; end if;
  perform public.require_manage(b.property_id);
  if p_amount is null or p_amount < 1 then raise exception 'Enter the amount received'; end if;
  insert into public.security_deposits (booking_id, customer_id, property_id, amount, received_amount, received_on, mode, reference, status)
  values (b.id, b.customer_id, b.property_id, greatest(b.deposit, p_amount), p_amount, p_date, p_mode, p_reference, 'held')
  on conflict (booking_id) do update set received_amount = security_deposits.received_amount + p_amount,
    received_on = p_date, mode = p_mode, reference = coalesce(p_reference, security_deposits.reference), status = 'held';
  -- an unpaid deposit invoice is settled by this
  update public.bills set status = 'void', notes = notes || ' Deposit recorded in office' where booking_id = b.id and kind = 'deposit'
    and status = 'unpaid' and amount_paid = 0;
  perform public.log_activity('deposit.received', 'booking', b.id::text, jsonb_build_object('amount', p_amount, 'mode', p_mode));
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.bill_lines        enable row level security;
alter table public.tenant_credits    enable row level security;
alter table public.security_deposits enable row level security;
alter table public.recurring_charges enable row level security;
alter table public.meter_readings    enable row level security;
grant select on public.bill_lines, public.tenant_credits, public.security_deposits, public.recurring_charges,
  public.meter_readings to authenticated;
grant update (active) on public.recurring_charges to authenticated;

create policy bill_lines_read on public.bill_lines for select using (exists (select 1 from public.bills b where b.id = bill_id
  and (b.customer_id = auth.uid() or public.can_manage_property(public.booking_property(b.booking_id)))));
create policy credits_read on public.tenant_credits for select using (customer_id = auth.uid() or public.can_see_user(customer_id));
create policy deposits_read on public.security_deposits for select
  using (customer_id = auth.uid() or public.can_manage_property(property_id));
create policy recurring_read on public.recurring_charges for select using (public.can_manage_property(public.booking_property(booking_id))
  or exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()));
create policy recurring_update on public.recurring_charges for update
  using (public.can_manage_property(public.booking_property(booking_id)))
  with check (public.can_manage_property(public.booking_property(booking_id)));
create policy meter_read on public.meter_readings for select
  using (public.can_manage_property((select property_id from public.rooms where id = room_id)));

-- staff overview / dashboard now show what is still owed, not the invoice total
create or replace function public.staff_customer_overview()
returns table (customer_id uuid, full_name text, phone text, room_no text, beds text,
               booking_status text, next_due_date date, next_due_amount int, days_overdue int)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_app_role() not in ('employee', 'admin', 'manager') or not public.has_permission('can_view_customers') then
    if public.current_app_role() is distinct from 'manager' then raise exception 'Not allowed' using errcode = '42501'; end if;
  end if;
  return query
  select p.id, p.full_name,
         case when public.has_permission('can_view_contacts') or public.current_app_role() = 'manager' then p.phone end,
         r.room_no,
         (select string_agg(be.label, ', ' order by be.label) from public.booking_beds bb
            join public.beds be on be.id = bb.bed_id where bb.booking_id = b.id and bb.active),
         b.status, d.due_date,
         case when public.has_permission('can_view_payments') or public.current_app_role() = 'manager' then d.owed end,
         case when d.due_date < current_date then (current_date - d.due_date) else 0 end
  from public.bookings b
  join public.profiles p on p.id = b.customer_id
  join public.rooms r on r.id = b.room_id
  left join lateral (select bl.due_date, bl.amount - bl.amount_paid as owed from public.bills bl
                     where bl.booking_id = b.id and bl.status = 'unpaid' order by bl.due_date limit 1) d on true
  where b.status in ('pending', 'active') and (public.is_admin() or public.can_access_property(b.property_id))
  order by d.due_date nulls last, p.full_name;
end $$;

revoke all on function public.admin_set_setting(text, jsonb), public.credit_balance(uuid), public.bill_recalc(uuid),
  public.record_manual_payment(uuid, int, text, text, date, text, text), public.record_advance(uuid, int, text, text),
  public.apply_credit(uuid), public.add_bill_line(uuid, text, text, int, text, jsonb), public.remove_bill_line(bigint, text),
  public.void_bill(uuid, text), public.rent_period(date, date), public.booking_units(uuid),
  public.generate_invoices_for_booking(uuid, date), public.apply_offer_to_bill(uuid, text), public.generate_monthly_invoices(),
  public.add_charge(uuid, text, text, int, jsonb, text), public.staff_add_charge(uuid, text, text, int, boolean),
  public.add_electricity(text, date, text, int, numeric, numeric, numeric), public.apply_late_fees(), public.refresh_risk_flags(),
  public.send_bill_reminder(uuid, boolean), public.queue_rent_reminders(), public.check_in_tenant(jsonb),
  public.transfer_stay(uuid, uuid[], date, int, text), public.checkout_quote(uuid, date, jsonb),
  public.check_out_tenant(uuid, date, jsonb, text, text, text), public.record_deposit_received(uuid, int, text, text, date),
  public.payment_create_order(uuid, text, int)
from public, anon;
-- internal helpers: server / jobs only
revoke all on function public.bill_recalc(uuid), public.apply_credit(uuid), public.generate_invoices_for_booking(uuid, date),
  public.apply_offer_to_bill(uuid, text), public.add_charge(uuid, text, text, int, jsonb, text), public.apply_late_fees(),
  public.refresh_risk_flags(), public.queue_rent_reminders() from authenticated;
grant execute on function public.bill_recalc(uuid), public.apply_credit(uuid), public.generate_invoices_for_booking(uuid, date),
  public.apply_offer_to_bill(uuid, text), public.add_charge(uuid, text, text, int, jsonb, text), public.apply_late_fees(),
  public.refresh_risk_flags(), public.queue_rent_reminders() to service_role;
grant execute on function public.admin_set_setting(text, jsonb), public.credit_balance(uuid),
  public.record_manual_payment(uuid, int, text, text, date, text, text), public.record_advance(uuid, int, text, text),
  public.add_bill_line(uuid, text, text, int, text, jsonb), public.remove_bill_line(bigint, text), public.void_bill(uuid, text),
  public.rent_period(date, date), public.booking_units(uuid), public.generate_monthly_invoices(),
  public.staff_add_charge(uuid, text, text, int, boolean), public.add_electricity(text, date, text, int, numeric, numeric, numeric),
  public.send_bill_reminder(uuid, boolean), public.check_in_tenant(jsonb), public.transfer_stay(uuid, uuid[], date, int, text),
  public.checkout_quote(uuid, date, jsonb), public.check_out_tenant(uuid, date, jsonb, text, text, text),
  public.record_deposit_received(uuid, int, text, text, date), public.payment_create_order(uuid, text, int)
to authenticated, service_role;
