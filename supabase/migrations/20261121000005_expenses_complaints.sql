-- PRD 5 (expenses, recurring expenses, approval, other income) and PRD 6 (complaints, maintenance history,
-- preventive maintenance, vendors). Repair costs and (later) salaries and marketing spend land in expenses.

-- ---------------------------------------------------------------- expenses
create table public.expense_categories (
  id         text primary key,
  name       text not null,
  grp        text not null check (grp in ('utilities', 'salaries', 'maintenance', 'food', 'other')),
  is_system  boolean not null default false,       -- used by automatic links; cannot be deleted
  sort_order int not null default 100
);
insert into public.expense_categories (id, name, grp, is_system, sort_order) values
  ('electricity', 'Electricity bill', 'utilities', false, 1), ('water', 'Water', 'utilities', false, 2),
  ('internet', 'Internet / Wi-Fi', 'utilities', false, 3), ('gas', 'Gas', 'utilities', false, 4),
  ('dth', 'DTH / TV', 'utilities', false, 5),
  ('salaries', 'Staff salaries', 'salaries', true, 10), ('housekeeping', 'Housekeeping', 'salaries', false, 11),
  ('repairs', 'Repairs and maintenance', 'maintenance', true, 20),
  ('groceries', 'Groceries', 'food', false, 30), ('vegetables', 'Vegetables', 'food', false, 31),
  ('cooking_gas', 'Cooking gas', 'food', false, 32), ('kitchen', 'Kitchen supplies', 'food', false, 33),
  ('landlord_rent', 'Rent paid to landlord', 'other', false, 40), ('property_tax', 'Property tax', 'other', false, 41),
  ('licenses', 'Licences', 'other', false, 42), ('marketing', 'Marketing', 'other', true, 43),
  ('furniture', 'Furniture / purchases', 'other', false, 44), ('broker_commission', 'Broker commission', 'other', true, 45),
  ('misc', 'Miscellaneous', 'other', false, 99);

create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  property_id   text not null references public.properties (id),
  category_id   text not null references public.expense_categories (id),
  spent_on      date not null default current_date,
  amount        int not null check (amount > 0),
  vendor        text not null default '',
  payment_mode  text not null default 'cash' check (payment_mode in ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other')),
  notes         text not null default '',
  receipt_path  text,                                     -- expense-receipts bucket
  status        text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  source        text not null default 'manual' check (source in ('manual', 'recurring', 'complaint', 'salary', 'marketing', 'commission')),
  source_id     text,
  campaign_id   uuid,                                     -- fk added by the sales migration
  created_by    uuid references public.profiles (id) on delete set null,
  approved_by   uuid references public.profiles (id) on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index expenses_property_date_idx on public.expenses (property_id, spent_on);
create unique index expenses_source_key on public.expenses (source, source_id) where source_id is not null;

create table public.recurring_expenses (
  id             uuid primary key default gen_random_uuid(),
  property_id    text not null references public.properties (id),
  category_id    text not null references public.expense_categories (id),
  amount         int not null check (amount > 0),
  vendor         text not null default '',
  payment_mode   text not null default 'bank_transfer',
  day_of_month   int not null default 1 check (day_of_month between 1 and 28),
  notes          text not null default '',
  active         boolean not null default true,
  last_month     date,                                    -- first day of the last month created
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create table public.other_income (
  id          uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties (id),
  received_on date not null default current_date,
  amount      int not null check (amount > 0),
  source      text not null,                              -- e.g. vending machine, parking for visitors
  notes       text not null default '',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- manager entries above the limit wait for the owner (PRD 5.2)
insert into public.app_settings (key, value) values ('expense_approval_limit', '5000'::jsonb) on conflict (key) do nothing;

create function public.expense_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int := coalesce((public.setting('expense_approval_limit') #>> '{}')::int, 0);
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if auth.uid() is not null and not public.is_admin() then
      new.status := case when lim > 0 and new.amount > lim then 'pending' else 'approved' end;
      new.approved_by := null; new.approved_at := null;
    end if;
  elsif auth.uid() is not null and not public.is_admin() then
    -- managers cannot approve, and editing an approved entry above the limit sends it back for approval
    new.status := case when lim > 0 and new.amount > lim and (old.status <> 'approved' or new.amount <> old.amount) then 'pending'
                       when old.status = 'rejected' then 'pending' else old.status end;
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  return new;
end $$;
create trigger expenses_guard before insert or update on public.expenses for each row execute function public.expense_guard();

create function public.approve_expense(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Owner only' using errcode = '42501'; end if;
  update public.expenses set status = case when p_approve then 'approved' else 'rejected' end,
    approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform public.log_activity('expense.' || case when p_approve then 'approved' else 'rejected' end, 'expense', p_id::text, '{}');
end $$;

create function public.generate_recurring_expenses() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; m date := date_trunc('month', current_date)::date;
begin
  for r in select * from public.recurring_expenses where active and (last_month is null or last_month < m)
           and extract(day from current_date) >= day_of_month loop
    insert into public.expenses (property_id, category_id, spent_on, amount, vendor, payment_mode, notes, source, source_id, created_by)
    values (r.property_id, r.category_id, make_date(extract(year from m)::int, extract(month from m)::int, r.day_of_month),
            r.amount, r.vendor, r.payment_mode, r.notes, 'recurring', r.id || ':' || m, r.created_by)
    on conflict do nothing;
    update public.recurring_expenses set last_month = m where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- complaints
create table public.vendors (
  id          uuid primary key default gen_random_uuid(),
  property_id text references public.properties (id),     -- null = works for every property
  name        text not null,
  trade       text not null default '',                     -- electrician, plumber, AC service, ...
  phone       text not null default '',
  notes       text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.complaints (
  id              uuid primary key default gen_random_uuid(),
  ticket_no       bigint generated always as identity unique,
  property_id     text not null references public.properties (id),
  room_id         text references public.rooms (id) on delete set null,
  bed_id          uuid references public.beds (id) on delete set null,
  customer_id     uuid references public.profiles (id) on delete set null,   -- null for common-area issues
  is_common_area  boolean not null default false,
  category        text not null check (category in ('electrical', 'plumbing', 'wifi', 'housekeeping', 'food', 'ac_appliances',
                                                    'furniture', 'security', 'noise', 'preventive', 'other')),
  title           text not null check (char_length(title) between 3 and 120),
  description     text not null default '',
  photos          text[] not null default '{}',     -- complaint-media bucket (photos or short videos)
  after_photos    text[] not null default '{}',
  preferred_time  text not null default '',
  priority        text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status          text not null default 'new' check (status in ('new', 'assigned', 'in_progress', 'resolved', 'closed')),
  assigned_to     uuid references public.profiles (id) on delete set null,     -- staff login
  staff_member_id uuid,                                                        -- staff without a login (HR migration)
  vendor_id       uuid references public.vendors (id) on delete set null,
  due_at          timestamptz,
  resolved_at     timestamptz,
  closed_at       timestamptz,
  resolution      text not null default '',
  fixed_by        text not null default '',
  cost            int not null default 0 check (cost >= 0),
  rating          int check (rating between 1 and 5),
  feedback        text not null default '',
  escalated_at    timestamptz,
  reopen_count    int not null default 0,
  schedule_id     uuid,                             -- preventive maintenance that created it
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index complaints_property_status_idx on public.complaints (property_id, status);
create index complaints_customer_idx on public.complaints (customer_id);
create index complaints_assignee_idx on public.complaints (assigned_to) where status in ('assigned', 'in_progress');

create table public.complaint_events (
  id           bigint generated always as identity primary key,
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  from_status  text,
  to_status    text,
  note         text not null default '',
  created_at   timestamptz not null default now()
);
create index complaint_events_idx on public.complaint_events (complaint_id, created_at);

create table public.maintenance_schedules (
  id            uuid primary key default gen_random_uuid(),
  property_id   text not null references public.properties (id),
  title         text not null,                     -- AC servicing, water tank cleaning, pest control, fire extinguisher check
  category      text not null default 'preventive',
  interval_days int not null check (interval_days between 1 and 730),
  next_due      date not null,
  remind_days   int not null default 3 check (remind_days between 0 and 60),
  assigned_to   uuid references public.profiles (id) on delete set null,
  vendor_id     uuid references public.vendors (id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- SLA: expected completion time by priority (hours)
insert into public.app_settings (key, value) values
  ('complaint_sla_hours', '{"low":72,"medium":48,"high":24,"urgent":4}'::jsonb)
on conflict (key) do nothing;

create function public.complaint_notify(c public.complaints, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare t record; label text := replace(c.status, '_', ' '); tp public.tenant_profiles%rowtype;
begin
  select * into t from public.render_template('complaint_update',
    jsonb_build_object('title', c.title, 'status', label, 'note', coalesce(p_note, '')));
  if c.customer_id is not null then
    perform public.notify(c.customer_id, array['in_app', 'push'], 'complaint', t.subject, t.body,
      '/account#complaints', 'complaint:' || c.id || ':' || c.status || ':' || c.reopen_count, 'complaint', c.id::text);
    select * into tp from public.tenant_profiles where user_id = c.customer_id;
    if tp.guardian_consent_complaints and tp.guardian_phone <> '' then
      perform public.notify(null, array['sms', 'whatsapp'], 'complaint', t.subject, 'Copy for guardian: ' || t.body, null,
        'complaint-g:' || c.id || ':' || c.status || ':' || c.reopen_count, 'complaint', c.id::text, tp.guardian_phone);
    end if;
  end if;
  if c.assigned_to is not null then
    perform public.notify(c.assigned_to, array['in_app', 'push'], 'complaint', 'Ticket #' || c.ticket_no || ' ' || label,
      c.title || case when p_note <> '' then ' - ' || p_note else '' end, '/staff#tasks',
      'complaint-staff:' || c.id || ':' || c.status || ':' || c.reopen_count || ':' || c.assigned_to, 'complaint', c.id::text);
  end if;
end $$;

-- tenant raises a complaint for their own room; office logs one for a tenant or a common area
create function public.raise_complaint(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bk public.bookings%rowtype; cid uuid; prop text; cust uuid; room text; bed uuid; c public.complaints%rowtype;
  sla jsonb := coalesce(public.setting('complaint_sla_hours'), '{}'); prio text := coalesce(nullif(p ->> 'priority', ''), 'medium');
begin
  if public.current_app_role() = 'customer' then
    select * into bk from public.bookings where customer_id = uid and status = 'active' order by check_in desc limit 1;
    if not found then raise exception 'You need an active stay to raise a complaint'; end if;
    prop := bk.property_id; cust := uid; room := bk.room_id;
    bed := (select bed_id from public.booking_beds where booking_id = bk.id and active limit 1);
    prio := case when prio in ('low', 'medium', 'high') then prio else 'medium' end;   -- urgent is the office's call
  else
    prop := p ->> 'property_id';
    if not public.can_access_property(prop) then raise exception 'Not allowed' using errcode = '42501'; end if;
    cust := nullif(p ->> 'customer_id', '')::uuid; room := nullif(p ->> 'room_id', '');
    bed := nullif(p ->> 'bed_id', '')::uuid;
    if cust is not null and room is null then
      select room_id into room from public.bookings where customer_id = cust and status = 'active' limit 1;
    end if;
  end if;
  insert into public.complaints (property_id, room_id, bed_id, customer_id, is_common_area, category, title, description,
                                 photos, preferred_time, priority, due_at, created_by)
  values (prop, room, bed, cust, cust is null and coalesce((p ->> 'is_common_area')::boolean, true),
          coalesce(nullif(p ->> 'category', ''), 'other'), trim(p ->> 'title'), coalesce(p ->> 'description', ''),
          coalesce(array(select jsonb_array_elements_text(p -> 'photos')), '{}'), coalesce(p ->> 'preferred_time', ''),
          prio, now() + make_interval(hours => coalesce((sla ->> prio)::int, 48)), uid)
  returning * into c;
  insert into public.complaint_events (complaint_id, actor_id, to_status, note) values (c.id, uid, 'new', 'Raised');
  perform public.alert_managers(prop, 'complaint', 'New complaint #' || c.ticket_no, c.title, '/admin/complaints/' || c.id,
                                'complaint-new:' || c.id, 'complaint', c.id::text);
  return c.id;
end $$;

-- PRD 6.2 status flow: new > assigned > in_progress > resolved > closed, with reopen from resolved / closed
create function public.update_complaint(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c public.complaints%rowtype; uid uuid := auth.uid(); manage boolean; staff boolean; v_next text := p ->> 'status';
  v_note text := coalesce(p ->> 'note', ''); sla jsonb := coalesce(public.setting('complaint_sla_hours'), '{}'); ok boolean;
begin
  select * into c from public.complaints where id = p_id for update;
  if not found then raise exception 'Complaint not found'; end if;
  manage := public.can_manage_property(c.property_id);
  staff := c.assigned_to = uid;
  if not (manage or staff or c.customer_id = uid) then raise exception 'Complaint not found'; end if;

  -- tenant: only reopen a resolved/closed ticket, confirm it (close), or rate it
  if not manage and not staff then
    if v_next is not null and not (v_next = 'closed' and c.status = 'resolved') and not (v_next = 'reopen' and c.status in ('resolved', 'closed')) then
      raise exception 'You can only confirm or reopen a resolved complaint';
    end if;
    if p ? 'rating' then
      if c.status not in ('resolved', 'closed') and v_next is distinct from 'closed' then raise exception 'Rate after it is resolved'; end if;
      update public.complaints set rating = (p ->> 'rating')::int, feedback = coalesce(p ->> 'feedback', '') where id = p_id;
    end if;
  end if;

  if manage then
    if p ? 'priority' then
      update public.complaints set priority = p ->> 'priority',
        due_at = created_at + make_interval(hours => coalesce((sla ->> (p ->> 'priority'))::int, 48)) where id = p_id;
    end if;
    if p ? 'due_at' then update public.complaints set due_at = (p ->> 'due_at')::timestamptz where id = p_id; end if;
    if p ? 'assigned_to' or p ? 'vendor_id' or p ? 'staff_member_id' then
      update public.complaints set assigned_to = nullif(p ->> 'assigned_to', '')::uuid, vendor_id = nullif(p ->> 'vendor_id', '')::uuid,
        staff_member_id = nullif(p ->> 'staff_member_id', '')::uuid where id = p_id;
      if c.status = 'new' and v_next is null then v_next := 'assigned'; end if;
    end if;
  end if;
  if (manage or staff) then
    update public.complaints set
      resolution = coalesce(p ->> 'resolution', resolution), fixed_by = coalesce(p ->> 'fixed_by', fixed_by),
      cost = coalesce((p ->> 'cost')::int, cost),
      after_photos = coalesce(array(select jsonb_array_elements_text(p -> 'after_photos')), after_photos)
    where id = p_id;
  end if;

  if v_next is not null then
    ok := case
      when v_next = 'reopen' then c.status in ('resolved', 'closed')
      when v_next = 'assigned' then c.status in ('new', 'in_progress') and manage
      when v_next = 'in_progress' then c.status in ('new', 'assigned') and (manage or staff)
      when v_next = 'resolved' then c.status in ('assigned', 'in_progress', 'new') and (manage or staff)
      when v_next = 'closed' then c.status = 'resolved' or (manage and c.status <> 'closed')
      else false end;
    if not ok then raise exception 'Cannot move a % complaint to %', replace(c.status, '_', ' '), replace(v_next, '_', ' '); end if;
    update public.complaints set
      status = case when v_next = 'reopen' then case when assigned_to is not null then 'assigned' else 'new' end else v_next end,
      reopen_count = reopen_count + case when v_next = 'reopen' then 1 else 0 end,
      resolved_at = case when v_next = 'resolved' then now() when v_next = 'reopen' then null else resolved_at end,
      closed_at = case when v_next = 'closed' then now() when v_next = 'reopen' then null else closed_at end,
      escalated_at = case when v_next = 'reopen' then null else escalated_at end,
      due_at = case when v_next = 'reopen' then now() + make_interval(hours => coalesce((sla ->> priority)::int, 48)) else due_at end
    where id = p_id;
  end if;
  update public.complaints set updated_at = now() where id = p_id;
  select * into c from public.complaints where id = p_id;
  insert into public.complaint_events (complaint_id, actor_id, from_status, to_status, note)
  values (p_id, uid, (select to_status from public.complaint_events where complaint_id = p_id order by id desc limit 1), c.status, v_note);
  -- repair cost flows into expenses (PRD 6.3), kept in step if the cost is edited later
  if c.status in ('resolved', 'closed') and c.cost > 0 then
    insert into public.expenses (property_id, category_id, spent_on, amount, vendor, notes, source, source_id, status, created_by)
    values (c.property_id, 'repairs', coalesce(c.resolved_at, now())::date, c.cost,
            coalesce((select name from public.vendors where id = c.vendor_id), c.fixed_by),
            'Complaint #' || c.ticket_no || ': ' || c.title, 'complaint', c.id::text, 'approved', uid)
    on conflict (source, source_id) where source_id is not null do update set amount = excluded.amount, vendor = excluded.vendor;
  end if;
  if v_next is not null or p ? 'assigned_to' then perform public.complaint_notify(c, v_note); end if;
end $$;

-- overdue tickets escalate to managers / owner once (PRD 6.2 [Should])
create function public.escalate_overdue_complaints() returns int
language plpgsql security definer set search_path = public as $$
declare c record; n int := 0;
begin
  for c in select * from public.complaints where status in ('new', 'assigned', 'in_progress') and due_at < now() and escalated_at is null loop
    perform public.alert_managers(c.property_id, 'escalation', 'Overdue complaint #' || c.ticket_no,
      c.title || ' was due ' || to_char(c.due_at, 'DD Mon HH24:MI'), '/admin/complaints/' || c.id, 'escalate:' || c.id, 'complaint', c.id::text);
    update public.complaints set escalated_at = now() where id = c.id;
    insert into public.complaint_events (complaint_id, from_status, to_status, note) values (c.id, c.status, c.status, 'Escalated: overdue');
    n := n + 1;
  end loop;
  return n;
end $$;

-- preventive maintenance: remind ahead, and raise a ticket on the due date, then roll the date forward
create function public.run_maintenance_schedules() returns int
language plpgsql security definer set search_path = public as $$
declare s record; n int := 0; cid uuid;
begin
  for s in select * from public.maintenance_schedules where active and next_due - remind_days <= current_date loop
    perform public.alert_managers(s.property_id, 'maintenance', 'Due ' || to_char(s.next_due, 'DD Mon') || ': ' || s.title,
      'Preventive maintenance is due.', '/admin/complaints', 'pm:' || s.id || ':' || s.next_due, 'maintenance', s.id::text);
    if s.next_due <= current_date then
      insert into public.complaints (property_id, is_common_area, category, title, description, priority, status, assigned_to,
                                     vendor_id, due_at, schedule_id)
      values (s.property_id, true, 'preventive', s.title, 'Scheduled preventive maintenance', 'medium',
              case when s.assigned_to is not null or s.vendor_id is not null then 'assigned' else 'new' end, s.assigned_to, s.vendor_id,
              (s.next_due + 2)::timestamptz, s.id)
      returning id into cid;
      insert into public.complaint_events (complaint_id, to_status, note) values (cid, 'new', 'Created from maintenance schedule');
      update public.maintenance_schedules set next_due = next_due + interval_days where id = s.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.expense_categories    enable row level security;
alter table public.expenses              enable row level security;
alter table public.recurring_expenses    enable row level security;
alter table public.other_income          enable row level security;
alter table public.vendors               enable row level security;
alter table public.complaints            enable row level security;
alter table public.complaint_events      enable row level security;
alter table public.maintenance_schedules enable row level security;

grant select on public.expense_categories, public.expenses, public.recurring_expenses, public.other_income, public.vendors,
  public.complaints, public.complaint_events, public.maintenance_schedules to authenticated;
grant insert, update, delete on public.expense_categories, public.expenses, public.recurring_expenses, public.other_income,
  public.vendors, public.maintenance_schedules to authenticated;

create policy expcat_read  on public.expense_categories for select using (public.is_manager_or_owner());
create policy expcat_write on public.expense_categories for all using (public.is_admin() and not is_system) with check (public.is_admin());
create policy expenses_rw on public.expenses for all using (public.can_manage_property(property_id))
  with check (public.can_manage_property(property_id));
create policy rexp_rw on public.recurring_expenses for all using (public.can_manage_property(property_id))
  with check (public.can_manage_property(property_id));
create policy income_rw on public.other_income for all using (public.can_manage_property(property_id))
  with check (public.can_manage_property(property_id));
create policy vendors_read on public.vendors for select
  using (public.current_app_role() in ('admin', 'manager', 'employee') and (property_id is null or public.can_access_property(property_id)));
create policy vendors_write on public.vendors for all
  using (case when property_id is null then public.is_admin() else public.can_manage_property(property_id) end)
  with check (case when property_id is null then public.is_admin() else public.can_manage_property(property_id) end);
create policy complaints_own on public.complaints for select using (customer_id = auth.uid());
create policy complaints_staff on public.complaints for select using (assigned_to = auth.uid() or public.can_manage_property(property_id));
create policy events_read on public.complaint_events for select using (exists (select 1 from public.complaints c where c.id = complaint_id
  and (c.customer_id = auth.uid() or c.assigned_to = auth.uid() or public.can_manage_property(c.property_id))));
create policy pm_rw on public.maintenance_schedules for all using (public.can_manage_property(property_id))
  with check (public.can_manage_property(property_id));

revoke all on function public.approve_expense(uuid, boolean), public.generate_recurring_expenses(),
  public.complaint_notify(public.complaints, text), public.raise_complaint(jsonb), public.update_complaint(uuid, jsonb),
  public.escalate_overdue_complaints(), public.run_maintenance_schedules() from public, anon;
revoke all on function public.generate_recurring_expenses(), public.complaint_notify(public.complaints, text),
  public.escalate_overdue_complaints(), public.run_maintenance_schedules() from authenticated;
grant execute on function public.approve_expense(uuid, boolean), public.raise_complaint(jsonb), public.update_complaint(uuid, jsonb)
  to authenticated, service_role;
grant execute on function public.generate_recurring_expenses(), public.escalate_overdue_complaints(), public.run_maintenance_schedules()
  to service_role;
