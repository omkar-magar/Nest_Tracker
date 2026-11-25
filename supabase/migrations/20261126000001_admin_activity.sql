-- Owner-only views: the registration pipeline (who registered, which stage, who is handling it) and a recent-activity
-- feed grouped by area. Both are read-only and check is_admin() themselves.

-- Approvals from the register flow go into the activity log too, like set_tenant_approval does.
create or replace function public.approve_resident_registration(p_user uuid, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare t public.tenant_profiles; u public.profiles; gid bigint;
begin
  select * into u from public.profiles where id = p_user for update;
  select * into t from public.tenant_profiles where user_id = p_user for update;
  if not found then raise exception 'Registration not found'; end if;
  perform public.require_manage(t.property_id);
  if t.registration_state is distinct from 'pending' then raise exception 'Registration is no longer pending'; end if;
  if not exists (select 1 from public.rooms where property_id = t.property_id and is_active
    and (case when coalesce(wing, '') <> '' then wing || '-' || room_no else room_no end) = p ->> 'room_no') then
    raise exception 'Choose an active room in this property';
  end if;
  if nullif(p ->> 'rent', '') is null or nullif(p ->> 'deposit', '') is null
    or nullif(p ->> 'due_date', '') is null or nullif(p ->> 'check_in', '') is null then
    raise exception 'Rent, deposit, check-in and due date are required';
  end if;
  insert into public.register_guests(property_id, customer_id, room_no, name, contact, rent, deposit,
    check_in, expected_checkout, due_date, room_type, notes, sort_order)
  values (t.property_id, p_user, p ->> 'room_no', u.full_name, right(regexp_replace(u.phone, '\D', '', 'g'), 10),
    (p ->> 'rent')::int, (p ->> 'deposit')::int, (p ->> 'check_in')::date,
    nullif(p ->> 'expected_checkout', '')::date, (p ->> 'due_date')::date, coalesce(p ->> 'room_type', 'pg'),
    coalesce(p ->> 'notes', ''), coalesce((select max(sort_order) + 1 from public.register_guests where property_id = t.property_id), 0))
  returning id into gid;
  update public.tenant_profiles set registration_state = 'active', approval_status = 'approved',
    approved_by = auth.uid(), approved_at = now() where user_id = p_user;
  perform public.log_activity('tenant.approval', 'tenant', p_user::text,
    jsonb_build_object('status', 'approved', 'room_no', p ->> 'room_no', 'property_id', t.property_id));
  return gid;
end $$;

-- Stages: started (account, form not sent) -> waiting (sent, needs a manager) -> rejected | living -> ended.
-- "Handling": the managers the registration alert went to, and whether they have opened it.
-- Customers who have not picked a wing yet show under every wing filter.
create function public.admin_registrations(p_property text default null, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'Only the owner can see this' using errcode = '42501'; end if;
  with base as (
    select p.id, p.full_name, p.phone, p.created_at signed_up_at, t.property_id, t.approval_note,
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
        'room_no', g.room_no, 'check_in', g.check_in, 'checked_out_on', g.checked_out_on,
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

-- Recent activity for the owner, grouped by area. Each group: { count, items } with the newest `p_per` items of the
-- last `p_days` days. `open` marks items that still need someone to act.
create function public.admin_recent_activity(p_property text default null, p_days int default 7, p_per int default 8)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90));
  res jsonb;
begin
  if not public.is_admin() then raise exception 'Only the owner can see this' using errcode = '42501'; end if;
  with ev as (
    -- registrations: sent, approved, rejected
    select 'registrations' grp, 'submitted' kind, t.rules_accepted_at at, t.user_id::text ref, p.full_name name,
      '' detail, '' who, t.property_id, (t.registration_state = 'pending' and t.approval_status = 'pending') open, null::int amount
    from public.tenant_profiles t join public.profiles p on p.id = t.user_id
    where t.registration_state is not null and t.rules_accepted_at >= since
    union all
    select 'registrations', case t.approval_status when 'approved' then 'approved' else 'rejected' end, t.approved_at,
      t.user_id::text, p.full_name, coalesce(nullif(t.approval_note, ''), g.room_no, ''), coalesce(ap.full_name, ''), t.property_id, false, null
    from public.tenant_profiles t join public.profiles p on p.id = t.user_id
    left join public.profiles ap on ap.id = t.approved_by
    left join lateral (select room_no from public.register_guests rg where rg.customer_id = t.user_id order by rg.id desc limit 1) g on true
    where t.approval_status in ('approved', 'rejected') and t.approved_at >= since
    -- complaints: raised, resolved
    union all
    select 'complaints', 'raised', c.created_at, c.id::text, c.title,
      concat_ws(' · ', '#' || c.ticket_no, c.priority, case when coalesce(nullif(c.room_label, ''), r.room_no) is not null then 'Room ' || coalesce(nullif(c.room_label, ''), r.room_no) end),
      coalesce(cp.full_name, case when c.is_common_area then 'Common area' else '' end), c.property_id,
      c.status not in ('resolved', 'closed'), null
    from public.complaints c left join public.rooms r on r.id = c.room_id left join public.profiles cp on cp.id = c.customer_id
    where c.created_at >= since
    union all
    select 'complaints', 'resolved', c.resolved_at, c.id::text, c.title, '#' || c.ticket_no, c.fixed_by, c.property_id, false, null
    from public.complaints c where c.resolved_at >= since
    -- guest register: added, checked out, back again, removed
    union all
    select 'guests', lower(h.op), h.changed_at, h.guest_id::text, coalesce(h.new_row ->> 'name', h.old_row ->> 'name'),
      coalesce(h.new_row ->> 'room_no', h.old_row ->> 'room_no', ''), h.changed_by_name, h.property_id, false, null
    from public.register_history h
    where h.changed_at >= since and h.op in ('INSERT', 'CHECKOUT', 'RETURN', 'DELETE')
      and btrim(coalesce(h.new_row ->> 'name', h.old_row ->> 'name', '')) <> ''
    -- money: rent marked paid in the register, app payments, expenses added
    union all
    select 'money', 'rent_paid', h.changed_at, h.guest_id::text, h.new_row ->> 'name',
      'Room ' || (h.new_row ->> 'room_no'), h.changed_by_name, h.property_id, false, (h.new_row ->> 'rent')::int
    from public.register_history h
    where h.changed_at >= since and h.op = 'UPDATE'
      and h.new_row ->> 'rent_status' = 'paid' and h.old_row ->> 'rent_status' is distinct from 'paid'
    union all
    select 'money', 'payment', pm.completed_at, pm.customer_id::text, cp.full_name, '', '', b.property_id, false, pm.amount
    from public.payments pm join public.bills bl on bl.id = pm.bill_id join public.bookings b on b.id = bl.booking_id
    left join public.profiles cp on cp.id = pm.customer_id
    where pm.status = 'succeeded' and pm.completed_at >= since
    union all
    select 'money', 'expense', e.created_at, e.id::text, coalesce(ec.name, 'Expense'),
      e.vendor, coalesce(eb.full_name, ''), e.property_id, false, e.amount
    from public.expenses e left join public.expense_categories ec on ec.id = e.category_id
    left join public.profiles eb on eb.id = e.created_by
    where e.created_at >= since and e.status <> 'pending'
    -- submissions that wait for a decision: documents, leave, expenses to approve
    union all
    select 'submissions', 'document', d.created_at, d.customer_id::text, cp.full_name, replace(d.doc_type, '_', ' '),
      coalesce(ub.full_name, ''), t.property_id, d.status = 'pending', null
    from public.customer_documents d left join public.profiles cp on cp.id = d.customer_id
    left join public.profiles ub on ub.id = d.uploaded_by left join public.tenant_profiles t on t.user_id = d.customer_id
    where d.created_at >= since
    union all
    select 'submissions', 'leave', l.created_at, l.id::text, s.full_name,
      concat_ws(' · ', l.leave_type, l.days || ' day' || case when l.days = 1 then '' else 's' end, to_char(l.from_date, 'DD Mon'),
        case when l.status <> 'pending' then l.status end),
      '', s.property_id, l.status = 'pending', null
    from public.leave_requests l join public.staff_members s on s.id = l.staff_id
    where l.created_at >= since
    union all
    select 'submissions', 'expense', e.created_at, e.id::text, coalesce(ec.name, 'Expense'),
      e.vendor, coalesce(eb.full_name, ''), e.property_id, true, e.amount
    from public.expenses e left join public.expense_categories ec on ec.id = e.category_id
    left join public.profiles eb on eb.id = e.created_by
    where e.created_at >= since and e.status = 'pending'
    -- enquiries: new leads
    union all
    select 'enquiries', 'new', q.received_at, q.id::text, q.name, replace(q.source, '_', ' '), coalesce(ap.full_name, ''),
      q.property_id, q.status = 'new', null
    from public.enquiries q left join public.profiles ap on ap.id = q.assigned_to
    where q.received_at >= since and q.duplicate_of is null
  ), scoped as (
    select * from ev where at is not null and (p_property is null or property_id = p_property or property_id is null)
  ), ranked as (
    select *, row_number() over (partition by grp order by at desc) rn from scoped
  )
  select coalesce(jsonb_object_agg(grp, jsonb_build_object('count', n, 'open', o, 'items', items)), '{}') into res
  from (
    select grp, count(*) n, count(*) filter (where open) o,
      jsonb_agg(jsonb_build_object('kind', kind, 'at', at, 'ref', ref, 'name', coalesce(name, ''), 'detail', coalesce(detail, ''),
        'who', coalesce(who, ''), 'property_id', property_id, 'open', open, 'amount', amount) order by at desc)
        filter (where rn <= least(greatest(coalesce(p_per, 8), 1), 50)) items
    from ranked group by grp
  ) g;
  return res;
end $$;

revoke all on function public.admin_registrations(text, int), public.admin_recent_activity(text, int, int) from public, anon;
grant execute on function public.admin_registrations(text, int), public.admin_recent_activity(text, int, int) to authenticated;
