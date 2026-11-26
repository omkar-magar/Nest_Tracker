-- Registration v2, part 4: check-out and extensions.
-- * Daily stays check out automatically at 12 AM (IST) on their check-out date (scheduled jobs run every 30 minutes).
--   The guest then sees the thank-you message.
-- * A manager or the owner can extend any guest's stay at any time, even after check-out: a new check-out date, an
--   optional extra charge added to the rent, and the rent status (paid, partly paid, pending). Extending a guest who
--   has checked out brings them back as a current guest and opens their resident page again.
-- * A guest on a daily stay can ask for an extension; the manager approves it with the dates they decide, or declines.

create table public.stay_extensions (
  id              bigint generated always as identity primary key,
  guest_id        bigint not null references public.register_guests (id) on delete cascade,
  customer_id     uuid not null references public.profiles (id) on delete cascade,
  property_id     text not null references public.properties (id),
  room_no         text not null,
  current_until   date,
  requested_until date not null,
  note            text not null default '' check (char_length(note) <= 500),
  status          text not null default 'requested' check (status in ('requested', 'approved', 'declined', 'cancelled')),
  approved_until  date,
  charge          int check (charge >= 0),
  answer          text not null default '',
  decided_by      uuid references public.profiles (id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index stay_extensions_open_idx on public.stay_extensions (property_id, created_at desc) where status = 'requested';
create index stay_extensions_customer_idx on public.stay_extensions (customer_id, created_at desc);
alter table public.stay_extensions enable row level security;
grant select on public.stay_extensions to authenticated;
create policy stay_extensions_read on public.stay_extensions for select
  using (customer_id = auth.uid() or public.can_manage_property(property_id));

-- daily stays leave at 12 AM on their check-out date
create function public.register_auto_checkout() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; g public.register_guests; today date := public.ist_date(now());
begin
  for g in select * from public.register_guests where checked_out_on is null and stay_type in ('pg_daily', 'flat_daily')
             and expected_checkout is not null and expected_checkout <= today for update loop
    update public.register_guests set checked_out_on = g.expected_checkout, checkout_note = 'Automatic check-out' where id = g.id;
    update public.stay_extensions set status = 'cancelled', answer = 'Checked out', decided_at = now()
    where guest_id = g.id and status = 'requested';
    if g.customer_id is not null then
      perform public.notify(g.customer_id, array['in_app', 'push'], 'registration', 'Thank you for staying with us',
        'Your stay in room ' || g.room_no || ' has ended. To extend your stay or come back, please contact your manager.',
        '/account', 'auto-checkout:' || g.id || ':' || g.expected_checkout, 'tenant', g.customer_id::text);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- manager / owner: extend a stay (also after check-out). p_charge is added to the rent; p_status sets the rent status.
create function public.extend_stay(p_guest bigint, p_until date, p_charge int default 0, p_status text default null,
  p_note text default '', p_request bigint default null) returns void
language plpgsql security definer set search_path = public as $$
declare g public.register_guests; today date := public.ist_date(now());
begin
  select * into g from public.register_guests where id = p_guest for update;
  if not found then raise exception 'Guest not found'; end if;
  perform public.require_manage(g.property_id);
  if p_until is null or p_until <= today or (g.check_in is not null and p_until <= g.check_in) then
    raise exception 'Choose a new check-out date after today';
  end if;
  if coalesce(p_charge, 0) < 0 then raise exception 'The extra charge cannot be negative'; end if;
  if p_status is not null and p_status not in ('paid', 'partially_paid', 'pending', 'not_updated') then raise exception 'Unknown rent status'; end if;
  if g.checked_out_on is not null and g.customer_id is not null
    and exists (select 1 from public.register_guests where customer_id = g.customer_id and checked_out_on is null and id <> g.id) then
    raise exception 'This guest already has another current stay';
  end if;
  update public.register_guests set expected_checkout = p_until, checked_out_on = null, checkout_note = '',
    rent = coalesce(rent, 0) + coalesce(p_charge, 0), rent_status = coalesce(p_status, rent_status),
    notes = case when coalesce(trim(p_note), '') = '' then notes else trim(both ' ' from notes || ' ' || trim(p_note)) end
  where id = g.id;
  if p_request is not null then
    update public.stay_extensions set status = 'approved', approved_until = p_until, charge = coalesce(p_charge, 0),
      answer = coalesce(p_note, ''), decided_by = auth.uid(), decided_at = now()
    where id = p_request and guest_id = g.id and status = 'requested';
  end if;
  update public.stay_extensions set status = 'cancelled', answer = 'Extended by the office', decided_at = now()
  where guest_id = g.id and status = 'requested';
  perform public.log_activity('register.extend', 'register_guest', g.id::text,
    jsonb_build_object('until', p_until, 'charge', coalesce(p_charge, 0), 'status', p_status, 'was_checked_out', g.checked_out_on is not null));
  if g.customer_id is not null then
    perform public.notify(g.customer_id, array['in_app', 'push'], 'registration', 'Stay extended',
      'Your stay in room ' || g.room_no || ' is extended until ' || to_char(p_until, 'DD Mon YYYY') || '.'
        || case when coalesce(p_charge, 0) > 0 then ' ₹' || p_charge || ' is added to your rent.' else '' end,
      '/account#my-stay', 'extended:' || g.id || ':' || p_until, 'tenant', g.customer_id::text);
  end if;
end $$;

create function public.decline_extension(p_id bigint, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare x public.stay_extensions;
begin
  select * into x from public.stay_extensions where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  perform public.require_manage(x.property_id);
  if x.status <> 'requested' then raise exception 'This request has already been answered'; end if;
  update public.stay_extensions set status = 'declined', answer = coalesce(p_note, ''), decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform public.notify(x.customer_id, array['in_app', 'push'], 'registration', 'Extension not approved',
    'Your request to stay until ' || to_char(x.requested_until, 'DD Mon YYYY') || ' was not approved.'
      || coalesce(' ' || nullif(trim(p_note), ''), ''), '/account#my-stay', 'extension-declined:' || p_id, 'tenant', x.customer_id::text);
end $$;

-- the guest on a daily stay asks to stay longer
create function public.request_extension(p_until date, p_note text default '') returns bigint
language plpgsql security definer set search_path = public as $$
declare g public.register_guests; nid bigint; who text;
begin
  if public.current_app_role() is distinct from 'customer' then raise exception 'Residents only' using errcode = '42501'; end if;
  select * into g from public.register_guests where customer_id = auth.uid() and checked_out_on is null order by id desc limit 1;
  if not found then raise exception 'You can ask for an extension while your stay is on'; end if;
  if g.stay_type not in ('pg_daily', 'flat_daily') then raise exception 'Extensions are for daily stays. Talk to your manager.'; end if;
  if p_until is null or p_until <= coalesce(g.expected_checkout, public.ist_date(now())) then
    raise exception 'Choose a date after your current check-out date';
  end if;
  if exists (select 1 from public.stay_extensions where guest_id = g.id and status = 'requested') then
    raise exception 'You already asked. Wait for your manager to answer.';
  end if;
  insert into public.stay_extensions (guest_id, customer_id, property_id, room_no, current_until, requested_until, note)
  values (g.id, auth.uid(), g.property_id, g.room_no, g.expected_checkout, p_until, left(coalesce(trim(p_note), ''), 500))
  returning id into nid;
  select full_name into who from public.profiles where id = auth.uid();
  perform public.registration_managers_notify(auth.uid(), g.property_id, 'Extension request',
    coalesce(who, 'A guest') || ' (room ' || g.room_no || ') asks to stay until ' || to_char(p_until, 'DD Mon YYYY') || '.',
    'extension:' || nid);
  return nid;
end $$;

create function public.cancel_extension(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.stay_extensions set status = 'cancelled', decided_at = now() where id = p_id and customer_id = auth.uid() and status = 'requested';
  if not found then raise exception 'Only a waiting request can be cancelled'; end if;
end $$;

-- the guest's latest request
create function public.my_extension() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(x) - 'customer_id' - 'decided_by' from public.stay_extensions x where customer_id = auth.uid() order by id desc limit 1
$$;

-- managers: requests for their wings, open first
create function public.extension_requests(p_property text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.open desc, x.created_at desc), '[]') from (
    select e.id, e.guest_id, e.property_id, e.room_no, e.current_until, e.requested_until, e.note, e.status, e.approved_until,
      e.charge, e.answer, e.created_at, e.status = 'requested' open, coalesce(nullif(g.name, ''), p.full_name) guest,
      g.rent, g.rent_status, g.stay_type, g.check_in
    from public.stay_extensions e
    left join public.register_guests g on g.id = e.guest_id
    left join public.profiles p on p.id = e.customer_id
    where public.can_manage_property(e.property_id) and (p_property is null or e.property_id = p_property)
      and (e.status = 'requested' or e.created_at > now() - interval '30 days')
    order by e.status = 'requested' desc, e.created_at desc limit 100) x
$$;

revoke all on function public.register_auto_checkout(), public.extend_stay(bigint, date, int, text, text, bigint),
  public.decline_extension(bigint, text), public.request_extension(date, text), public.cancel_extension(bigint),
  public.my_extension(), public.extension_requests(text) from public, anon;
grant execute on function public.extend_stay(bigint, date, int, text, text, bigint), public.decline_extension(bigint, text),
  public.request_extension(date, text), public.cancel_extension(bigint), public.my_extension(), public.extension_requests(text) to authenticated;
grant execute on function public.register_auto_checkout() to service_role;

-- scheduled jobs: the same list plus the automatic check-outs
create or replace function public.run_scheduled_jobs(p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb; v_last timestamptz;
begin
  if auth.uid() is not null and not public.is_manager_or_owner() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select max(started_at) into v_last from public.job_runs;
  if not p_force and v_last > now() - interval '30 minutes' then
    return jsonb_build_object('skipped', true, 'last_run', v_last);
  end if;
  res := jsonb_build_object(
    'holds_released', public.release_expired_holds(),
    'reservations_released', public.release_expired_reservations(),
    'invoices', (select coalesce(sum(public.generate_invoices_for_booking(id)), 0) from public.bookings where status = 'active' and billing_period = 'month'),
    'late_fees', public.apply_late_fees(),
    'reminders', public.queue_rent_reminders(),
    'recurring_expenses', public.generate_recurring_expenses(),
    'escalations', public.escalate_overdue_complaints(),
    'maintenance', public.run_maintenance_schedules(),
    'tasks', public.generate_daily_tasks(current_date),
    'sales_reminders', public.run_sales_reminders(),
    'agreements', public.run_agreement_alerts(),
    'referrals', public.apply_referral_rewards(),
    'owner_report', public.queue_monthly_owner_report(),
    'auto_checkouts', public.register_auto_checkout());
  perform public.refresh_risk_flags();
  insert into public.job_runs (result, triggered_by) values (res, auth.uid());
  return res;
end $$;
