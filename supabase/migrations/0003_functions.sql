-- Trusted backend logic. Everything that books a bed, moves money or changes a role happens here, inside one
-- transaction per call, as SECURITY DEFINER functions that re-check who the caller is.
-- Internal functions are revoked from clients; only service_role (Edge Functions / webhooks) may call them.

create function public.log_activity(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.activity_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'));
$$;
revoke all on function public.log_activity(text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- holds
-- Pending bookings that nobody paid for release their beds. Runs at the start of every booking.
create function public.release_expired_holds() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with expired as (
    update public.bookings b set status = 'expired'
    where b.status = 'pending' and b.hold_expires_at < now()
      and not exists (select 1 from public.payments p join public.bills bl on bl.id = p.bill_id
                      where bl.booking_id = b.id and p.status = 'succeeded')
    returning b.id
  ), freed as (
    update public.booking_beds bb set active = false
    from expired e where bb.booking_id = e.id and bb.active
    returning bb.booking_id
  ), voided as (
    update public.bills bl set status = 'void'
    from expired e where bl.booking_id = e.id and bl.status = 'unpaid'
    returning bl.id
  )
  select count(*) into n from expired;
  return n;
end $$;
revoke all on function public.release_expired_holds() from public, anon, authenticated;
grant execute on function public.release_expired_holds() to service_role;

-- ---------------------------------------------------------------- booking
-- Locks the room row first, so two customers booking the same room are serialised and the second one
-- sees the first one's beds as taken. The unique index on booking_beds is a second line of defence.
create function public.book_room(p_room_id text, p_bed_count int, p_check_in date, p_check_out date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.rooms%rowtype;
  units int;
  bed_ids uuid[];
  b_id uuid;
  rent_total int;
  deposit_total int;
  hold_min int;
begin
  if uid is null or public.current_app_role() is distinct from 'customer' then
    raise exception 'Log in with a customer account to book' using errcode = '42501';
  end if;
  if p_check_in is null or p_check_in < current_date then
    raise exception 'Check-in date cannot be in the past';
  end if;

  perform public.release_expired_holds();

  select * into r from public.rooms where id = p_room_id and is_active for update;
  if not found then raise exception 'Room not found'; end if;

  if r.billing_period = 'night' and (p_check_out is null or p_check_out <= p_check_in) then
    raise exception 'Choose a check-out date after check-in';
  end if;

  if r.rent_basis = 'room' then
    select array_agg(id) into bed_ids from public.beds where room_id = r.id;
    if bed_ids is null or exists (select 1 from public.beds
        where room_id = r.id and (is_occupied or status <> 'available')) then
      raise exception 'This room is not fully available';
    end if;
    units := 1;
  else
    if p_bed_count is null or p_bed_count < 1 or p_bed_count > 4 then
      raise exception 'Choose between 1 and 4 beds';
    end if;
    select array_agg(id) into bed_ids from (
      select id from public.beds
      where room_id = r.id and not is_occupied and status = 'available'
      order by label limit p_bed_count) s;
    if coalesce(array_length(bed_ids, 1), 0) < p_bed_count then
      raise exception 'Only % bed(s) left in this room', coalesce(array_length(bed_ids, 1), 0);
    end if;
    units := p_bed_count;
  end if;

  select (value #>> '{}')::int into hold_min from public.app_settings where key = 'hold_minutes';

  begin
    insert into public.bookings (customer_id, room_id, status, billing_period, rate, deposit,
                                 check_in, check_out, hold_expires_at)
    values (uid, r.id, 'pending', r.billing_period, r.price, r.deposit * units,
            p_check_in, case when r.billing_period = 'night' then p_check_out end,
            now() + make_interval(mins => coalesce(hold_min, 30)))
    returning id into b_id;

    insert into public.booking_beds (booking_id, bed_id) select b_id, unnest(bed_ids);
  exception when unique_violation then
    -- either "one live booking per customer" or "bed already taken"
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
  end if;
  insert into public.bills (booking_id, customer_id, kind, description, amount, due_date)
  values (b_id, uid,  'rent',
          case when r.billing_period = 'month' then 'First month rent, room ' || r.room_no
               else 'Stay in room ' || r.room_no || ', ' || (p_check_out - p_check_in) || ' night(s)' end,
          rent_total, current_date);

  perform public.log_activity('booking.created', 'booking', b_id::text,
                              jsonb_build_object('room', r.id, 'units', units));
  return b_id;
end $$;

create function public.cancel_booking(p_booking_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare bk public.bookings%rowtype; admin boolean := public.is_admin();
begin
  select * into bk from public.bookings where id = p_booking_id for update;
  if not found or (bk.customer_id <> auth.uid() and not admin) then
    raise exception 'Booking not found';
  end if;
  -- customers may cancel only unpaid holds; ending a paid stay is the admin's call
  if bk.status = 'active' and not admin then
    raise exception 'Active stays are cancelled by the PG office';
  end if;
  if bk.status not in ('pending', 'active') then raise exception 'Booking is already closed'; end if;

  update public.bookings set status = 'cancelled', hold_expires_at = null where id = bk.id;
  update public.booking_beds set active = false where booking_id = bk.id and active;
  update public.bills set status = 'void' where booking_id = bk.id and status = 'unpaid';
  perform public.log_activity('booking.cancelled', 'booking', bk.id::text, '{}');
end $$;

create function public.admin_end_booking(p_booking_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare bk public.bookings%rowtype;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into bk from public.bookings where id = p_booking_id for update;
  if not found or bk.status <> 'active' then raise exception 'Only active bookings can be ended'; end if;
  update public.bookings set status = 'completed' where id = bk.id;
  update public.booking_beds set active = false where booking_id = bk.id and active;
  -- unpaid bills stay: the customer still owes them
  perform public.log_activity('booking.ended', 'booking', bk.id::text, '{}');
end $$;

-- ---------------------------------------------------------------- payments
-- Customer asks to pay a bill. Creates a payment in status 'created'. It does NOT mark anything paid.
create function public.payment_create_order(p_bill_id uuid, p_provider text default 'demo')
returns uuid language plpgsql security definer set search_path = public as $$
declare bl public.bills%rowtype; pay_id uuid; demo_on boolean;
begin
  select * into bl from public.bills where id = p_bill_id and customer_id = auth.uid();
  if not found then raise exception 'Bill not found'; end if;
  if bl.status <> 'unpaid' then raise exception 'This bill is not payable'; end if;

  if p_provider = 'demo' then
    select (value #>> '{}')::boolean into demo_on from public.app_settings where key = 'demo_payments_enabled';
    if not coalesce(demo_on, false) then raise exception 'Demo payments are disabled'; end if;
  else
    -- Razorpay orders are created by an Edge Function using the service role (see docs/payments.md)
    raise exception 'Unsupported payment provider';
  end if;

  insert into public.payments (bill_id, customer_id, amount, provider, is_simulated, provider_order_id)
  values (bl.id, bl.customer_id, bl.amount, p_provider, p_provider = 'demo', 'demo_order_' || gen_random_uuid())
  returning id into pay_id;
  return pay_id;
end $$;

-- The single place where a payment turns into a paid bill. Idempotent. Not callable by browsers.
create function public.apply_payment_result(p_payment_id uuid, p_status text,
                                            p_provider_payment_id text default null,
                                            p_failure_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare pay public.payments%rowtype; bl public.bills%rowtype; bk public.bookings%rowtype;
begin
  if p_status not in ('succeeded', 'failed') then raise exception 'Bad status'; end if;

  select * into pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if pay.status <> 'created' then return pay.status; end if;   -- replayed webhook / double click

  if p_status = 'failed' then
    update public.payments set status = 'failed', failure_reason = coalesce(p_failure_reason, 'Payment failed'),
           completed_at = now() where id = pay.id;
    return 'failed';
  end if;

  select * into bl from public.bills where id = pay.bill_id for update;
  if bl.status <> 'unpaid' then
    update public.payments set status = 'failed', failure_reason = 'Bill was already settled',
           completed_at = now() where id = pay.id;
    return 'failed';
  end if;

  update public.payments set status = 'succeeded', provider_payment_id = p_provider_payment_id,
         completed_at = now() where id = pay.id;
  update public.bills set status = 'paid', paid_at = now() where id = bl.id;

  select * into bk from public.bookings where id = bl.booking_id for update;

  -- booking goes live once everything billed so far is paid
  if bk.status = 'pending' and not exists (
      select 1 from public.bills where booking_id = bk.id and status = 'unpaid') then
    update public.bookings set status = 'active', hold_expires_at = null where id = bk.id;
    bk.status := 'active';
  end if;

  -- monthly stays: paying rent schedules next month's bill
  if bl.kind = 'rent' and bk.billing_period = 'month' and bk.status = 'active' and not exists (
      select 1 from public.bills where booking_id = bk.id and kind = 'rent' and due_date > bl.due_date and status <> 'void') then
    insert into public.bills (booking_id, customer_id, kind, description, amount, due_date)
    values (bk.id, bk.customer_id, 'rent',
            'Monthly rent, ' || to_char(bl.due_date + interval '1 month', 'Mon YYYY'),
            bl.amount, (bl.due_date + interval '1 month')::date);
  end if;

  perform public.log_activity('payment.succeeded', 'payment', pay.id::text,
                              jsonb_build_object('provider', pay.provider, 'amount', pay.amount));
  return 'succeeded';
end $$;
revoke all on function public.apply_payment_result(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_payment_result(uuid, text, text, text) to service_role;

-- Demo provider: the "gateway". Only exists while demo_payments_enabled is true, only for demo payments,
-- only for the customer who owns them. The frontend cannot mark anything paid except through this.
create function public.demo_complete_payment(p_payment_id uuid, p_outcome text)
returns text language plpgsql security definer set search_path = public as $$
declare pay public.payments%rowtype; demo_on boolean;
begin
  select (value #>> '{}')::boolean into demo_on from public.app_settings where key = 'demo_payments_enabled';
  if not coalesce(demo_on, false) then raise exception 'Demo payments are disabled'; end if;
  if p_outcome not in ('success', 'failure') then raise exception 'Bad outcome'; end if;

  select * into pay from public.payments where id = p_payment_id;
  if not found or pay.provider <> 'demo' or pay.customer_id <> auth.uid() then
    raise exception 'Payment not found';
  end if;

  return public.apply_payment_result(
    pay.id,
    case p_outcome when 'success' then 'succeeded' else 'failed' end,
    'demo_pay_' || gen_random_uuid(),
    case p_outcome when 'failure' then 'Simulated failure' end);
end $$;

-- Office takes cash or a bank transfer outside the app
create function public.admin_record_cash_payment(p_bill_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare bl public.bills%rowtype; pay_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into bl from public.bills where id = p_bill_id;
  if not found or bl.status <> 'unpaid' then raise exception 'This bill is not payable'; end if;
  insert into public.payments (bill_id, customer_id, amount, provider, is_simulated)
  values (bl.id, bl.customer_id, bl.amount, 'cash', false) returning id into pay_id;
  return public.apply_payment_result(pay_id, 'succeeded', 'cash_' || pay_id);
end $$;

-- ---------------------------------------------------------------- staff
-- What an employee sees about customers, trimmed by their permission switches.
create function public.staff_customer_overview()
returns table (customer_id uuid, full_name text, phone text, room_no text, beds text,
               booking_status text, next_due_date date, next_due_amount int, days_overdue int)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_app_role() not in ('employee', 'admin') or not public.has_permission('can_view_customers') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select p.id, p.full_name,
         case when public.has_permission('can_view_contacts') then p.phone end,
         r.room_no,
         (select string_agg(be.label, ', ' order by be.label) from public.booking_beds bb
            join public.beds be on be.id = bb.bed_id where bb.booking_id = b.id and bb.active),
         b.status,
         d.due_date,
         case when public.has_permission('can_view_payments') then d.amount end,
         case when d.due_date < current_date then (current_date - d.due_date) else 0 end
  from public.bookings b
  join public.profiles p on p.id = b.customer_id
  join public.rooms r on r.id = b.room_id
  left join lateral (select bl.due_date, bl.amount from public.bills bl
                     where bl.booking_id = b.id and bl.status = 'unpaid'
                     order by bl.due_date limit 1) d on true
  where b.status in ('pending', 'active')
  order by d.due_date nulls last, p.full_name;
end $$;

create function public.set_bed_status(p_bed_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('can_manage_beds') or public.current_app_role() not in ('employee', 'admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_status not in ('available', 'maintenance') then raise exception 'Bad status'; end if;
  if p_status = 'maintenance' and exists (select 1 from public.beds where id = p_bed_id and is_occupied) then
    raise exception 'That bed is occupied';
  end if;
  update public.beds set status = p_status where id = p_bed_id;
  perform public.log_activity('bed.status', 'bed', p_bed_id::text, jsonb_build_object('status', p_status));
end $$;

-- ---------------------------------------------------------------- admin
create function public.admin_set_employee_permissions(p_employee uuid, p_perms jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_employee and role = 'employee') then
    raise exception 'Not an employee';
  end if;
  insert into public.employee_permissions as ep (employee_id, can_view_customers, can_view_contacts,
                                                 can_view_payments, can_manage_beds)
  values (p_employee,
          coalesce((p_perms ->> 'can_view_customers')::boolean, true),
          coalesce((p_perms ->> 'can_view_contacts')::boolean, true),
          coalesce((p_perms ->> 'can_view_payments')::boolean, false),
          coalesce((p_perms ->> 'can_manage_beds')::boolean, false))
  on conflict (employee_id) do update set
    can_view_customers = excluded.can_view_customers, can_view_contacts = excluded.can_view_contacts,
    can_view_payments = excluded.can_view_payments, can_manage_beds = excluded.can_manage_beds;
  perform public.log_activity('employee.permissions', 'employee', p_employee::text, p_perms);
end $$;

create function public.admin_set_user_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot deactivate yourself'; end if;
  update public.profiles set is_active = p_active where id = p_user;
  perform public.log_activity('user.active', 'user', p_user::text, jsonb_build_object('active', p_active));
end $$;

create function public.admin_dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'rooms',            (select count(*) from public.rooms where is_active),
    'beds',             (select count(*) from public.beds),
    'beds_occupied',    (select count(*) from public.beds where is_occupied),
    'beds_maintenance', (select count(*) from public.beds where status = 'maintenance' and not is_occupied),
    'beds_available',   (select count(*) from public.beds where not is_occupied and status = 'available'),
    'customers_current',(select count(distinct customer_id) from public.bookings where status = 'active'),
    'customers_total',  (select count(*) from public.profiles where role = 'customer'),
    'employees',        (select count(*) from public.profiles where role = 'employee' and is_active),
    'bookings_pending', (select count(*) from public.bookings where status = 'pending'),
    'bookings_active',  (select count(*) from public.bookings where status = 'active'),
    'bookings_total',   (select count(*) from public.bookings),
    'received',         (select coalesce(sum(amount), 0) from public.payments where status = 'succeeded' and not is_simulated),
    'received_demo',    (select coalesce(sum(amount), 0) from public.payments where status = 'succeeded' and is_simulated),
    'pending_amount',   (select coalesce(sum(amount), 0) from public.bills where status = 'unpaid' and due_date >= current_date),
    'overdue_amount',   (select coalesce(sum(amount), 0) from public.bills where status = 'unpaid' and due_date < current_date),
    'overdue_count',    (select count(*) from public.bills where status = 'unpaid' and due_date < current_date)
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function
  public.book_room(text, int, date, date), public.cancel_booking(uuid), public.admin_end_booking(uuid),
  public.payment_create_order(uuid, text), public.demo_complete_payment(uuid, text),
  public.admin_record_cash_payment(uuid), public.staff_customer_overview(), public.set_bed_status(uuid, text),
  public.admin_set_employee_permissions(uuid, jsonb), public.admin_set_user_active(uuid, boolean),
  public.admin_dashboard_stats()
from public, anon;
grant execute on function
  public.book_room(text, int, date, date), public.cancel_booking(uuid), public.admin_end_booking(uuid),
  public.payment_create_order(uuid, text), public.demo_complete_payment(uuid, text),
  public.admin_record_cash_payment(uuid), public.staff_customer_overview(), public.set_bed_status(uuid, text),
  public.admin_set_employee_permissions(uuid, jsonb), public.admin_set_user_active(uuid, boolean),
  public.admin_dashboard_stats()
to authenticated;
