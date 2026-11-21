-- PRD 10: employee profiles and documents, attendance (manager or self check-in with selfie + GPS), shifts and
-- roster, leave, salary structure and revisions, advances, payroll and payslips, task checklists.
-- Staff with a login link to profiles (role employee / manager / sales); daily-wage staff may have none.

create table public.staff_members (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid unique references public.profiles (id) on delete set null,
  property_id        text not null references public.properties (id),
  full_name          text not null check (char_length(full_name) between 2 and 120),
  photo_path         text,
  phone              text not null default '',
  address            text not null default '',
  designation        text not null check (designation in ('manager', 'caretaker', 'housekeeping', 'cook', 'security',
                                                         'maintenance', 'sales', 'other')),
  joining_date       date not null default current_date,
  employment_type    text not null default 'full_time' check (employment_type in ('full_time', 'part_time', 'contract', 'daily_wage')),
  status             text not null default 'active' check (status in ('active', 'inactive', 'resigned')),
  exit_date          date,
  exit_reason        text not null default '',
  emergency_name     text not null default '',
  emergency_relation text not null default '',
  emergency_phone    text not null default '',
  bank_account_name  text not null default '',
  bank_account_no    text not null default '',
  bank_ifsc          text not null default '',
  upi_id             text not null default '',
  basic_pay          int not null default 0 check (basic_pay >= 0),        -- monthly
  allowances         int not null default 0 check (allowances >= 0),       -- monthly
  per_day_rate       int not null default 0 check (per_day_rate >= 0),     -- daily wage staff
  overtime_rate      int not null default 0 check (overtime_rate >= 0),    -- per hour
  pf_applicable      boolean not null default false,
  esi_applicable     boolean not null default false,
  weekly_off_day     int check (weekly_off_day between 0 and 6),           -- 0 = Sunday
  paid_leave_quota   int not null default 12,
  sick_leave_quota   int not null default 6,
  casual_leave_quota int not null default 6,
  created_at         timestamptz not null default now(),
  check (status = 'active' or exit_date is not null or status = 'inactive')
);
create index staff_members_property_idx on public.staff_members (property_id, status);
alter table public.complaints add constraint complaints_staff_fk foreign key (staff_member_id) references public.staff_members (id) on delete set null;

create function public.staff_property(p_staff uuid) returns text
language sql stable security definer set search_path = public as $$ select property_id from public.staff_members where id = p_staff $$;
create function public.my_staff_id() returns uuid
language sql stable security definer set search_path = public as $$ select id from public.staff_members where user_id = auth.uid() $$;
grant execute on function public.staff_property(uuid), public.my_staff_id() to authenticated, service_role;

create table public.staff_documents (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff_members (id) on delete cascade,
  doc_type   text not null check (doc_type in ('id_proof', 'pan', 'address_proof', 'police_verification', 'contract', 'bank', 'photo', 'other')),
  id_last4   text check (id_last4 is null or id_last4 ~ '^[0-9A-Za-z]{4}$'),
  file_path  text not null,                -- employee-documents bucket: <staff_id>/<file>
  file_name  text not null,
  created_at timestamptz not null default now()
);

create table public.salary_revisions (
  id             bigint generated always as identity primary key,
  staff_id       uuid not null references public.staff_members (id) on delete cascade,
  effective_from date not null,
  basic_pay      int not null,
  allowances     int not null,
  per_day_rate   int not null,
  reason         text not null default '',     -- increment, promotion, correction
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create function public.track_salary_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or (new.basic_pay, new.allowances, new.per_day_rate) is distinct from (old.basic_pay, old.allowances, old.per_day_rate) then
    insert into public.salary_revisions (staff_id, effective_from, basic_pay, allowances, per_day_rate, reason, created_by)
    values (new.id, case when tg_op = 'INSERT' then new.joining_date else current_date end, new.basic_pay, new.allowances,
            new.per_day_rate, case when tg_op = 'INSERT' then 'Joining' else 'Revision' end, auth.uid());
  end if;
  return null;
end $$;
create trigger staff_salary_history after insert or update on public.staff_members for each row execute function public.track_salary_change();

create table public.shifts (
  id          uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties (id) on delete cascade,
  name        text not null,                 -- Morning, Evening, Night security
  start_time  time not null,
  end_time    time not null
);

create table public.roster (
  id        uuid primary key default gen_random_uuid(),
  staff_id  uuid not null references public.staff_members (id) on delete cascade,
  shift_id  uuid not null references public.shifts (id) on delete cascade,
  work_date date not null,
  unique (staff_id, work_date)
);

create table public.attendance (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references public.staff_members (id) on delete cascade,
  work_date      date not null,
  status         text not null check (status in ('present', 'absent', 'half_day', 'leave', 'weekly_off')),
  leave_type     text check (leave_type in ('paid', 'sick', 'casual', 'unpaid')),
  check_in_at    timestamptz,
  check_out_at   timestamptz,
  selfie_path    text,                       -- employee-documents bucket
  lat            double precision,
  lng            double precision,
  distance_m     int,
  overtime_hours numeric not null default 0 check (overtime_hours between 0 and 16),
  source         text not null default 'manager' check (source in ('manager', 'self', 'leave')),
  notes          text not null default '',
  marked_by      uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (staff_id, work_date)
);
create index attendance_date_idx on public.attendance (work_date);

create table public.leave_requests (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff_members (id) on delete cascade,
  leave_type  text not null check (leave_type in ('paid', 'sick', 'casual', 'unpaid')),
  from_date   date not null,
  to_date     date not null,
  days        numeric not null,
  reason      text not null default '',
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by  uuid references public.profiles (id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (to_date >= from_date)
);

create table public.salary_advances (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff_members (id) on delete cascade,
  kind        text not null default 'advance' check (kind in ('advance', 'loan')),
  amount      int not null check (amount > 0),
  given_on    date not null default current_date,
  instalment  int not null check (instalment > 0),       -- recovered from each salary
  recovered   int not null default 0 check (recovered >= 0),
  mode        text not null default 'cash',
  status      text not null default 'open' check (status in ('open', 'closed')),
  notes       text not null default '',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (recovered <= amount)
);

create table public.payslips (
  id                uuid primary key default gen_random_uuid(),
  staff_id          uuid not null references public.staff_members (id) on delete cascade,
  property_id       text not null references public.properties (id),
  month             date not null,                            -- first day of the month
  days_in_month     int not null,
  present_days      numeric not null default 0,
  half_days         numeric not null default 0,
  paid_leave_days   numeric not null default 0,
  unpaid_days       numeric not null default 0,
  weekly_offs       numeric not null default 0,
  unmarked_days     numeric not null default 0,
  payable_days      numeric not null default 0,
  overtime_hours    numeric not null default 0,
  basic             int not null default 0,
  allowances        int not null default 0,
  earned_basic      int not null default 0,
  earned_allowances int not null default 0,
  overtime_pay      int not null default 0,
  bonus             int not null default 0 check (bonus >= 0),
  other_deductions  int not null default 0 check (other_deductions >= 0),
  advance_recovery  int not null default 0,
  pf                int not null default 0,
  esi               int not null default 0,
  gross             int not null default 0,
  net               int not null default 0,
  recoveries        jsonb not null default '[]',              -- [{ advance_id, amount }]
  status            text not null default 'draft' check (status in ('draft', 'paid')),
  paid_on           date,
  mode              text,
  reference         text,
  notes             text not null default '',
  created_at        timestamptz not null default now(),
  unique (staff_id, month)
);

create table public.task_templates (
  id             uuid primary key default gen_random_uuid(),
  property_id    text not null references public.properties (id) on delete cascade,
  designation    text not null,
  title          text not null,                     -- Room cleaning, bathroom cleaning, garbage disposal, kitchen hygiene
  frequency      text not null default 'daily' check (frequency in ('daily', 'weekly')),
  weekday        int check (weekday between 0 and 6),
  requires_photo boolean not null default false,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table public.staff_tasks (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid references public.task_templates (id) on delete set null,
  staff_id       uuid not null references public.staff_members (id) on delete cascade,
  property_id    text not null references public.properties (id),
  task_date      date not null default current_date,
  title          text not null,
  requires_photo boolean not null default false,
  done_at        timestamptz,
  photo_path     text,
  notes          text not null default '',
  created_at     timestamptz not null default now(),
  unique (template_id, staff_id, task_date)
);
create index staff_tasks_staff_idx on public.staff_tasks (staff_id, task_date);

insert into public.app_settings (key, value) values
  ('payroll', '{"pf_rate":12,"pf_wage_cap":15000,"esi_rate":0.75,"esi_gross_limit":21000,"standard_hours":9}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- attendance RPCs
create function public.mark_attendance(p_staff uuid, p_date date, p_status text, p_overtime numeric default 0, p_notes text default '',
                                       p_leave_type text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_manage(public.staff_property(p_staff));
  if p_status not in ('present', 'absent', 'half_day', 'leave', 'weekly_off') then raise exception 'Bad status'; end if;
  if p_date > current_date then raise exception 'Cannot mark attendance for a future date'; end if;
  insert into public.attendance (staff_id, work_date, status, leave_type, overtime_hours, notes, marked_by, source)
  values (p_staff, p_date, p_status, case when p_status = 'leave' then coalesce(p_leave_type, 'paid') end,
          coalesce(p_overtime, 0), coalesce(p_notes, ''), auth.uid(), 'manager')
  on conflict (staff_id, work_date) do update set status = excluded.status, leave_type = excluded.leave_type,
    overtime_hours = excluded.overtime_hours, notes = excluded.notes, marked_by = excluded.marked_by;
end $$;

create function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns int language sql immutable as $$
  select round(6371000 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))::int
$$;

-- staff app: check in with selfie and GPS; refused when the phone is outside the property's geofence
create function public.staff_check_in(p_lat double precision, p_lng double precision, p_selfie text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.staff_members%rowtype; pr public.properties%rowtype; d int;
begin
  select * into s from public.staff_members where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'Your login is not linked to an active staff profile'; end if;
  select * into pr from public.properties where id = s.property_id;
  if p_lat is null or p_lng is null then raise exception 'Allow location access to check in'; end if;
  if coalesce(p_selfie, '') = '' then raise exception 'Take a selfie to check in'; end if;
  if pr.lat is not null and pr.lng is not null then
    d := public.distance_m(p_lat, p_lng, pr.lat, pr.lng);
    if d > pr.geofence_m then raise exception 'You are % m from %. Check in when you reach the property.', d, pr.name; end if;
  end if;
  insert into public.attendance (staff_id, work_date, status, check_in_at, selfie_path, lat, lng, distance_m, source, marked_by)
  values (s.id, current_date, 'present', now(), p_selfie, p_lat, p_lng, d, 'self', auth.uid())
  on conflict (staff_id, work_date) do update set status = 'present', check_in_at = coalesce(attendance.check_in_at, now()),
    selfie_path = excluded.selfie_path, lat = excluded.lat, lng = excluded.lng, distance_m = excluded.distance_m, source = 'self'
  where attendance.status not in ('leave');
  return jsonb_build_object('distance_m', d, 'property', pr.name);
end $$;

create function public.staff_check_out() returns numeric
language plpgsql security definer set search_path = public as $$
declare a public.attendance%rowtype; std numeric := coalesce((public.setting('payroll') ->> 'standard_hours')::numeric, 9);
  shift_h numeric; worked numeric; ot numeric;
begin
  select * into a from public.attendance where staff_id = public.my_staff_id() and work_date = current_date;
  if not found or a.check_in_at is null then raise exception 'Check in first'; end if;
  select extract(epoch from (case when sh.end_time > sh.start_time then sh.end_time - sh.start_time
                                  else sh.end_time - sh.start_time + interval '24 hours' end)) / 3600
    into shift_h from public.roster r join public.shifts sh on sh.id = r.shift_id where r.staff_id = a.staff_id and r.work_date = current_date;
  worked := extract(epoch from now() - a.check_in_at) / 3600;
  ot := greatest(round((worked - coalesce(shift_h, std))::numeric, 1), 0);
  update public.attendance set check_out_at = now(), overtime_hours = least(ot, 16),
    status = case when worked < coalesce(shift_h, std) / 2 then 'half_day' else 'present' end where id = a.id;
  return round(worked, 1);
end $$;

-- ---------------------------------------------------------------- leave
create function public.leave_balance(p_staff uuid, p_year int default extract(year from current_date)::int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'paid', s.paid_leave_quota - coalesce(sum(l.days) filter (where l.leave_type = 'paid'), 0),
    'sick', s.sick_leave_quota - coalesce(sum(l.days) filter (where l.leave_type = 'sick'), 0),
    'casual', s.casual_leave_quota - coalesce(sum(l.days) filter (where l.leave_type = 'casual'), 0),
    'unpaid_taken', coalesce(sum(l.days) filter (where l.leave_type = 'unpaid'), 0))
  from public.staff_members s
  left join public.leave_requests l on l.staff_id = s.id and l.status = 'approved' and extract(year from l.from_date) = p_year
  where s.id = p_staff and (s.user_id = auth.uid() or public.can_manage_property(s.property_id) or auth.uid() is null)
  group by s.id
$$;

create function public.request_leave(p_staff uuid, p_type text, p_from date, p_to date, p_reason text, p_half boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid := coalesce(p_staff, public.my_staff_id()); d numeric; bal jsonb; lid uuid;
begin
  if sid is null then raise exception 'No staff profile'; end if;
  if not (sid = public.my_staff_id() or public.can_manage_property(public.staff_property(sid))) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_to < p_from then raise exception 'End date is before start date'; end if;
  d := case when p_half and p_from = p_to then 0.5 else (p_to - p_from + 1) end;
  bal := public.leave_balance(sid, extract(year from p_from)::int);
  if p_type <> 'unpaid' and (bal ->> p_type)::numeric < d then
    raise exception 'Only % % leave day(s) left', bal ->> p_type, p_type;
  end if;
  insert into public.leave_requests (staff_id, leave_type, from_date, to_date, days, reason)
  values (sid, p_type, p_from, p_to, d, coalesce(p_reason, '')) returning id into lid;
  perform public.alert_managers(public.staff_property(sid), 'leave', 'Leave request',
    (select full_name from public.staff_members where id = sid) || ': ' || d || ' day(s) ' || p_type, '/admin/staff', 'leave:' || lid);
  return lid;
end $$;

create function public.decide_leave(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare l public.leave_requests%rowtype; dd date; s public.staff_members%rowtype;
begin
  select * into l from public.leave_requests where id = p_id for update;
  if not found then raise exception 'Leave not found'; end if;
  perform public.require_manage(public.staff_property(l.staff_id));
  if l.status <> 'pending' then raise exception 'Already decided'; end if;
  update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now()
  where id = p_id;
  if p_approve then
    for dd in select generate_series(l.from_date, l.to_date, interval '1 day')::date loop
      insert into public.attendance (staff_id, work_date, status, leave_type, source, marked_by)
      values (l.staff_id, dd, case when l.days = 0.5 then 'half_day' else 'leave' end, l.leave_type, 'leave', auth.uid())
      on conflict (staff_id, work_date) do update set status = excluded.status, leave_type = excluded.leave_type, source = 'leave';
    end loop;
  end if;
  select * into s from public.staff_members where id = l.staff_id;
  if s.user_id is not null then
    perform public.notify(s.user_id, array['in_app', 'push'], 'leave', 'Leave ' || case when p_approve then 'approved' else 'rejected' end,
      to_char(l.from_date, 'DD Mon') || ' - ' || to_char(l.to_date, 'DD Mon'), '/staff', 'leave-decided:' || p_id);
  end if;
end $$;

-- ---------------------------------------------------------------- payroll
create function public.payslip_recalc(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.payslips%rowtype; s public.staff_members%rowtype; cfg jsonb := coalesce(public.setting('payroll'), '{}');
  remaining int; a record; rec jsonb := '[]'; take int; total_rec int := 0;
begin
  select * into p from public.payslips where id = p_id for update;
  select * into s from public.staff_members where id = p.staff_id;
  if s.employment_type = 'daily_wage' then
    p.earned_basic := round(s.per_day_rate * (p.present_days + p.half_days * 0.5))::int;
    p.earned_allowances := 0;
  else
    p.earned_basic := round(p.basic * p.payable_days / p.days_in_month)::int;
    p.earned_allowances := round(p.allowances * p.payable_days / p.days_in_month)::int;
  end if;
  p.overtime_pay := round(p.overtime_hours * s.overtime_rate)::int;
  p.gross := p.earned_basic + p.earned_allowances + p.overtime_pay + p.bonus;
  p.pf := case when s.pf_applicable then round(least(p.earned_basic, coalesce((cfg ->> 'pf_wage_cap')::int, 15000))
                                               * coalesce((cfg ->> 'pf_rate')::numeric, 12) / 100)::int else 0 end;
  p.esi := case when s.esi_applicable and p.gross <= coalesce((cfg ->> 'esi_gross_limit')::int, 21000)
                then ceil(p.gross * coalesce((cfg ->> 'esi_rate')::numeric, 0.75) / 100)::int else 0 end;
  remaining := greatest(p.gross - p.pf - p.esi - p.other_deductions, 0);
  for a in select * from public.salary_advances where staff_id = s.id and status = 'open' and given_on <= (p.month + interval '1 month' - interval '1 day')::date
           order by given_on loop
    take := least(a.instalment, a.amount - a.recovered, remaining);
    exit when take <= 0;
    rec := rec || jsonb_build_object('advance_id', a.id, 'amount', take);
    remaining := remaining - take; total_rec := total_rec + take;
  end loop;
  update public.payslips set earned_basic = p.earned_basic, earned_allowances = p.earned_allowances, overtime_pay = p.overtime_pay,
    gross = p.gross, pf = p.pf, esi = p.esi, advance_recovery = total_rec, recoveries = rec,
    net = p.gross - p.pf - p.esi - p.other_deductions - total_rec
  where id = p_id;
end $$;

-- builds (or rebuilds) draft payslips for a month from attendance, leave, overtime and advances
create function public.generate_payroll(p_month date, p_property text) returns int
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; e date; dim int; s record; att record; n int := 0; pid uuid;
  unmarked numeric; offs numeric; payable numeric; last_day date;
begin
  perform public.require_manage(p_property);
  e := (m + interval '1 month' - interval '1 day')::date; dim := e - m + 1;
  for s in select * from public.staff_members where property_id = p_property
           and joining_date <= e and (status = 'active' or exit_date >= m) loop
    continue when exists (select 1 from public.payslips where staff_id = s.id and month = m and status = 'paid');
    last_day := least(e, coalesce(s.exit_date, e), current_date);
    select count(*) filter (where status = 'present') present, count(*) filter (where status = 'half_day') half,
           count(*) filter (where status = 'leave' and leave_type <> 'unpaid') pleave,
           count(*) filter (where status = 'absent' or (status = 'leave' and leave_type = 'unpaid')) unpaid,
           count(*) filter (where status = 'weekly_off') woff, coalesce(sum(overtime_hours), 0) ot, count(*) marked
      into att from public.attendance where staff_id = s.id and work_date between greatest(m, s.joining_date) and last_day;
    -- days with no record: the weekly off day counts as off, anything else is unmarked (and unpaid until marked)
    select count(*) filter (where extract(dow from d) = s.weekly_off_day), count(*) filter (where extract(dow from d) is distinct from s.weekly_off_day)
      into offs, unmarked
    from generate_series(greatest(m, s.joining_date), last_day, interval '1 day') d
    where not exists (select 1 from public.attendance a where a.staff_id = s.id and a.work_date = d::date);
    payable := att.present + att.half * 0.5 + att.pleave + att.woff + offs;
    insert into public.payslips (staff_id, property_id, month, days_in_month, present_days, half_days, paid_leave_days, unpaid_days,
                                 weekly_offs, unmarked_days, payable_days, overtime_hours, basic, allowances)
    values (s.id, s.property_id, m, dim, att.present, att.half, att.pleave, att.unpaid + att.half * 0.5, att.woff + offs, unmarked,
            payable, att.ot, s.basic_pay, s.allowances)
    on conflict (staff_id, month) do update set days_in_month = excluded.days_in_month, present_days = excluded.present_days,
      half_days = excluded.half_days, paid_leave_days = excluded.paid_leave_days, unpaid_days = excluded.unpaid_days,
      weekly_offs = excluded.weekly_offs, unmarked_days = excluded.unmarked_days, payable_days = excluded.payable_days,
      overtime_hours = excluded.overtime_hours, basic = excluded.basic, allowances = excluded.allowances
    returning id into pid;
    perform public.payslip_recalc(pid);
    n := n + 1;
  end loop;
  return n;
end $$;

create function public.update_payslip(p_id uuid, p_bonus int, p_other_deductions int, p_notes text default '') returns void
language plpgsql security definer set search_path = public as $$
declare p public.payslips%rowtype;
begin
  select * into p from public.payslips where id = p_id;
  if not found then raise exception 'Payslip not found'; end if;
  perform public.require_manage(p.property_id);
  if p.status <> 'draft' then raise exception 'A paid payslip cannot be changed'; end if;
  update public.payslips set bonus = greatest(coalesce(p_bonus, 0), 0), other_deductions = greatest(coalesce(p_other_deductions, 0), 0),
    notes = coalesce(p_notes, '') where id = p_id;
  perform public.payslip_recalc(p_id);
end $$;

-- pays the salary: recovers advances and books the expense as Staff salaries (PRD 10.3)
create function public.pay_payslip(p_id uuid, p_mode text, p_reference text, p_date date default current_date) returns void
language plpgsql security definer set search_path = public as $$
declare p public.payslips%rowtype; r jsonb; s public.staff_members%rowtype;
begin
  select * into p from public.payslips where id = p_id for update;
  if not found then raise exception 'Payslip not found'; end if;
  perform public.require_manage(p.property_id);
  if p.status = 'paid' then raise exception 'Already paid'; end if;
  if p.unmarked_days > 0 then raise exception 'Mark attendance for all % unmarked day(s) first', p.unmarked_days; end if;
  if p_mode not in ('cash', 'upi', 'bank_transfer', 'cheque') then raise exception 'Choose cash, UPI, bank transfer or cheque'; end if;
  perform public.payslip_recalc(p_id);
  select * into p from public.payslips where id = p_id;
  for r in select * from jsonb_array_elements(p.recoveries) loop
    update public.salary_advances set recovered = recovered + (r ->> 'amount')::int,
      status = case when recovered + (r ->> 'amount')::int >= amount then 'closed' else 'open' end
    where id = (r ->> 'advance_id')::uuid;
  end loop;
  update public.payslips set status = 'paid', paid_on = p_date, mode = p_mode, reference = p_reference where id = p_id;
  select * into s from public.staff_members where id = p.staff_id;
  if p.net + p.pf + p.esi + p.advance_recovery > 0 then
    -- the full employer cost of the month: net paid + deductions held back for PF / ESI / advances already given
    insert into public.expenses (property_id, category_id, spent_on, amount, vendor, payment_mode, notes, source, source_id, status, created_by)
    values (p.property_id, 'salaries', p_date, p.net + p.pf + p.esi, s.full_name,
            case when p_mode in ('cash', 'upi', 'bank_transfer', 'cheque') then p_mode else 'other' end,
            'Salary ' || to_char(p.month, 'Mon YYYY'), 'salary', p.id::text, 'approved', auth.uid())
    on conflict (source, source_id) where source_id is not null do nothing;
  end if;
  if s.user_id is not null then
    perform public.notify(s.user_id, array['in_app', 'push'], 'payslip', 'Salary paid', 'Your salary for ' || to_char(p.month, 'Mon YYYY')
      || ' (Rs ' || p.net || ') has been paid.', '/staff', 'payslip:' || p.id);
  end if;
  perform public.log_activity('payroll.paid', 'payslip', p.id::text, jsonb_build_object('net', p.net));
end $$;

-- ---------------------------------------------------------------- tasks
create function public.generate_daily_tasks(p_date date default current_date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.staff_tasks (template_id, staff_id, property_id, task_date, title, requires_photo)
  select t.id, s.id, t.property_id, p_date, t.title, t.requires_photo
  from public.task_templates t join public.staff_members s on s.property_id = t.property_id and s.designation = t.designation
  where t.active and s.status = 'active'
    and (t.frequency = 'daily' or (t.frequency = 'weekly' and t.weekday = extract(dow from p_date)))
    and not exists (select 1 from public.attendance a where a.staff_id = s.id and a.work_date = p_date and a.status in ('leave', 'weekly_off'))
  on conflict (template_id, staff_id, task_date) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create function public.complete_task(p_id uuid, p_photo text default null, p_notes text default '') returns void
language plpgsql security definer set search_path = public as $$
declare t public.staff_tasks%rowtype;
begin
  select * into t from public.staff_tasks where id = p_id for update;
  if not found or not (t.staff_id = public.my_staff_id() or public.can_manage_property(t.property_id)) then raise exception 'Task not found'; end if;
  if t.requires_photo and coalesce(p_photo, t.photo_path, '') = '' then raise exception 'Add a photo as proof'; end if;
  update public.staff_tasks set done_at = coalesce(done_at, now()), photo_path = coalesce(p_photo, photo_path), notes = coalesce(p_notes, '')
  where id = p_id;
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.staff_members    enable row level security;
alter table public.staff_documents  enable row level security;
alter table public.salary_revisions enable row level security;
alter table public.shifts           enable row level security;
alter table public.roster           enable row level security;
alter table public.attendance       enable row level security;
alter table public.leave_requests   enable row level security;
alter table public.salary_advances  enable row level security;
alter table public.payslips         enable row level security;
alter table public.task_templates   enable row level security;
alter table public.staff_tasks      enable row level security;

grant select on public.staff_members, public.staff_documents, public.salary_revisions, public.shifts, public.roster, public.attendance,
  public.leave_requests, public.salary_advances, public.payslips, public.task_templates, public.staff_tasks to authenticated;
grant insert, update, delete on public.staff_members, public.staff_documents, public.shifts, public.roster, public.salary_advances,
  public.task_templates, public.staff_tasks to authenticated;
grant update (status) on public.leave_requests to authenticated;

create policy staff_self on public.staff_members for select using (user_id = auth.uid());
create policy staff_manage on public.staff_members for all using (public.can_manage_property(property_id))
  with check (public.can_manage_property(property_id));
-- complaint assignment needs names of the property's staff (no bank or salary columns are exposed this way)
create function public.staff_directory(p_property text) returns table (id uuid, user_id uuid, full_name text, designation text, phone text)
language sql stable security definer set search_path = public as $$
  select id, user_id, full_name, designation, phone from public.staff_members
  where property_id = p_property and status = 'active' and public.can_access_property(p_property) order by full_name
$$;
grant execute on function public.staff_directory(text) to authenticated;

create policy staffdocs_rw on public.staff_documents for all using (public.can_manage_property(public.staff_property(staff_id)))
  with check (public.can_manage_property(public.staff_property(staff_id)));
create policy revisions_read on public.salary_revisions for select
  using (staff_id = public.my_staff_id() or public.can_manage_property(public.staff_property(staff_id)));
create policy shifts_read on public.shifts for select using (public.can_access_property(property_id));
create policy shifts_write on public.shifts for all using (public.can_manage_property(property_id)) with check (public.can_manage_property(property_id));
create policy roster_read on public.roster for select
  using (staff_id = public.my_staff_id() or public.can_manage_property(public.staff_property(staff_id)));
create policy roster_write on public.roster for all using (public.can_manage_property(public.staff_property(staff_id)))
  with check (public.can_manage_property(public.staff_property(staff_id)));
create policy attendance_read on public.attendance for select
  using (staff_id = public.my_staff_id() or public.can_manage_property(public.staff_property(staff_id)));
create policy leave_read on public.leave_requests for select
  using (staff_id = public.my_staff_id() or public.can_manage_property(public.staff_property(staff_id)));
create policy leave_cancel on public.leave_requests for update using (staff_id = public.my_staff_id() and status = 'pending')
  with check (status = 'cancelled');
create policy advances_read on public.salary_advances for select
  using (staff_id = public.my_staff_id() or public.can_manage_property(public.staff_property(staff_id)));
create policy advances_write on public.salary_advances for all using (public.can_manage_property(public.staff_property(staff_id)))
  with check (public.can_manage_property(public.staff_property(staff_id)));
create policy payslips_read on public.payslips for select
  using ((staff_id = public.my_staff_id() and status = 'paid') or public.can_manage_property(property_id));
create policy templates_rw on public.task_templates for all using (public.can_manage_property(property_id))
  with check (public.can_manage_property(property_id));
create policy templates_staff_read on public.task_templates for select using (public.can_access_property(property_id));
create policy tasks_read on public.staff_tasks for select
  using (staff_id = public.my_staff_id() or public.can_manage_property(property_id));
create policy tasks_write on public.staff_tasks for all using (public.can_manage_property(property_id))
  with check (public.can_manage_property(property_id));

revoke all on function public.mark_attendance(uuid, date, text, numeric, text, text), public.staff_check_in(double precision, double precision, text),
  public.staff_check_out(), public.leave_balance(uuid, int), public.request_leave(uuid, text, date, date, text, boolean),
  public.decide_leave(uuid, boolean), public.payslip_recalc(uuid), public.generate_payroll(date, text),
  public.update_payslip(uuid, int, int, text), public.pay_payslip(uuid, text, text, date), public.generate_daily_tasks(date),
  public.complete_task(uuid, text, text) from public, anon;
revoke all on function public.payslip_recalc(uuid), public.generate_daily_tasks(date) from authenticated;
grant execute on function public.payslip_recalc(uuid), public.generate_daily_tasks(date) to service_role;
grant execute on function public.mark_attendance(uuid, date, text, numeric, text, text), public.staff_check_in(double precision, double precision, text),
  public.staff_check_out(), public.leave_balance(uuid, int), public.request_leave(uuid, text, date, date, text, boolean),
  public.decide_leave(uuid, boolean), public.generate_payroll(date, text), public.update_payslip(uuid, int, int, text),
  public.pay_payslip(uuid, text, text, date), public.complete_task(uuid, text, text) to authenticated, service_role;
