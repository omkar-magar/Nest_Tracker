-- PRD 7 (dashboard and reports), 9.5 (sales reports), 10.5 (employee reports) and the scheduled jobs that make
-- reminders, invoices, late fees, escalations and alerts happen on their own.
-- Every report takes the same filters (dates, property, floor, room, tenant where they apply) and only returns
-- properties the caller may see. Dates are India time.

create function public.ist_date(t timestamptz) returns date language sql immutable as $$ select (t at time zone 'Asia/Kolkata')::date $$;

create function public.report_scope(p_property text) returns setof text
language sql stable security definer set search_path = public as $$
  select id from public.properties
  where (p_property is null or id = p_property)
    and (public.is_admin() or public.can_manage_property(id) or (auth.uid() is null))
$$;

create function public.require_reports() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager_or_owner() then raise exception 'Reports are for the owner and managers' using errcode = '42501'; end if;
end $$;

-- money actually received, split by what it paid for (rent, charges, late fees, deposits kept). Deposits taken are a
-- liability, not income: only the part kept at check-out (provider 'deposit') counts.
create function public.income_lines(p_from date, p_to date, p_property text)
returns table (property_id text, day date, category text, amount numeric)
language sql stable security definer set search_path = public as $$
  with pay as (
    select p.id, p.amount, p.provider, public.ist_date(p.completed_at) d, b.id bill_id, b.amount bill_amount, bk.property_id
    from public.payments p join public.bills b on b.id = p.bill_id join public.bookings bk on bk.id = b.booking_id
    where p.status = 'succeeded' and b.kind <> 'deposit' and public.ist_date(p.completed_at) between p_from and p_to
      and bk.property_id in (select public.report_scope(p_property)))
  select property_id, d, 'deposits_kept', amount from pay where provider = 'deposit'
  union all
  select pay.property_id, pay.d,
         case when l.kind in ('rent', 'discount', 'adjustment') then 'rent' when l.kind = 'late_fee' then 'late_fees' else 'charges' end,
         pay.amount::numeric * l.amount / nullif(pay.bill_amount, 0)
  from pay join public.bill_lines l on l.bill_id = pay.bill_id where pay.provider <> 'deposit' and pay.bill_amount > 0
  union all
  select o.property_id, o.received_on, 'other_income', o.amount from public.other_income o
  where o.received_on between p_from and p_to and o.property_id in (select public.report_scope(p_property))
$$;

-- ---------------------------------------------------------------- dashboard (PRD 7.1)
create function public.owner_dashboard(p_property text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m date := date_trunc('month', current_date)::date; e date := (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date;
  res jsonb;
begin
  perform public.require_reports();
  with scope as (select public.report_scope(p_property) id),
  beds as (
    select r.property_id, public.bed_state(b) st from public.beds b join public.rooms r on r.id = b.room_id
    where r.property_id in (select id from scope) and r.is_active and b.is_active),
  bedsum as (
    select property_id, count(*) total, count(*) filter (where st = 'occupied') occupied, count(*) filter (where st = 'vacant') vacant,
           count(*) filter (where st = 'reserved') reserved, count(*) filter (where st = 'maintenance') maintenance
    from beds group by property_id),
  billed as (
    select bk.property_id, sum(b.amount) billed, sum(b.amount_paid) paid_of_billed
    from public.bills b join public.bookings bk on bk.id = b.booking_id
    where b.status <> 'void' and b.kind <> 'deposit' and b.due_date between m and e and bk.property_id in (select id from scope)
    group by bk.property_id),
  coll as (select property_id, sum(amount) collected from public.income_lines(m, e, p_property) group by property_id),
  exp as (select property_id, sum(amount) spent from public.expenses where status = 'approved' and spent_on between m and e
          and property_id in (select id from scope) group by property_id),
  pend as (select bk.property_id, sum(b.amount - b.amount_paid) pending, sum(b.amount - b.amount_paid) filter (where b.due_date < current_date) overdue
           from public.bills b join public.bookings bk on bk.id = b.booking_id
           where b.status = 'unpaid' and b.kind <> 'deposit' and bk.property_id in (select id from scope) group by bk.property_id),
  comp as (select property_id, count(*) filter (where status in ('new', 'assigned', 'in_progress')) open,
             count(*) filter (where status in ('new', 'assigned', 'in_progress') and due_at < now()) overdue,
             count(*) filter (where status in ('resolved', 'closed') and resolved_at >= m) resolved_month,
             round(avg(extract(epoch from resolved_at - created_at) / 3600) filter (where resolved_at >= m - 90), 1) avg_hours
           from public.complaints where property_id in (select id from scope) group by property_id),
  per as (
    select p.id, p.name, coalesce(bs.total, 0) total, coalesce(bs.occupied, 0) occupied, coalesce(bs.vacant, 0) vacant,
           coalesce(bs.reserved, 0) reserved, coalesce(bs.maintenance, 0) maintenance,
           coalesce(bi.billed, 0) billed, coalesce(bi.paid_of_billed, 0) paid_billed, coalesce(c.collected, 0) collected, coalesce(x.spent, 0) expenses,
           coalesce(pe.pending, 0) pending, coalesce(pe.overdue, 0) overdue,
           coalesce(co.open, 0) complaints_open, coalesce(co.overdue, 0) complaints_overdue,
           coalesce(co.resolved_month, 0) complaints_resolved, co.avg_hours,
           case when coalesce(bi.billed, 0) > 0 then round(100.0 * bi.paid_of_billed / bi.billed, 1) end collection_efficiency
    from public.properties p join scope s on s.id = p.id
    left join bedsum bs on bs.property_id = p.id left join billed bi on bi.property_id = p.id left join coll c on c.property_id = p.id
    left join exp x on x.property_id = p.id left join pend pe on pe.property_id = p.id left join comp co on co.property_id = p.id)
  select jsonb_build_object(
    'month', m,
    'beds', jsonb_build_object('total', sum(total), 'occupied', sum(occupied), 'vacant', sum(vacant), 'reserved', sum(reserved),
                               'maintenance', sum(maintenance),
                               'occupancy_pct', case when sum(total) > 0 then round(100.0 * sum(occupied) / sum(total), 1) else 0 end),
    'money', jsonb_build_object('billed', sum(billed), 'collected', round(sum(collected)), 'pending', sum(pending), 'overdue', sum(overdue),
                                'expenses', sum(expenses), 'net_profit', round(sum(collected) - sum(expenses)),
                                'collection_efficiency', case when sum(billed) > 0 then round(100.0 * sum(paid_billed) / sum(billed), 1) end),
    'complaints', jsonb_build_object('open', sum(complaints_open), 'overdue', sum(complaints_overdue), 'resolved_this_month', sum(complaints_resolved)),
    'properties', coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'beds', total, 'occupied', occupied, 'vacant', vacant,
       'reserved', reserved, 'occupancy_pct', case when total > 0 then round(100.0 * occupied / total, 1) else 0 end,
       'revenue', round(collected), 'billed', billed, 'expenses', expenses, 'profit', round(collected - expenses), 'pending', pending,
       'complaints_open', complaints_open, 'complaints_overdue', complaints_overdue, 'avg_resolution_hours', avg_hours,
       'collection_efficiency', collection_efficiency) order by id), '[]'))
  into res from per;

  res := res || jsonb_build_object(
    'checkins_month', (select count(*) from public.bookings where check_in between m and e and status in ('active', 'completed')
                       and property_id in (select public.report_scope(p_property))),
    'checkouts_month', (select count(*) from public.bookings where actual_checkout between m and e
                        and property_id in (select public.report_scope(p_property))),
    'upcoming_checkins', coalesce((select jsonb_agg(x order by x ->> 'date') from (
        select jsonb_build_object('kind', 'reservation', 'name', r.tenant_name, 'bed', b.code, 'date', r.expires_on, 'advance', r.advance_amount) x
        from public.reservations r join public.beds b on b.id = r.bed_id join public.rooms ro on ro.id = b.room_id
        where r.status = 'active' and ro.property_id in (select public.report_scope(p_property))
        union all
        select jsonb_build_object('kind', 'booking', 'name', p.full_name, 'bed', ro.room_no, 'date', bk.check_in)
        from public.bookings bk join public.profiles p on p.id = bk.customer_id join public.rooms ro on ro.id = bk.room_id
        where bk.status in ('pending', 'active') and bk.check_in > current_date and bk.property_id in (select public.report_scope(p_property))) s), '[]'),
    'upcoming_checkouts', coalesce((select jsonb_agg(jsonb_build_object('booking_id', bk.id, 'customer_id', bk.customer_id, 'name', p.full_name,
        'room', ro.room_no, 'date', bk.expected_checkout, 'notice_date', bk.notice_date) order by bk.expected_checkout)
      from public.bookings bk join public.profiles p on p.id = bk.customer_id join public.rooms ro on ro.id = bk.room_id
      where bk.status = 'active' and bk.expected_checkout between current_date and current_date + 45
        and bk.property_id in (select public.report_scope(p_property))), '[]'));
  return res;
end $$;

-- ---------------------------------------------------------------- reports (PRD 7.2)
create function public.report_occupancy(p_from date, p_to date, p_property text default null, p_floor int default null, p_room text default null)
returns table (property_id text, floor int, room_no text, room_id text, beds int, occupied_now int, vacant_now int, reserved_now int,
               blocked_now int, occupied_bed_nights int, available_bed_nights int, occupancy_pct numeric, vacancy_days_per_bed numeric)
language plpgsql stable security definer set search_path = public as $$
declare days int := p_to - p_from + 1;
begin
  perform public.require_reports();
  if days < 1 then raise exception 'End date is before start date'; end if;
  return query
  with rb as (
    select r.property_id, r.floor, r.room_no, r.id, count(b.*)::int nb,
           count(*) filter (where public.bed_state(b) = 'occupied')::int occ, count(*) filter (where public.bed_state(b) = 'vacant')::int vac,
           count(*) filter (where public.bed_state(b) = 'reserved')::int res, count(*) filter (where public.bed_state(b) = 'maintenance')::int blk
    from public.rooms r join public.beds b on b.room_id = r.id and b.is_active
    where r.property_id in (select public.report_scope(p_property)) and (p_floor is null or r.floor = p_floor) and (p_room is null or r.id = p_room)
    group by r.property_id, r.floor, r.room_no, r.id),
  nights as (
    select bk.room_id, sum(public.booking_units(bk.id) * greatest(0,
             least(coalesce(bk.actual_checkout, bk.check_out, p_to + 1), p_to + 1) - greatest(bk.check_in, p_from)))::int n
    from public.bookings bk where bk.status in ('active', 'completed') and bk.check_in <= p_to
      and coalesce(bk.actual_checkout, bk.check_out, p_to + 1) > p_from group by bk.room_id)
  select rb.property_id, rb.floor, rb.room_no, rb.id, rb.nb, rb.occ, rb.vac, rb.res, rb.blk,
         least(coalesce(n.n, 0), rb.nb * days), rb.nb * days,
         round(100.0 * least(coalesce(n.n, 0), rb.nb * days) / nullif(rb.nb * days, 0), 1),
         round((rb.nb * days - least(coalesce(n.n, 0), rb.nb * days))::numeric / nullif(rb.nb, 0), 1)
  from rb left join nights n on n.room_id = rb.id order by rb.property_id, rb.floor, rb.room_no;
end $$;

create function public.report_rent_collection(p_from date, p_to date, p_property text default null, p_floor int default null,
                                              p_room text default null, p_tenant uuid default null)
returns table (invoice_no text, property_id text, room_no text, tenant text, customer_id uuid, description text, kind text, due_date date,
               billed int, collected int, outstanding int, state text, paid_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  select b.invoice_no, bk.property_id, r.room_no, p.full_name, b.customer_id, b.description, b.kind, b.due_date, b.amount, b.amount_paid,
         case when b.status = 'unpaid' then b.amount - b.amount_paid else 0 end, public.bill_state(b), b.paid_at
  from public.bills b join public.bookings bk on bk.id = b.booking_id join public.rooms r on r.id = bk.room_id
  join public.profiles p on p.id = b.customer_id
  where b.status <> 'void' and b.due_date between p_from and p_to and bk.property_id in (select public.report_scope(p_property))
    and (p_floor is null or r.floor = p_floor) and (p_room is null or r.id = p_room) and (p_tenant is null or b.customer_id = p_tenant)
  order by b.due_date, p.full_name;
end $$;

-- PRD 4.7 outstanding with ageing buckets
create function public.report_outstanding(p_property text default null, p_floor int default null, p_room text default null,
                                          p_tenant uuid default null, p_from date default null, p_to date default null)
returns table (bill_id uuid, invoice_no text, property_id text, room_no text, tenant text, customer_id uuid, phone text, month text,
               description text, due_date date, outstanding int, days_overdue int, bucket text, risk boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  select b.id, b.invoice_no, bk.property_id, r.room_no, p.full_name, b.customer_id, p.phone, to_char(coalesce(b.period_start, b.due_date), 'YYYY-MM'),
         b.description, b.due_date, b.amount - b.amount_paid, greatest(current_date - b.due_date, 0),
         case when current_date - b.due_date <= 7 then '0-7' when current_date - b.due_date <= 15 then '8-15'
              when current_date - b.due_date <= 30 then '16-30' else '30+' end,
         coalesce(t.risk_flag, false)
  from public.bills b join public.bookings bk on bk.id = b.booking_id join public.rooms r on r.id = bk.room_id
  join public.profiles p on p.id = b.customer_id left join public.tenant_profiles t on t.user_id = b.customer_id
  where b.status = 'unpaid' and b.amount > b.amount_paid and bk.property_id in (select public.report_scope(p_property))
    and (p_floor is null or r.floor = p_floor) and (p_room is null or r.id = p_room) and (p_tenant is null or b.customer_id = p_tenant)
    and (p_from is null or b.due_date >= p_from) and (p_to is null or b.due_date <= p_to)
  order by b.due_date, p.full_name;
end $$;

create function public.report_expenses(p_from date, p_to date, p_property text default null)
returns table (id uuid, property_id text, spent_on date, category text, grp text, amount int, vendor text, payment_mode text,
               status text, source text, notes text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  select x.id, x.property_id, x.spent_on, c.name, c.grp, x.amount, x.vendor, x.payment_mode, x.status, x.source, x.notes
  from public.expenses x join public.expense_categories c on c.id = x.category_id
  where x.spent_on between p_from and p_to and x.property_id in (select public.report_scope(p_property))
  order by x.spent_on, c.name;
end $$;

-- PRD 5.3 monthly P&L, per property and combined (property_id = 'ALL')
create function public.report_profit_loss(p_from date, p_to date, p_property text default null)
returns table (month date, property_id text, rent numeric, charges numeric, late_fees numeric, deposits_kept numeric, other_income numeric,
               total_income numeric, utilities numeric, salaries numeric, maintenance numeric, food numeric, other_expense numeric,
               total_expense numeric, profit numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  with inc as (select date_trunc('month', day)::date mo, i.property_id pid, category, sum(i.amount) amt
               from public.income_lines(p_from, p_to, p_property) i group by 1, 2, 3),
  ex as (select date_trunc('month', x.spent_on)::date mo, x.property_id pid, c.grp, sum(x.amount) amt
         from public.expenses x join public.expense_categories c on c.id = x.category_id
         where x.status = 'approved' and x.spent_on between p_from and p_to and x.property_id in (select public.report_scope(p_property))
         group by 1, 2, 3),
  keys as (select mo, pid from inc union select mo, pid from ex),
  per as (
    select k.mo, k.pid,
      round(coalesce((select sum(amt) from inc where inc.mo = k.mo and inc.pid = k.pid and category = 'rent'), 0)) r,
      round(coalesce((select sum(amt) from inc where inc.mo = k.mo and inc.pid = k.pid and category = 'charges'), 0)) ch,
      round(coalesce((select sum(amt) from inc where inc.mo = k.mo and inc.pid = k.pid and category = 'late_fees'), 0)) lf,
      round(coalesce((select sum(amt) from inc where inc.mo = k.mo and inc.pid = k.pid and category = 'deposits_kept'), 0)) dk,
      round(coalesce((select sum(amt) from inc where inc.mo = k.mo and inc.pid = k.pid and category = 'other_income'), 0)) oi,
      coalesce((select sum(amt) from ex where ex.mo = k.mo and ex.pid = k.pid and grp = 'utilities'), 0) u,
      coalesce((select sum(amt) from ex where ex.mo = k.mo and ex.pid = k.pid and grp = 'salaries'), 0) s,
      coalesce((select sum(amt) from ex where ex.mo = k.mo and ex.pid = k.pid and grp = 'maintenance'), 0) mt,
      coalesce((select sum(amt) from ex where ex.mo = k.mo and ex.pid = k.pid and grp = 'food'), 0) f,
      coalesce((select sum(amt) from ex where ex.mo = k.mo and ex.pid = k.pid and grp = 'other'), 0) o
    from keys k),
  rows as (
    select mo, pid, r, ch, lf, dk, oi, u, s, mt, f, o from per
    union all
    select mo, 'ALL', sum(r), sum(ch), sum(lf), sum(dk), sum(oi), sum(u), sum(s), sum(mt), sum(f), sum(o) from per group by mo)
  select mo, pid, r, ch, lf, dk, oi, r + ch + lf + dk + oi, u, s, mt, f, o, u + s + mt + f + o, (r + ch + lf + dk + oi) - (u + s + mt + f + o)
  from rows order by mo, pid = 'ALL', pid;
end $$;

create function public.report_checkins(p_from date, p_to date, p_property text default null, p_tenant uuid default null)
returns table (event text, event_date date, property_id text, room_no text, tenant text, customer_id uuid, rent int, deposit int,
               source text, notice_date date, booking_status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  select 'check-in', bk.check_in, bk.property_id, r.room_no, p.full_name, bk.customer_id, bk.rate, bk.deposit, bk.source, bk.notice_date, bk.status
  from public.bookings bk join public.rooms r on r.id = bk.room_id join public.profiles p on p.id = bk.customer_id
  where bk.status in ('active', 'completed') and bk.check_in between p_from and p_to and bk.property_id in (select public.report_scope(p_property))
    and (p_tenant is null or bk.customer_id = p_tenant)
  union all
  select case when bk.actual_checkout is not null then 'check-out' else 'planned check-out' end,
         coalesce(bk.actual_checkout, bk.expected_checkout), bk.property_id, r.room_no, p.full_name, bk.customer_id, bk.rate, bk.deposit,
         bk.source, bk.notice_date, bk.status
  from public.bookings bk join public.rooms r on r.id = bk.room_id join public.profiles p on p.id = bk.customer_id
  where coalesce(bk.actual_checkout, bk.expected_checkout) between p_from and p_to and bk.status in ('active', 'completed')
    and bk.property_id in (select public.report_scope(p_property)) and (p_tenant is null or bk.customer_id = p_tenant)
  order by 2;
end $$;

create function public.report_deposits(p_property text default null, p_tenant uuid default null)
returns table (property_id text, tenant text, customer_id uuid, room_no text, amount int, received int, received_on date, mode text,
               status text, deducted int, refunded int, refunded_on date, held int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  select d.property_id, p.full_name, d.customer_id, r.room_no, d.amount, d.received_amount, d.received_on, d.mode, d.status,
         coalesce((select sum((x ->> 'amount')::int) from jsonb_array_elements(d.deductions) x), 0)::int, d.refund_amount, d.refunded_on,
         case when d.status in ('held', 'pending') then d.received_amount - d.refund_amount else 0 end
  from public.security_deposits d join public.profiles p on p.id = d.customer_id join public.bookings bk on bk.id = d.booking_id
  join public.rooms r on r.id = bk.room_id
  where d.property_id in (select public.report_scope(p_property)) and (p_tenant is null or d.customer_id = p_tenant)
    and bk.status in ('active', 'completed')
  order by d.property_id, p.full_name;
end $$;

create function public.report_complaints(p_from date, p_to date, p_property text default null, p_room text default null)
returns table (ticket_no bigint, property_id text, room_no text, category text, title text, priority text, status text, created date,
               resolved timestamptz, resolution_hours numeric, overdue boolean, assignee text, cost int, rating int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  select c.ticket_no, c.property_id, r.room_no, c.category, c.title, c.priority, c.status, public.ist_date(c.created_at), c.resolved_at,
         round((extract(epoch from c.resolved_at - c.created_at) / 3600)::numeric, 1),
         (c.status in ('new', 'assigned', 'in_progress') and c.due_at < now()) or (c.resolved_at > c.due_at),
         coalesce(pa.full_name, v.name, sm.full_name), c.cost, c.rating
  from public.complaints c left join public.rooms r on r.id = c.room_id left join public.profiles pa on pa.id = c.assigned_to
  left join public.vendors v on v.id = c.vendor_id left join public.staff_members sm on sm.id = c.staff_member_id
  where public.ist_date(c.created_at) between p_from and p_to and c.property_id in (select public.report_scope(p_property))
    and (p_room is null or c.room_id = p_room)
  order by c.created_at;
end $$;

-- PRD 7.2 [Should] 12-month trend with seasonal view and enquiry conversion
create function public.report_trends(p_property text default null, p_months int default 12)
returns table (month date, occupancy_pct numeric, revenue numeric, expenses numeric, profit numeric, enquiries int, bookings int,
               conversion_pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_first date := (date_trunc('month', current_date) - make_interval(months => least(greatest(p_months, 1), 36) - 1))::date;
begin
  perform public.require_reports();
  return query
  with months as (select generate_series(v_first, date_trunc('month', current_date)::date, interval '1 month')::date mo),
  beds as (select count(*) n from public.beds b join public.rooms r on r.id = b.room_id where b.is_active and r.is_active
           and r.property_id in (select public.report_scope(p_property))),
  inc as (select date_trunc('month', day)::date mo, sum(amount) amt from public.income_lines(v_first, current_date, p_property) group by 1),
  ex as (select date_trunc('month', spent_on)::date mo, sum(amount) amt from public.expenses where status = 'approved'
         and spent_on >= v_first and property_id in (select public.report_scope(p_property)) group by 1),
  enq as (select date_trunc('month', public.ist_date(received_at))::date mo, count(*) n, count(*) filter (where status = 'booked') b
          from public.enquiries where received_at >= v_first and (p_property is null or property_id = p_property)
            and (property_id is null or property_id in (select public.report_scope(p_property))) group by 1)
  select m.mo,
    round(100.0 * (select coalesce(sum(public.booking_units(bk.id) * greatest(0,
        least(coalesce(bk.actual_checkout, bk.check_out, (m.mo + interval '1 month')::date), (m.mo + interval '1 month')::date, current_date + 1)
        - greatest(bk.check_in, m.mo))), 0)
      from public.bookings bk where bk.status in ('active', 'completed') and bk.property_id in (select public.report_scope(p_property)))
      / nullif((select n from beds) * (least((m.mo + interval '1 month')::date, current_date + 1) - m.mo), 0), 1),
    round(coalesce(i.amt, 0)), coalesce(x.amt, 0)::numeric, round(coalesce(i.amt, 0) - coalesce(x.amt, 0)),
    coalesce(q.n, 0)::int, coalesce(q.b, 0)::int, round(100.0 * coalesce(q.b, 0) / nullif(q.n, 0), 1)
  from months m left join inc i on i.mo = m.mo left join ex x on x.mo = m.mo left join enq q on q.mo = m.mo order by m.mo;
end $$;

-- ---------------------------------------------------------------- sales reports (PRD 9.5)
create function public.report_lead_funnel(p_from date, p_to date, p_property text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if auth.uid() is not null and not public.is_sales_team() then raise exception 'Not allowed' using errcode = '42501'; end if;
  with e as (select * from public.enquiries x where public.ist_date(x.received_at) between p_from and p_to
             and (p_property is null or x.property_id = p_property) and public.can_see_enquiry(x) and x.duplicate_of is null)
  select jsonb_build_object(
    'enquiries', count(*),
    'contacted', count(*) filter (where status <> 'new' or exists (select 1 from public.enquiry_activities a where a.enquiry_id = e.id and a.kind in ('call', 'whatsapp', 'sms', 'email'))),
    'visited', count(*) filter (where status in ('visited', 'negotiation', 'booked') or exists (select 1 from public.site_visits v where v.enquiry_id = e.id and v.status = 'visited')),
    'booked', count(*) filter (where status = 'booked'),
    'lost', count(*) filter (where status = 'lost'),
    'lost_reasons', coalesce((select jsonb_object_agg(lost_reason, n) from (select lost_reason, count(*) n from e where status = 'lost' group by 1) l), '{}'),
    'avg_days_to_close', round(avg(extract(epoch from converted_at - received_at) / 86400) filter (where status = 'booked')::numeric, 1))
  into r from e;
  return r || jsonb_build_object('conversion_pct', case when (r ->> 'enquiries')::int > 0
    then round(100.0 * (r ->> 'booked')::int / (r ->> 'enquiries')::int, 1) else 0 end);
end $$;

create function public.report_lead_sources(p_from date, p_to date, p_property text default null)
returns table (dimension text, name text, leads int, bookings int, spend int, cost_per_lead numeric, cost_per_booking numeric, conversion_pct numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_sales_team() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
  with e as (select * from public.enquiries x where public.ist_date(x.received_at) between p_from and p_to
             and (p_property is null or x.property_id = p_property) and public.can_see_enquiry(x) and x.duplicate_of is null),
  spend_src as (select c.channel, sum(x.amount) amt from public.expenses x join public.campaigns c on c.id = x.campaign_id
                where x.status = 'approved' and x.spent_on between p_from and p_to group by 1),
  src as (select e.source s, count(*)::int l, count(*) filter (where status = 'booked')::int b from e group by 1),
  camp as (select c.id, c.name, count(e.id)::int l, count(e.id) filter (where e.status = 'booked')::int b,
                  coalesce((select sum(x.amount) from public.expenses x where x.campaign_id = c.id and x.status = 'approved'
                            and x.spent_on between p_from and p_to), 0)::int sp
           from public.campaigns c left join e on e.campaign_id = c.id
           where c.start_date <= p_to and (c.end_date is null or c.end_date >= p_from) group by c.id, c.name)
  select 'source', replace(src.s, '_', ' '), src.l, src.b, coalesce(ss.amt, 0)::int,
         round(coalesce(ss.amt, 0)::numeric / nullif(src.l, 0), 0), round(coalesce(ss.amt, 0)::numeric / nullif(src.b, 0), 0),
         round(100.0 * src.b / nullif(src.l, 0), 1)
  from src left join spend_src ss on ss.channel = src.s
  union all
  select 'campaign', camp.name, camp.l, camp.b, camp.sp, round(camp.sp::numeric / nullif(camp.l, 0), 0),
         round(camp.sp::numeric / nullif(camp.b, 0), 0), round(100.0 * camp.b / nullif(camp.l, 0), 1)
  from camp
  order by 1, 3 desc;
end $$;

create function public.report_executives(p_from date, p_to date)
returns table (user_id uuid, name text, leads int, contacted int, calls int, follow_ups_done int, follow_ups_overdue int, visits int,
               bookings int, conversion_pct numeric, avg_days_to_close numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager_or_owner() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
  select p.id, p.full_name,
    (select count(*)::int from public.enquiries e where e.assigned_to = p.id and public.ist_date(e.received_at) between p_from and p_to),
    (select count(*)::int from public.enquiries e where e.assigned_to = p.id and e.status <> 'new' and public.ist_date(e.received_at) between p_from and p_to),
    (select count(*)::int from public.enquiry_activities a where a.created_by = p.id and a.kind = 'call' and public.ist_date(a.created_at) between p_from and p_to),
    (select count(*)::int from public.follow_ups f where f.assigned_to = p.id and f.done_at is not null and public.ist_date(f.done_at) between p_from and p_to),
    (select count(*)::int from public.follow_ups f where f.assigned_to = p.id and f.done_at is null and f.due_at < now()),
    (select count(*)::int from public.site_visits v join public.enquiries e on e.id = v.enquiry_id where e.assigned_to = p.id
       and v.status = 'visited' and public.ist_date(v.scheduled_at) between p_from and p_to),
    (select count(*)::int from public.enquiries e where e.assigned_to = p.id and e.status = 'booked' and public.ist_date(e.converted_at) between p_from and p_to),
    round(100.0 * (select count(*) from public.enquiries e where e.assigned_to = p.id and e.status = 'booked' and public.ist_date(e.received_at) between p_from and p_to)
          / nullif((select count(*) from public.enquiries e where e.assigned_to = p.id and public.ist_date(e.received_at) between p_from and p_to), 0), 1),
    (select round(avg(extract(epoch from e.converted_at - e.received_at) / 86400)::numeric, 1) from public.enquiries e
       where e.assigned_to = p.id and e.status = 'booked' and public.ist_date(e.converted_at) between p_from and p_to)
  from public.profiles p where p.role in ('sales', 'manager', 'admin') and p.is_active
    and (public.is_admin() or exists (select 1 from public.property_members m where m.user_id = p.id and public.can_manage_property(m.property_id)))
  order by p.full_name;
end $$;

-- [Should] forecast: occupied now - planned check-outs + expected conversions from the open pipeline
create function public.report_forecast(p_property text default null, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare beds int; occ int; outs int; rate numeric; hot int; warm int; expected numeric;
begin
  perform public.require_reports();
  select count(*), count(*) filter (where b.is_occupied) into beds, occ from public.beds b join public.rooms r on r.id = b.room_id
  where b.is_active and r.is_active and r.property_id in (select public.report_scope(p_property));
  select coalesce(sum(public.booking_units(id)), 0) into outs from public.bookings where status = 'active'
    and expected_checkout between current_date and current_date + p_days and property_id in (select public.report_scope(p_property));
  select coalesce(count(*) filter (where status = 'booked')::numeric / nullif(count(*), 0), 0) into rate from public.enquiries
  where received_at > now() - interval '180 days' and duplicate_of is null and (p_property is null or property_id = p_property);
  select count(*) filter (where temperature = 'hot'), count(*) filter (where temperature = 'warm') into hot, warm
  from public.enquiries where status not in ('booked', 'lost') and duplicate_of is null and (p_property is null or property_id = p_property)
    and (move_in is null or move_in <= current_date + p_days);
  expected := round(hot * least(rate * 2, 0.9) + warm * rate, 1);
  return jsonb_build_object('beds', beds, 'occupied_now', occ, 'planned_checkouts', outs, 'conversion_rate', round(rate * 100, 1),
    'hot_leads', hot, 'warm_leads', warm, 'expected_new', expected,
    'forecast_occupied', least(beds, greatest(occ - outs + expected, 0)),
    'forecast_pct', case when beds > 0 then round(100.0 * least(beds, greatest(occ - outs + expected, 0)) / beds, 1) else 0 end);
end $$;

-- ---------------------------------------------------------------- employee reports (PRD 10.5)
create function public.report_attendance(p_from date, p_to date, p_property text default null)
returns table (staff_id uuid, name text, designation text, property_id text, present int, half_days int, leave int, absent int,
               weekly_off int, overtime_hours numeric, self_check_ins int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  select s.id, s.full_name, s.designation, s.property_id,
    count(a.*) filter (where a.status = 'present')::int, count(a.*) filter (where a.status = 'half_day')::int,
    count(a.*) filter (where a.status = 'leave')::int, count(a.*) filter (where a.status = 'absent')::int,
    count(a.*) filter (where a.status = 'weekly_off')::int, coalesce(sum(a.overtime_hours), 0), count(a.*) filter (where a.source = 'self')::int
  from public.staff_members s left join public.attendance a on a.staff_id = s.id and a.work_date between p_from and p_to
  where s.property_id in (select public.report_scope(p_property)) group by s.id order by s.property_id, s.full_name;
end $$;

create function public.report_salaries(p_from date, p_to date, p_property text default null)
returns table (month date, property_id text, staff_id uuid, name text, designation text, payable_days numeric, gross int, pf int, esi int,
               advance_recovery int, deductions int, net int, status text, paid_on date)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  select p.month, p.property_id, s.id, s.full_name, s.designation, p.payable_days, p.gross, p.pf, p.esi, p.advance_recovery, p.other_deductions,
         p.net, p.status, p.paid_on
  from public.payslips p join public.staff_members s on s.id = p.staff_id
  where p.month between date_trunc('month', p_from)::date and p_to and p.property_id in (select public.report_scope(p_property))
  order by p.month, p.property_id, s.full_name;
end $$;

create function public.report_advances(p_property text default null)
returns table (staff_id uuid, name text, property_id text, kind text, given_on date, amount int, recovered int, outstanding int, instalment int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  select s.id, s.full_name, s.property_id, a.kind, a.given_on, a.amount, a.recovered, a.amount - a.recovered, a.instalment
  from public.salary_advances a join public.staff_members s on s.id = a.staff_id
  where a.status = 'open' and s.property_id in (select public.report_scope(p_property)) order by s.full_name, a.given_on;
end $$;

create function public.report_leave(p_year int, p_property text default null)
returns table (staff_id uuid, name text, property_id text, paid_taken numeric, sick_taken numeric, casual_taken numeric, unpaid_taken numeric,
               paid_left numeric, sick_left numeric, casual_left numeric, pending int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  select s.id, s.full_name, s.property_id,
    coalesce(sum(l.days) filter (where l.leave_type = 'paid' and l.status = 'approved'), 0),
    coalesce(sum(l.days) filter (where l.leave_type = 'sick' and l.status = 'approved'), 0),
    coalesce(sum(l.days) filter (where l.leave_type = 'casual' and l.status = 'approved'), 0),
    coalesce(sum(l.days) filter (where l.leave_type = 'unpaid' and l.status = 'approved'), 0),
    s.paid_leave_quota - coalesce(sum(l.days) filter (where l.leave_type = 'paid' and l.status = 'approved'), 0),
    s.sick_leave_quota - coalesce(sum(l.days) filter (where l.leave_type = 'sick' and l.status = 'approved'), 0),
    s.casual_leave_quota - coalesce(sum(l.days) filter (where l.leave_type = 'casual' and l.status = 'approved'), 0),
    count(l.*) filter (where l.status = 'pending')::int
  from public.staff_members s left join public.leave_requests l on l.staff_id = s.id and extract(year from l.from_date) = p_year
  where s.property_id in (select public.report_scope(p_property)) group by s.id order by s.full_name;
end $$;

create function public.report_staff_performance(p_from date, p_to date, p_property text default null)
returns table (staff_id uuid, name text, designation text, tasks int, tasks_done_on_time int, complaints_resolved int,
               avg_resolution_hours numeric, avg_rating numeric, staff_cost int, revenue numeric, cost_pct_of_revenue numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  with rev as (select property_id, sum(amount) amt from public.income_lines(p_from, p_to, p_property) group by 1)
  select s.id, s.full_name, s.designation,
    (select count(*)::int from public.staff_tasks t where t.staff_id = s.id and t.task_date between p_from and p_to),
    (select count(*)::int from public.staff_tasks t where t.staff_id = s.id and t.task_date between p_from and p_to
       and t.done_at is not null and public.ist_date(t.done_at) = t.task_date),
    (select count(*)::int from public.complaints c where (c.assigned_to = s.user_id or c.staff_member_id = s.id)
       and c.status in ('resolved', 'closed') and public.ist_date(c.resolved_at) between p_from and p_to),
    (select round(avg(extract(epoch from c.resolved_at - c.created_at) / 3600)::numeric, 1) from public.complaints c
       where (c.assigned_to = s.user_id or c.staff_member_id = s.id) and public.ist_date(c.resolved_at) between p_from and p_to),
    (select round(avg(c.rating)::numeric, 1) from public.complaints c where (c.assigned_to = s.user_id or c.staff_member_id = s.id)
       and c.rating is not null and public.ist_date(c.resolved_at) between p_from and p_to),
    (select coalesce(sum(p.gross), 0)::int from public.payslips p where p.staff_id = s.id and p.month between date_trunc('month', p_from)::date and p_to),
    round(coalesce((select amt from rev where rev.property_id = s.property_id), 0)),
    round(100.0 * (select coalesce(sum(p.gross), 0) from public.payslips p where p.staff_id = s.id and p.month between date_trunc('month', p_from)::date and p_to)
          / nullif((select amt from rev where rev.property_id = s.property_id), 0), 1)
  from public.staff_members s where s.property_id in (select public.report_scope(p_property)) and s.status = 'active'
  order by s.full_name;
end $$;

-- [Should] staff cost as % of revenue per property
create function public.report_staff_cost(p_from date, p_to date, p_property text default null)
returns table (property_id text, staff_cost int, revenue numeric, cost_pct numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  with rev as (select i.property_id pid, sum(i.amount) amt from public.income_lines(p_from, p_to, p_property) i group by 1),
  cost as (select x.property_id pid, sum(x.amount) amt from public.expenses x where x.category_id in ('salaries', 'housekeeping')
           and x.status = 'approved' and x.spent_on between p_from and p_to and x.property_id in (select public.report_scope(p_property)) group by 1)
  select p.id, coalesce(c.amt, 0)::int, round(coalesce(r.amt, 0)), round(100.0 * coalesce(c.amt, 0) / nullif(r.amt, 0), 1)
  from public.properties p left join rev r on r.pid = p.id left join cost c on c.pid = p.id
  where p.id in (select public.report_scope(p_property)) order by p.id;
end $$;

create function public.report_deposits_held(p_property text default null)
returns table (property_id text, deposits int, held int, pending int, refunded int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_reports();
  return query
  select d.property_id, count(*)::int, coalesce(sum(d.received_amount - d.refund_amount) filter (where d.status = 'held'), 0)::int,
         coalesce(sum(d.amount) filter (where d.status = 'pending'), 0)::int, coalesce(sum(d.refund_amount), 0)::int
  from public.security_deposits d join public.bookings b on b.id = d.booking_id
  where d.property_id in (select public.report_scope(p_property)) and b.status in ('active', 'completed', 'pending')
  group by d.property_id order by 1;
end $$;

-- ---------------------------------------------------------------- scheduled jobs
create table public.job_runs (
  id         bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  result     jsonb not null default '{}',
  triggered_by uuid
);
alter table public.job_runs enable row level security;
grant select on public.job_runs to authenticated;
create policy job_runs_read on public.job_runs for select using (public.is_manager_or_owner());

create function public.release_expired_reservations() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select rv.*, b.code, ro.property_id from public.reservations rv join public.beds b on b.id = rv.bed_id
           join public.rooms ro on ro.id = b.room_id where rv.status = 'active' and rv.expires_on < current_date loop
    update public.reservations set status = 'released', closed_at = now() where id = r.id;
    perform public.alert_managers(r.property_id, 'reservation', 'Reservation released: ' || r.code,
      r.tenant_name || ' did not check in by ' || to_char(r.expires_on, 'DD Mon') || '. Advance held: Rs ' || r.advance_amount,
      '/admin/beds', 'resv-released:' || r.id, 'reservation', r.id::text);
    n := n + 1;
  end loop;
  return n;
end $$;

create function public.run_agreement_alerts() returns int
language plpgsql security definer set search_path = public as $$
declare a record; n int := 0;
begin
  update public.agreements set status = 'expired' where status = 'active' and end_date < current_date;
  for a in select ag.*, p.full_name from public.agreements ag join public.profiles p on p.id = ag.customer_id
           join public.bookings b on b.id = ag.booking_id
           where ag.status in ('active', 'sent') and b.status = 'active' and ag.expiry_alerted_at is null
             and ag.end_date between current_date and current_date + 30 loop
    perform public.alert_managers(a.property_id, 'agreement', 'Agreement ends ' || to_char(a.end_date, 'DD Mon YYYY'),
      a.full_name || '''s agreement is due for renewal.', '/admin/tenants/' || a.customer_id, 'agr-expiry:' || a.id, 'agreement', a.id::text);
    update public.agreements set expiry_alerted_at = now() where id = a.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- on the 1st of each month: last month's summary emailed to every owner (PRD 7.2)
create function public.queue_monthly_owner_report() returns int
language plpgsql security definer set search_path = public as $$
declare m date := (date_trunc('month', current_date) - interval '1 month')::date; e date := (date_trunc('month', current_date) - interval '1 day')::date;
  u record; body text; inc numeric; ex numeric; occ jsonb; n int := 0;
begin
  if extract(day from current_date) > 3 then return 0; end if;
  select coalesce(sum(amount), 0) into inc from public.income_lines(m, e, null);
  select coalesce(sum(amount), 0) into ex from public.expenses where status = 'approved' and spent_on between m and e;
  body := 'YOLO Nest summary for ' || to_char(m, 'Month YYYY') || E'\n' ||
    'Income collected: Rs ' || round(inc) || E'\nExpenses: Rs ' || ex || E'\nNet operating profit: Rs ' || round(inc - ex) || E'\n' ||
    'Outstanding dues today: Rs ' || coalesce((select sum(amount - amount_paid) from public.bills where status = 'unpaid' and kind <> 'deposit'), 0) || E'\n' ||
    'Occupied beds today: ' || (select count(*) from public.beds where is_occupied) || ' of ' || (select count(*) from public.beds where is_active) || E'\n' ||
    'Open complaints: ' || (select count(*) from public.complaints where status in ('new', 'assigned', 'in_progress')) || E'\n' ||
    'New enquiries: ' || (select count(*) from public.enquiries where public.ist_date(received_at) between m and e) || E'\n' ||
    'Full reports: ' || coalesce(public.setting('site_url') #>> '{}', '') || '/admin/reports';
  for u in select id from public.profiles where role = 'admin' and is_active loop
    perform public.notify(u.id, array['email', 'in_app'], 'report', 'Monthly report: ' || to_char(m, 'Mon YYYY'), body, '/admin/reports',
                          'monthly-report:' || m || ':' || u.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- One entry point for every timed rule. Idempotent, so running it often is safe. Called by pg_cron (if present),
-- by the Render cron / Edge Function scheduler, and by the admin console on open (at most every 30 minutes).
create function public.run_scheduled_jobs(p_force boolean default false) returns jsonb
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
    'owner_report', public.queue_monthly_owner_report());
  perform public.refresh_risk_flags();
  insert into public.job_runs (result, triggered_by) values (res, auth.uid());
  return res;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('yolo-nest-jobs', '*/30 * * * *', 'select public.run_scheduled_jobs(true)');
  end if;
end $$;

revoke all on function public.report_scope(text), public.require_reports(), public.income_lines(date, date, text),
  public.owner_dashboard(text), public.report_occupancy(date, date, text, int, text),
  public.report_rent_collection(date, date, text, int, text, uuid), public.report_outstanding(text, int, text, uuid, date, date),
  public.report_expenses(date, date, text), public.report_profit_loss(date, date, text), public.report_checkins(date, date, text, uuid),
  public.report_deposits(text, uuid), public.report_complaints(date, date, text, text), public.report_trends(text, int),
  public.report_lead_funnel(date, date, text), public.report_lead_sources(date, date, text), public.report_executives(date, date),
  public.report_forecast(text, int), public.report_attendance(date, date, text), public.report_salaries(date, date, text),
  public.report_advances(text), public.report_leave(int, text), public.report_staff_performance(date, date, text),
  public.report_staff_cost(date, date, text), public.report_deposits_held(text), public.release_expired_reservations(),
  public.run_agreement_alerts(), public.queue_monthly_owner_report(), public.run_scheduled_jobs(boolean)
from public, anon;
revoke all on function public.release_expired_reservations(), public.run_agreement_alerts(), public.queue_monthly_owner_report()
from authenticated;
grant execute on function public.release_expired_reservations(), public.run_agreement_alerts(), public.queue_monthly_owner_report(),
  public.release_expired_holds() to service_role;
grant execute on function public.report_scope(text), public.require_reports(), public.income_lines(date, date, text),
  public.owner_dashboard(text), public.report_occupancy(date, date, text, int, text),
  public.report_rent_collection(date, date, text, int, text, uuid), public.report_outstanding(text, int, text, uuid, date, date),
  public.report_expenses(date, date, text), public.report_profit_loss(date, date, text), public.report_checkins(date, date, text, uuid),
  public.report_deposits(text, uuid), public.report_complaints(date, date, text, text), public.report_trends(text, int),
  public.report_lead_funnel(date, date, text), public.report_lead_sources(date, date, text), public.report_executives(date, date),
  public.report_forecast(text, int), public.report_attendance(date, date, text), public.report_salaries(date, date, text),
  public.report_advances(text), public.report_leave(int, text), public.report_staff_performance(date, date, text),
  public.report_staff_cost(date, date, text), public.report_deposits_held(text), public.run_scheduled_jobs(boolean)
to authenticated, service_role;
