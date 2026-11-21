-- PRD 8 (enquiry capture and admin panel) and PRD 9 (sales CRM, campaigns, brokers, referrals, offers, bulk messages).

-- ---------------------------------------------------------------- campaigns / brokers / offers
create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  channel     text not null,                      -- same list as enquiries.source
  start_date  date not null default current_date,
  end_date    date,
  budget      int not null default 0 check (budget >= 0),
  property_id text references public.properties (id),
  room_type   text,
  code        text not null unique check (code ~ '^[A-Za-z0-9_-]{2,32}$'),   -- tracked link ?c=<code> and QR
  notes       text not null default '',
  active      boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
alter table public.expenses add constraint expenses_campaign_fk foreign key (campaign_id) references public.campaigns (id) on delete set null;

create table public.brokers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  firm             text not null default '',
  phone            text not null default '',
  kind             text not null default 'broker' check (kind in ('broker', 'agent', 'college', 'corporate', 'other')),
  commission_type  text not null default 'flat' check (commission_type in ('flat', 'percent')),
  commission_value numeric not null default 0 check (commission_value >= 0),   -- Rs, or % of the first month's rent
  notes            text not null default '',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table public.offers (
  code        text primary key check (code ~ '^[A-Z0-9_-]{3,24}$'),
  description text not null,
  kind        text not null check (kind in ('percent', 'flat')),
  value       numeric not null check (value > 0),
  applies_to  text not null default 'first_month' check (applies_to in ('first_month', 'long_stay', 'early_bird')),
  min_months  int not null default 0,              -- long-stay: lock-in at least this many months
  min_days_ahead int not null default 0,           -- early-bird: booked at least this many days before check-in
  valid_from  date not null default current_date,
  valid_to    date,
  max_uses    int,
  used_count  int not null default 0,
  property_id text references public.properties (id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- enquiries (leads)
create table public.enquiries (
  id                    uuid primary key default gen_random_uuid(),
  property_id           text references public.properties (id),
  name                  text not null check (char_length(name) between 1 and 120),
  phone                 text not null check (phone ~ '^[0-9]{10,13}$'),
  email                 text not null default '',
  room_type             text not null default '',
  budget                int check (budget is null or budget >= 0),
  move_in               date,
  source                text not null default 'website' check (source in ('website', 'app', 'google_ads', 'google_business',
                          'facebook', 'instagram', 'whatsapp', 'call', 'walk_in', 'justdial', 'broker', 'referral',
                          'hoarding', 'pamphlet', 'college_tieup', 'corporate_tieup', 'other')),
  message               text not null default '',
  campaign_id           uuid references public.campaigns (id) on delete set null,
  broker_id             uuid references public.brokers (id) on delete set null,
  referrer_customer_id  uuid references public.profiles (id) on delete set null,
  status                text not null default 'new' check (status in ('new', 'contacted', 'interested', 'visit_scheduled',
                          'visited', 'negotiation', 'booked', 'lost')),
  lost_reason           text check (lost_reason in ('price', 'location', 'food', 'found_elsewhere', 'not_reachable', 'facilities', 'other')),
  lost_note             text not null default '',
  temperature           text not null default 'warm' check (temperature in ('hot', 'warm', 'cold')),
  temperature_manual    boolean not null default false,
  assigned_to           uuid references public.profiles (id) on delete set null,
  next_follow_up_at     timestamptz,
  duplicate_of          uuid references public.enquiries (id) on delete set null,
  opted_out             boolean not null default false,
  unsub_token           uuid not null default gen_random_uuid() unique,
  converted_customer_id uuid references public.profiles (id) on delete set null,
  booking_id            uuid references public.bookings (id) on delete set null,
  converted_at          timestamptz,
  received_at           timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  updated_at            timestamptz not null default now()
);
create index enquiries_phone_idx on public.enquiries (phone);
create index enquiries_status_idx on public.enquiries (status, received_at desc);
create index enquiries_assignee_idx on public.enquiries (assigned_to, next_follow_up_at);
alter table public.reservations add constraint reservations_enquiry_fk foreign key (enquiry_id) references public.enquiries (id) on delete set null;
alter table public.bookings add constraint bookings_enquiry_fk foreign key (enquiry_id) references public.enquiries (id) on delete set null;

-- raw data exactly as received (PRD 8.1), one row per submission, even repeats
create table public.enquiry_submissions (
  id          bigint generated always as identity primary key,
  enquiry_id  uuid references public.enquiries (id) on delete set null,
  source      text not null,
  payload     jsonb not null,
  received_at timestamptz not null default now()
);

create table public.enquiry_activities (
  id         bigint generated always as identity primary key,
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  kind       text not null check (kind in ('note', 'call', 'whatsapp', 'sms', 'email', 'status', 'assign', 'visit', 'follow_up', 'system')),
  outcome    text not null default '',          -- for calls: answered, no_answer, busy, wrong_number, call_back
  notes      text not null default '',
  next_step  text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index enquiry_activities_idx on public.enquiry_activities (enquiry_id, created_at desc);

create table public.follow_ups (
  id          uuid primary key default gen_random_uuid(),
  enquiry_id  uuid not null references public.enquiries (id) on delete cascade,
  due_at      timestamptz not null,
  assigned_to uuid references public.profiles (id) on delete set null,
  note        text not null default '',
  done_at     timestamptz,
  outcome     text not null default '',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index follow_ups_due_idx on public.follow_ups (assigned_to, due_at) where done_at is null;

create table public.site_visits (
  id               uuid primary key default gen_random_uuid(),
  enquiry_id       uuid not null references public.enquiries (id) on delete cascade,
  property_id      text not null references public.properties (id),
  scheduled_at     timestamptz not null,
  status           text not null default 'scheduled' check (status in ('scheduled', 'visited', 'no_show', 'cancelled')),
  notes            text not null default '',
  reminder_sent_at timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index site_visits_when_idx on public.site_visits (scheduled_at) where status = 'scheduled';

create table public.broker_commissions (
  id          uuid primary key default gen_random_uuid(),
  broker_id   uuid not null references public.brokers (id) on delete cascade,
  enquiry_id  uuid references public.enquiries (id) on delete set null,
  booking_id  uuid unique references public.bookings (id) on delete set null,
  customer_id uuid references public.profiles (id) on delete set null,
  amount      int not null check (amount >= 0),
  status      text not null default 'payable' check (status in ('payable', 'paid', 'cancelled')),
  paid_on     date,
  mode        text,
  reference   text,
  created_at  timestamptz not null default now()
);

create table public.referrals (
  id                    uuid primary key default gen_random_uuid(),
  referrer_customer_id  uuid not null references public.profiles (id) on delete cascade,
  enquiry_id            uuid unique references public.enquiries (id) on delete set null,
  referred_customer_id  uuid references public.profiles (id) on delete set null,
  reward_type           text not null check (reward_type in ('discount', 'cash')),
  reward_amount         int not null check (reward_amount >= 0),
  status                text not null default 'pending' check (status in ('pending', 'earned', 'applied', 'paid', 'cancelled')),
  applied_at            timestamptz,
  created_at            timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('lead_assignment', '{"mode":"round_robin"}'::jsonb),            -- round_robin | by_property | manual
  ('lead_hot_days', '7'::jsonb), ('lead_warm_days', '30'::jsonb),
  ('referral_reward', '{"type":"discount","amount":1000}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- lead rules
create function public.enquiry_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare hot int := coalesce((public.setting('lead_hot_days') #>> '{}')::int, 7);
  warm int := coalesce((public.setting('lead_warm_days') #>> '{}')::int, 30); mode text; pick uuid;
begin
  new.phone := regexp_replace(new.phone, '\D', '', 'g');
  if length(new.phone) = 12 and new.phone like '91%' then new.phone := substr(new.phone, 3); end if;
  if not new.temperature_manual and (tg_op = 'INSERT' or new.move_in is distinct from old.move_in) then
    new.temperature := case when new.move_in is null then 'warm' when new.move_in - current_date <= hot then 'hot'
                            when new.move_in - current_date <= warm then 'warm' else 'cold' end;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    -- duplicate detection on mobile number: point at the first lead with that number
    select id into new.duplicate_of from public.enquiries where phone = new.phone and id <> new.id order by received_at limit 1;
    if new.assigned_to is null then
      mode := coalesce(public.setting('lead_assignment') ->> 'mode', 'round_robin');
      if mode <> 'manual' then
        select p.id into pick from public.profiles p
        where p.role = 'sales' and p.is_active
          and (mode <> 'by_property' or new.property_id is null
               or exists (select 1 from public.property_members m where m.user_id = p.id and m.property_id = new.property_id))
        order by (select max(received_at) from public.enquiries e where e.assigned_to = p.id) nulls first, p.created_at
        limit 1;
        new.assigned_to := pick;
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger enquiries_before before insert or update on public.enquiries for each row execute function public.enquiry_before();

create function public.enquiry_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.enquiry_activities (enquiry_id, kind, notes, created_by)
    values (new.id, 'system', 'Enquiry received from ' || replace(new.source, '_', ' ')
            || case when new.duplicate_of is not null then ' (same mobile as an earlier enquiry)' else '' end, auth.uid());
    if new.assigned_to is not null then
      perform public.notify(new.assigned_to, array['in_app', 'push'], 'lead', 'New lead: ' || new.name,
        coalesce(nullif(new.room_type, ''), 'Enquiry') || ' - ' || new.phone, '/admin/enquiries/' || new.id, 'lead:' || new.id, 'enquiry', new.id::text);
    end if;
    if new.referrer_customer_id is not null then
      insert into public.referrals (referrer_customer_id, enquiry_id, reward_type, reward_amount)
      values (new.referrer_customer_id, new.id, coalesce(public.setting('referral_reward') ->> 'type', 'discount'),
              coalesce((public.setting('referral_reward') ->> 'amount')::int, 0))
      on conflict (enquiry_id) do nothing;
    end if;
  elsif new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    insert into public.enquiry_activities (enquiry_id, kind, notes, created_by)
    values (new.id, 'assign', 'Assigned to ' || (select full_name from public.profiles where id = new.assigned_to), auth.uid());
    perform public.notify(new.assigned_to, array['in_app', 'push'], 'lead', 'Lead assigned: ' || new.name, new.phone,
      '/admin/enquiries/' || new.id, 'lead-assign:' || new.id || ':' || new.assigned_to, 'enquiry', new.id::text);
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.enquiry_activities (enquiry_id, kind, notes, created_by)
    values (new.id, 'status', replace(old.status, '_', ' ') || ' -> ' || replace(new.status, '_', ' ')
            || case when new.status = 'lost' then ': ' || coalesce(new.lost_reason, '') || ' ' || new.lost_note else '' end, auth.uid());
  end if;
  return null;
end $$;
create trigger enquiries_after after insert or update on public.enquiries for each row execute function public.enquiry_after();

create function public.enquiry_guard_status() returns trigger
language plpgsql as $$
begin
  if new.status = 'lost' and new.lost_reason is null then raise exception 'Choose why the lead was lost'; end if;
  if new.status <> 'lost' then new.lost_reason := null; end if;
  return new;
end $$;
create trigger enquiries_status_guard before insert or update of status, lost_reason on public.enquiries
  for each row execute function public.enquiry_guard_status();

-- ---------------------------------------------------------------- capture
-- public website / app / tracked links: anyone may call this. Same mobile within an open lead adds to that lead.
create function public.submit_enquiry(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare ph text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'); existing uuid; eid uuid; camp public.campaigns%rowtype;
  src text := coalesce(nullif(p ->> 'source', ''), 'website');
begin
  if length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
  if length(ph) < 10 or length(ph) > 13 then raise exception 'Enter a valid mobile number'; end if;
  if coalesce(trim(p ->> 'name'), '') = '' then raise exception 'Enter your name'; end if;
  if char_length(coalesce(p ->> 'message', '')) > 2000 then raise exception 'Message is too long'; end if;
  -- flood guard: at most 5 submissions per number per hour
  if (select count(*) from public.enquiry_submissions where payload ->> 'phone_digits' = ph and received_at > now() - interval '1 hour') >= 5 then
    raise exception 'We already have your enquiry. We will call you soon.';
  end if;
  if nullif(p ->> 'campaign_code', '') is not null then
    select * into camp from public.campaigns where lower(code) = lower(p ->> 'campaign_code');
  end if;
  if src not in ('website', 'app', 'google_ads', 'google_business', 'facebook', 'instagram', 'whatsapp', 'call', 'walk_in',
                 'justdial', 'broker', 'referral', 'hoarding', 'pamphlet', 'college_tieup', 'corporate_tieup', 'other') then
    src := 'other';
  end if;
  if camp.id is not null and camp.channel in ('google_ads', 'google_business', 'facebook', 'instagram', 'justdial', 'hoarding',
                                              'pamphlet', 'college_tieup', 'corporate_tieup', 'whatsapp') then
    src := camp.channel;
  end if;
  select id into existing from public.enquiries where phone = ph and status not in ('booked', 'lost') order by received_at desc limit 1;
  if existing is not null then
    insert into public.enquiry_activities (enquiry_id, kind, notes)
    values (existing, 'system', 'Enquired again via ' || replace(src, '_', ' ') || coalesce(': ' || nullif(p ->> 'message', ''), ''));
    update public.enquiries set temperature = case when temperature = 'cold' and not temperature_manual then 'warm' else temperature end,
      move_in = coalesce(nullif(p ->> 'move_in', '')::date, move_in) where id = existing;
    eid := existing;
  else
    insert into public.enquiries (property_id, name, phone, email, room_type, budget, move_in, source, message, campaign_id)
    values (coalesce(nullif(p ->> 'property_id', ''), camp.property_id, (select id from public.properties where is_active order by id limit 1)),
            left(trim(p ->> 'name'), 120), ph, left(coalesce(p ->> 'email', ''), 200), left(coalesce(p ->> 'room_type', ''), 80),
            nullif(regexp_replace(coalesce(p ->> 'budget', ''), '\D', '', 'g'), '')::int, nullif(p ->> 'move_in', '')::date,
            src, coalesce(p ->> 'message', ''), camp.id)
    returning id into eid;
  end if;
  insert into public.enquiry_submissions (enquiry_id, source, payload) values (eid, src, p || jsonb_build_object('phone_digits', ph));
  return eid;
end $$;

-- CSV import (PRD 8.1): array of rows with the same keys as submit_enquiry, plus status / source
create function public.import_enquiries(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; n_new int := 0; n_dup int := 0; n_bad int := 0; errs jsonb := '[]'; v_id uuid; ph text; i int := 0;
begin
  if not public.current_app_role() in ('admin', 'manager', 'sales') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import at most 5000 rows at a time'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      ph := regexp_replace(coalesce(r ->> 'phone', ''), '\D', '', 'g');
      if length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
      if nullif(r ->> 'property_id', '') is not null and not public.can_sell_property(r ->> 'property_id') then
        raise exception 'not your property';
      end if;
      insert into public.enquiries (property_id, name, phone, email, room_type, budget, move_in, source, message, status, lost_reason, received_at)
      values (nullif(r ->> 'property_id', ''), trim(r ->> 'name'), ph, coalesce(r ->> 'email', ''), coalesce(r ->> 'room_type', ''),
              nullif(regexp_replace(coalesce(r ->> 'budget', ''), '\D', '', 'g'), '')::int, nullif(r ->> 'move_in', '')::date,
              coalesce(nullif(r ->> 'source', ''), 'other'), coalesce(r ->> 'message', ''), coalesce(nullif(r ->> 'status', ''), 'new'),
              nullif(r ->> 'lost_reason', ''), coalesce(nullif(r ->> 'received_at', '')::timestamptz, now()))
      returning id into v_id;
      insert into public.enquiry_submissions (enquiry_id, source, payload) values (v_id, 'import', r);
      if (select duplicate_of from public.enquiries where enquiries.id = v_id) is not null then n_dup := n_dup + 1; end if;
      n_new := n_new + 1;
    exception when others then
      n_bad := n_bad + 1;
      errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
    end;
  end loop;
  perform public.log_activity('enquiries.imported', 'enquiry', null, jsonb_build_object('rows', n_new, 'failed', n_bad));
  return jsonb_build_object('imported', n_new, 'duplicates', n_dup, 'failed', n_bad, 'errors', errs);
end $$;

create function public.can_see_enquiry(e public.enquiries) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or e.assigned_to = auth.uid()
    or (e.property_id is not null and public.can_sell_property(e.property_id))
    or (e.property_id is null and public.current_app_role() in ('manager', 'sales'))
$$;

create function public.log_lead_activity(p_enquiry uuid, p_kind text, p_outcome text, p_notes text, p_next_step text default '',
                                         p_follow_up timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare e public.enquiries%rowtype;
begin
  select * into e from public.enquiries where id = p_enquiry;
  if not found or not public.can_see_enquiry(e) then raise exception 'Lead not found'; end if;
  if p_kind not in ('note', 'call', 'whatsapp', 'sms', 'email') then raise exception 'Bad activity'; end if;
  insert into public.enquiry_activities (enquiry_id, kind, outcome, notes, next_step, created_by)
  values (p_enquiry, p_kind, coalesce(p_outcome, ''), coalesce(p_notes, ''), coalesce(p_next_step, ''), auth.uid());
  if e.status = 'new' and p_kind in ('call', 'whatsapp', 'sms', 'email') then
    update public.enquiries set status = 'contacted' where id = p_enquiry;
  end if;
  if p_follow_up is not null then perform public.schedule_follow_up(p_enquiry, p_follow_up, p_next_step); end if;
end $$;

create function public.schedule_follow_up(p_enquiry uuid, p_due timestamptz, p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.enquiries%rowtype; fid uuid;
begin
  select * into e from public.enquiries where id = p_enquiry;
  if not found or not public.can_see_enquiry(e) then raise exception 'Lead not found'; end if;
  if p_due is null then raise exception 'Choose a date and time'; end if;
  insert into public.follow_ups (enquiry_id, due_at, assigned_to, note, created_by)
  values (p_enquiry, p_due, coalesce(e.assigned_to, auth.uid()), coalesce(p_note, ''), auth.uid()) returning id into fid;
  update public.enquiries set next_follow_up_at = (select min(due_at) from public.follow_ups where enquiry_id = p_enquiry and done_at is null)
  where id = p_enquiry;
  insert into public.enquiry_activities (enquiry_id, kind, notes, created_by)
  values (p_enquiry, 'follow_up', 'Follow-up set for ' || to_char(p_due at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') ||
          coalesce(': ' || nullif(p_note, ''), ''), auth.uid());
  return fid;
end $$;

create function public.complete_follow_up(p_id uuid, p_outcome text) returns void
language plpgsql security definer set search_path = public as $$
declare f public.follow_ups%rowtype; e public.enquiries%rowtype;
begin
  select * into f from public.follow_ups where id = p_id;
  select * into e from public.enquiries where id = f.enquiry_id;
  if not found or not public.can_see_enquiry(e) then raise exception 'Follow-up not found'; end if;
  update public.follow_ups set done_at = now(), outcome = coalesce(p_outcome, '') where id = p_id;
  update public.enquiries set next_follow_up_at = (select min(due_at) from public.follow_ups where enquiry_id = e.id and done_at is null)
  where id = e.id;
  insert into public.enquiry_activities (enquiry_id, kind, notes, created_by)
  values (e.id, 'follow_up', 'Follow-up done: ' || coalesce(p_outcome, ''), auth.uid());
end $$;

-- site visit: schedule (sends confirmation to the lead), then mark visited / no-show
create function public.schedule_visit(p_enquiry uuid, p_when timestamptz, p_property text default null, p_notes text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.enquiries%rowtype; vid uuid; pr public.properties%rowtype; t record;
begin
  select * into e from public.enquiries where id = p_enquiry;
  if not found or not public.can_see_enquiry(e) then raise exception 'Lead not found'; end if;
  if p_when is null or p_when < now() - interval '1 hour' then raise exception 'Choose a future date and time'; end if;
  select * into pr from public.properties where id = coalesce(p_property, e.property_id, 'P1');
  insert into public.site_visits (enquiry_id, property_id, scheduled_at, notes, created_by)
  values (e.id, pr.id, p_when, coalesce(p_notes, ''), auth.uid()) returning id into vid;
  update public.enquiries set status = 'visit_scheduled', property_id = coalesce(property_id, pr.id) where id = e.id and status not in ('booked');
  select * into t from public.render_template('visit_confirmation', jsonb_build_object('name', e.name, 'property', pr.name,
    'when', to_char(p_when at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'), 'phone', pr.phone));
  if not e.opted_out then
    perform public.notify(null, array['sms', 'whatsapp', 'email'], 'visit', t.subject, t.body, null, 'visit-confirm:' || vid,
                          'visit', vid::text, e.phone, nullif(e.email, ''));
  end if;
  insert into public.enquiry_activities (enquiry_id, kind, notes, created_by)
  values (e.id, 'visit', 'Visit scheduled for ' || to_char(p_when at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), auth.uid());
  return vid;
end $$;

create function public.set_visit_status(p_visit uuid, p_status text, p_notes text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v public.site_visits%rowtype; e public.enquiries%rowtype;
begin
  select * into v from public.site_visits where id = p_visit;
  select * into e from public.enquiries where id = v.enquiry_id;
  if not found or not public.can_see_enquiry(e) then raise exception 'Visit not found'; end if;
  if p_status not in ('visited', 'no_show', 'cancelled') then raise exception 'Bad status'; end if;
  update public.site_visits set status = p_status, notes = trim(notes || ' ' || coalesce(p_notes, '')) where id = p_visit;
  if p_status = 'visited' and e.status in ('new', 'contacted', 'interested', 'visit_scheduled') then
    update public.enquiries set status = 'visited' where id = e.id;
  end if;
  insert into public.enquiry_activities (enquiry_id, kind, notes, created_by)
  values (e.id, 'visit', 'Visit ' || replace(p_status, '_', '-') || coalesce(': ' || nullif(p_notes, ''), ''), auth.uid());
end $$;

-- conversion: an office check-in from a lead marks it booked and creates referral / broker rewards
create function public.booking_from_enquiry() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.enquiries%rowtype; br public.brokers%rowtype; amt int;
begin
  if new.enquiry_id is null then return null; end if;
  select * into e from public.enquiries where id = new.enquiry_id;
  update public.enquiries set status = 'booked', converted_customer_id = new.customer_id, booking_id = new.id, converted_at = now()
  where id = e.id;
  if e.broker_id is not null then
    select * into br from public.brokers where id = e.broker_id;
    amt := case when br.commission_type = 'flat' then br.commission_value
                else round(new.rate * public.booking_units(new.id) * br.commission_value / 100) end;
    insert into public.broker_commissions (broker_id, enquiry_id, booking_id, customer_id, amount)
    values (br.id, e.id, new.id, new.customer_id, amt) on conflict (booking_id) do nothing;
  end if;
  update public.referrals set status = 'earned', referred_customer_id = new.customer_id where enquiry_id = e.id and status = 'pending';
  perform public.apply_referral_rewards();
  return null;
end $$;
create trigger bookings_from_enquiry after insert on public.bookings for each row execute function public.booking_from_enquiry();

-- earned referral rewards: discounts become credit for the referrer's next invoice; cash waits for payout
create function public.apply_referral_rewards() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select * from public.referrals where status = 'earned' and reward_type = 'discount' and reward_amount > 0 loop
    insert into public.tenant_credits (customer_id, booking_id, amount, reason)
    values (r.referrer_customer_id, (select id from public.bookings where customer_id = r.referrer_customer_id and status = 'active' limit 1),
            r.reward_amount, 'Referral reward');
    update public.referrals set status = 'applied', applied_at = now() where id = r.id;
    perform public.notify(r.referrer_customer_id, array['in_app', 'push'], 'referral', 'Referral reward',
      'Thanks for referring a friend! Rs ' || r.reward_amount || ' will be taken off your next rent.', '/account', 'referral:' || r.id,
      'referral', r.id::text);
    n := n + 1;
  end loop;
  return n;
end $$;

create function public.mark_referral_paid(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager_or_owner() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.referrals set status = 'paid', applied_at = now() where id = p_id and status = 'earned' and reward_type = 'cash';
  if not found then raise exception 'Only earned cash rewards can be marked paid'; end if;
end $$;

create function public.pay_broker_commission(p_id uuid, p_mode text, p_reference text, p_date date default current_date) returns void
language plpgsql security definer set search_path = public as $$
declare c public.broker_commissions%rowtype; prop text;
begin
  select * into c from public.broker_commissions where id = p_id for update;
  if not found or c.status <> 'payable' then raise exception 'Nothing payable'; end if;
  prop := public.booking_property(c.booking_id);
  perform public.require_manage(coalesce(prop, 'P1'));
  update public.broker_commissions set status = 'paid', paid_on = p_date, mode = p_mode, reference = p_reference where id = p_id;
  if c.amount > 0 then
    insert into public.expenses (property_id, category_id, spent_on, amount, vendor, payment_mode, notes, source, source_id, status, created_by)
    values (coalesce(prop, 'P1'), 'broker_commission', p_date, c.amount, (select name from public.brokers where id = c.broker_id),
            case when p_mode in ('cash', 'upi', 'bank_transfer', 'cheque', 'card') then p_mode else 'other' end,
            'Broker commission', 'commission', c.id::text, 'approved', auth.uid());
  end if;
end $$;

-- marketing spend: an approved expense tagged with the campaign (PRD 9.2)
create function public.add_campaign_spend(p_campaign uuid, p_amount int, p_date date, p_vendor text default '', p_notes text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.campaigns%rowtype; eid uuid;
begin
  select * into c from public.campaigns where id = p_campaign;
  if not found then raise exception 'Campaign not found'; end if;
  if not public.is_manager_or_owner() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if c.property_id is not null then perform public.require_manage(c.property_id); end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero'; end if;
  insert into public.expenses (property_id, category_id, spent_on, amount, vendor, notes, source, campaign_id, created_by)
  values (coalesce(c.property_id, 'P1'), 'marketing', coalesce(p_date, current_date), p_amount, coalesce(p_vendor, ''),
          'Campaign: ' || c.name || coalesce(' - ' || nullif(p_notes, ''), ''), 'marketing', c.id, auth.uid())
  returning id into eid;
  return eid;
end $$;

-- ---------------------------------------------------------------- offers
create function public.check_offer(p_code text, p_property text, p_check_in date, p_lock_in int, p_booked_on date default current_date)
returns public.offers language plpgsql stable security definer set search_path = public as $$
declare o public.offers%rowtype;
begin
  select * into o from public.offers where code = upper(trim(p_code));
  if not found or not o.is_active then raise exception 'Offer code % is not valid', upper(trim(p_code)); end if;
  if p_booked_on < o.valid_from or (o.valid_to is not null and p_booked_on > o.valid_to) then raise exception 'This offer has expired'; end if;
  if o.max_uses is not null and o.used_count >= o.max_uses then raise exception 'This offer has been fully used'; end if;
  if o.property_id is not null and o.property_id <> p_property then raise exception 'This offer is not valid for this property'; end if;
  if o.applies_to = 'long_stay' and coalesce(p_lock_in, 0) < o.min_months then
    raise exception 'This offer needs a lock-in of at least % months', o.min_months;
  end if;
  if o.applies_to = 'early_bird' and p_check_in - p_booked_on < o.min_days_ahead then
    raise exception 'Book at least % days before check-in for this offer', o.min_days_ahead;
  end if;
  return o;
end $$;

create or replace function public.apply_offer_to_bill(p_bill uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare bl public.bills%rowtype; b public.bookings%rowtype; o public.offers%rowtype; rent int; disc int;
begin
  select * into bl from public.bills where id = p_bill;
  select * into b from public.bookings where id = bl.booking_id;
  o := public.check_offer(p_code, b.property_id, b.check_in, b.lock_in_months, b.created_at::date);
  select coalesce(sum(amount), 0) into rent from public.bill_lines where bill_id = p_bill and kind = 'rent';
  disc := least(rent, case when o.kind = 'flat' then o.value::int else round(rent * o.value / 100)::int end);
  if disc > 0 then
    insert into public.bill_lines (bill_id, kind, description, amount, reason, meta)
    values (p_bill, 'discount', 'Offer ' || o.code || ': ' || o.description, -disc, 'Offer ' || o.code, jsonb_build_object('offer', o.code));
    update public.offers set used_count = used_count + 1 where code = o.code;
  end if;
end $$;

-- ---------------------------------------------------------------- bulk messages and opt-out (PRD 9.2)
create function public.send_bulk_message(p_enquiries uuid[], p_channels text[], p_subject text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.enquiries%rowtype; sent int := 0; skipped int := 0; url text := coalesce(public.setting('site_url') #>> '{}', '');
  batch text := gen_random_uuid()::text;
begin
  if not public.current_app_role() in ('admin', 'manager', 'sales') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write a message'; end if;
  if p_channels is null or not p_channels <@ array['sms', 'whatsapp', 'email'] then raise exception 'Choose SMS, WhatsApp or email'; end if;
  if coalesce(array_length(p_enquiries, 1), 0) > 2000 then raise exception 'At most 2000 recipients at a time'; end if;
  for e in select * from public.enquiries where id = any (p_enquiries) loop
    if e.opted_out or not public.can_see_enquiry(e) then skipped := skipped + 1; continue; end if;
    perform public.notify(null, p_channels, 'campaign', coalesce(p_subject, ''),
      replace(p_body, '{{name}}', e.name) || E'\nTo stop these messages: ' || url || '/unsubscribe?t=' || e.unsub_token,
      null, 'bulk:' || batch || ':' || e.id, 'enquiry', e.id::text, e.phone, nullif(e.email, ''));
    sent := sent + 1;
  end loop;
  perform public.log_activity('campaign.bulk_message', 'enquiry', null, jsonb_build_object('sent', sent, 'skipped', skipped));
  return jsonb_build_object('sent', sent, 'skipped_opted_out_or_hidden', skipped);
end $$;

create function public.unsubscribe(p_token uuid) returns boolean
language sql security definer set search_path = public as $$
  with u as (update public.enquiries set opted_out = true where unsub_token = p_token returning 1) select exists (select 1 from u)
$$;

-- ---------------------------------------------------------------- jobs
create function public.run_sales_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare v record; f record; n int := 0; t record;
begin
  for v in select sv.*, e.name, e.phone, e.email, e.opted_out, e.assigned_to, p.name pname from public.site_visits sv
           join public.enquiries e on e.id = sv.enquiry_id join public.properties p on p.id = sv.property_id
           where sv.status = 'scheduled' and sv.reminder_sent_at is null and sv.scheduled_at between now() and now() + interval '24 hours' loop
    select * into t from public.render_template('visit_reminder', jsonb_build_object('name', v.name, 'property', v.pname,
      'when', to_char(v.scheduled_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM')));
    if not v.opted_out then
      perform public.notify(null, array['sms', 'whatsapp'], 'visit', t.subject, t.body, null, 'visit-remind:' || v.id, 'visit', v.id::text, v.phone);
    end if;
    if v.assigned_to is not null then
      perform public.notify(v.assigned_to, array['in_app', 'push'], 'visit', 'Visit today: ' || v.name, t.body,
        '/admin/enquiries/' || v.enquiry_id, 'visit-exec:' || v.id, 'visit', v.id::text);
    end if;
    update public.site_visits set reminder_sent_at = now() where id = v.id;
    n := n + 1;
  end loop;
  for f in select fu.*, e.name from public.follow_ups fu join public.enquiries e on e.id = fu.enquiry_id
           where fu.done_at is null and fu.assigned_to is not null and fu.due_at < (current_date + 1)::timestamptz loop
    perform public.notify(f.assigned_to, array['in_app', 'push'], 'follow_up',
      case when f.due_at < now() then 'Overdue follow-up: ' else 'Follow-up today: ' end || f.name, f.note,
      '/admin/enquiries/' || f.enquiry_id, 'fu:' || f.id || ':' || current_date, 'enquiry', f.enquiry_id::text);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.campaigns           enable row level security;
alter table public.brokers             enable row level security;
alter table public.offers              enable row level security;
alter table public.enquiries           enable row level security;
alter table public.enquiry_submissions enable row level security;
alter table public.enquiry_activities  enable row level security;
alter table public.follow_ups          enable row level security;
alter table public.site_visits         enable row level security;
alter table public.broker_commissions  enable row level security;
alter table public.referrals           enable row level security;

grant select on public.campaigns, public.brokers, public.offers, public.enquiries, public.enquiry_submissions,
  public.enquiry_activities, public.follow_ups, public.site_visits, public.broker_commissions, public.referrals to authenticated;
grant insert, update, delete on public.campaigns, public.brokers, public.offers to authenticated;
grant insert on public.enquiries to authenticated;
grant update (property_id, name, phone, email, room_type, budget, move_in, source, message, campaign_id, broker_id,
  referrer_customer_id, status, lost_reason, lost_note, temperature, temperature_manual, assigned_to, opted_out)
  on public.enquiries to authenticated;

create function public.is_sales_team() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('admin', 'manager', 'sales'), false)
$$;
grant execute on function public.is_sales_team() to authenticated;

create policy campaigns_read on public.campaigns for select using (public.is_sales_team());
create policy campaigns_write on public.campaigns for all
  using (public.is_manager_or_owner() and (property_id is null or public.can_manage_property(property_id)))
  with check (public.is_manager_or_owner() and (property_id is null or public.can_manage_property(property_id)));
create policy brokers_read on public.brokers for select using (public.is_sales_team());
create policy brokers_write on public.brokers for all using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());
create policy offers_read on public.offers for select using (public.is_sales_team());
create policy offers_write on public.offers for all using (public.is_admin()) with check (public.is_admin());
create policy enquiries_read on public.enquiries for select using (public.can_see_enquiry(enquiries));
create policy enquiries_insert on public.enquiries for insert
  with check (public.is_sales_team() and (property_id is null or public.can_sell_property(property_id)));
create policy enquiries_update on public.enquiries for update using (public.can_see_enquiry(enquiries))
  with check (public.is_sales_team() and (property_id is null or public.can_sell_property(property_id) or assigned_to = auth.uid()));
create policy submissions_read on public.enquiry_submissions for select using (exists (select 1 from public.enquiries e
  where e.id = enquiry_id and public.can_see_enquiry(e)) or (enquiry_id is null and public.is_manager_or_owner()));
create policy activities_read on public.enquiry_activities for select using (exists (select 1 from public.enquiries e
  where e.id = enquiry_id and public.can_see_enquiry(e)));
create policy follow_ups_read on public.follow_ups for select using (exists (select 1 from public.enquiries e
  where e.id = enquiry_id and public.can_see_enquiry(e)));
create policy visits_read on public.site_visits for select using (exists (select 1 from public.enquiries e
  where e.id = enquiry_id and public.can_see_enquiry(e)));
create policy commissions_read on public.broker_commissions for select using (public.is_manager_or_owner());
create policy referrals_read on public.referrals for select using (referrer_customer_id = auth.uid() or public.is_manager_or_owner());

revoke all on function public.submit_enquiry(jsonb), public.unsubscribe(uuid) from public;
grant execute on function public.submit_enquiry(jsonb), public.unsubscribe(uuid) to anon, authenticated, service_role;
revoke all on function public.import_enquiries(jsonb), public.can_see_enquiry(public.enquiries),
  public.log_lead_activity(uuid, text, text, text, text, timestamptz), public.schedule_follow_up(uuid, timestamptz, text),
  public.complete_follow_up(uuid, text), public.schedule_visit(uuid, timestamptz, text, text), public.set_visit_status(uuid, text, text),
  public.apply_referral_rewards(), public.mark_referral_paid(uuid), public.pay_broker_commission(uuid, text, text, date),
  public.add_campaign_spend(uuid, int, date, text, text), public.check_offer(text, text, date, int, date),
  public.send_bulk_message(uuid[], text[], text, text), public.run_sales_reminders() from public, anon;
revoke all on function public.apply_referral_rewards(), public.run_sales_reminders() from authenticated;
grant execute on function public.apply_referral_rewards(), public.run_sales_reminders() to service_role;
grant execute on function public.import_enquiries(jsonb), public.can_see_enquiry(public.enquiries),
  public.log_lead_activity(uuid, text, text, text, text, timestamptz), public.schedule_follow_up(uuid, timestamptz, text),
  public.complete_follow_up(uuid, text), public.schedule_visit(uuid, timestamptz, text, text), public.set_visit_status(uuid, text, text),
  public.mark_referral_paid(uuid), public.pay_broker_commission(uuid, text, text, date),
  public.add_campaign_spend(uuid, int, date, text, text), public.check_offer(text, text, date, int, date),
  public.send_bulk_message(uuid[], text[], text, text) to authenticated, service_role;
