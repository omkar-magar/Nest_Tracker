-- PRD 3: tenant records (registration, emergency/guardian contacts, approval, police verification),
-- document verification, stays (check-in/out, notice, transfers, checklists), rental agreements,
-- notices and the notification outbox used by reminders, complaints, visits and alerts.

-- ---------------------------------------------------------------- tenant profile
create table public.tenant_profiles (
  user_id              uuid primary key references public.profiles (id) on delete cascade,
  property_id          text references public.properties (id),
  email                text,
  photo_path           text,                     -- customer-documents bucket, <user_id>/...
  dob                  date check (dob is null or dob < current_date),
  gender               text check (gender in ('male', 'female', 'other', 'undisclosed')),
  permanent_address    text not null default '',
  occupation           text check (occupation in ('student', 'working', 'other')),
  organisation         text not null default '',   -- college or company
  work_address         text not null default '',
  emergency1_name      text not null default '',
  emergency1_relation  text not null default '',
  emergency1_phone     text not null default '',
  emergency2_name      text not null default '',
  emergency2_relation  text not null default '',
  emergency2_phone     text not null default '',
  guardian_name        text not null default '',
  guardian_relation    text not null default '',
  guardian_phone       text not null default '',
  guardian_email       text not null default '',
  guardian_consent_payments   boolean not null default false,   -- copy rent reminders to the guardian
  guardian_consent_complaints boolean not null default false,   -- copy complaint updates to the guardian
  phone_verified       boolean not null default false,          -- true once the tenant logged in with a phone OTP
  approval_status      text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  approval_note        text not null default '',
  approved_by          uuid references public.profiles (id) on delete set null,
  approved_at          timestamptz,
  police_status        text not null default 'pending'
                         check (police_status in ('not_required', 'pending', 'submitted', 'verified', 'rejected')),
  police_ref           text not null default '',
  police_submitted_on  date,
  risk_flag            boolean not null default false,          -- repeat late payer (set by the jobs)
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index tenant_profiles_property_idx on public.tenant_profiles (property_id);

-- ---------------------------------------------------------------- stays (bookings) gain PG fields
alter table public.bookings
  add column property_id        text references public.properties (id),
  add column expected_checkout  date,
  add column actual_checkout    date,
  add column notice_date        date,
  add column notice_period_days int not null default 30 check (notice_period_days between 0 and 180),
  add column lock_in_months     int not null default 0 check (lock_in_months between 0 and 36),
  add column source             text not null default 'online' check (source in ('online', 'office')),
  add column enquiry_id         uuid,
  add column offer_code         text,
  add column checked_in_by      uuid references public.profiles (id) on delete set null;

create function public.booking_set_property() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.property_id := (select property_id from public.rooms where id = new.room_id);
  return new;
end $$;
create trigger bookings_property before insert or update of room_id on public.bookings
  for each row execute function public.booking_set_property();
update public.bookings b set property_id = r.property_id from public.rooms r where r.id = b.room_id;
create index bookings_property_idx on public.bookings (property_id, status);

create function public.booking_property(p_booking uuid) returns text
language sql stable security definer set search_path = public as $$
  select property_id from public.bookings where id = p_booking
$$;

-- can the caller (owner / manager) see this user's tenant data?
create function public.can_see_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.current_app_role() = 'manager' and (
    exists (select 1 from public.tenant_profiles t where t.user_id = p_user and public.can_manage_property(t.property_id))
    or exists (select 1 from public.bookings b where b.customer_id = p_user and public.can_manage_property(b.property_id))
    or exists (select 1 from public.property_members m where m.user_id = p_user and public.can_manage_property(m.property_id))))
$$;
revoke all on function public.booking_property(uuid), public.can_see_user(uuid) from public;
grant execute on function public.booking_property(uuid), public.can_see_user(uuid) to authenticated, service_role;

create table public.stay_transfers (
  id            bigint generated always as identity primary key,
  booking_id    uuid not null references public.bookings (id) on delete cascade,
  from_room_id  text references public.rooms (id),
  to_room_id    text references public.rooms (id),
  from_beds     text not null,
  to_beds       text not null,
  old_rate      int not null,
  new_rate      int not null,
  transfer_date date not null,
  reason        text not null default '',
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index stay_transfers_booking_idx on public.stay_transfers (booking_id);

create table public.stay_checklists (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings (id) on delete cascade,
  kind           text not null check (kind in ('check_in', 'check_out')),
  items          jsonb not null default '[]',       -- [{ "item": "Cupboard key", "ok": true, "note": "" }]
  room_condition text not null default '',
  keys_count     int not null default 0,
  photos         text[] not null default '{}',     -- customer-documents bucket paths
  notes          text not null default '',
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (booking_id, kind)
);

-- ---------------------------------------------------------------- documents gain verification
alter table public.customer_documents
  add column id_type      text check (id_type in ('aadhaar', 'driving_licence', 'passport', 'voter_id', 'college_id',
                                                  'company_id', 'pan', 'other')),
  add column side         text not null default 'single' check (side in ('front', 'back', 'single')),
  add column id_last4     text check (id_last4 is null or id_last4 ~ '^[0-9A-Za-z]{4}$'),  -- only the last 4 are kept
  add column status       text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  add column review_note  text not null default '',
  add column reviewed_by  uuid references public.profiles (id) on delete set null,
  add column reviewed_at  timestamptz,
  add column uploaded_by  uuid references public.profiles (id) on delete set null;
alter table public.customer_documents drop constraint customer_documents_doc_type_check;
alter table public.customer_documents add constraint customer_documents_doc_type_check
  check (doc_type in ('id_proof', 'address_proof', 'photo', 'agreement', 'police_verification', 'checklist', 'payment_proof', 'other'));

-- a tenant cannot mark their own document verified
create function public.docs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
    if not public.can_see_user(new.customer_id) then
      new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.review_note := '';
    end if;
  end if;
  return new;
end $$;
create trigger customer_documents_guard before insert on public.customer_documents
  for each row execute function public.docs_guard();

-- ---------------------------------------------------------------- agreements (PRD 3.4)
create table public.agreements (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings (id) on delete cascade,
  customer_id        uuid not null references public.profiles (id) on delete cascade,
  property_id        text references public.properties (id),
  start_date         date not null,
  end_date           date not null,
  lock_in_months     int not null default 0,
  notice_period_days int not null default 30,
  rent               int not null check (rent >= 0),
  deposit            int not null default 0 check (deposit >= 0),
  rules              text not null default '',
  body               text not null default '',          -- generated from the template
  status             text not null default 'draft' check (status in ('draft', 'sent', 'active', 'expired', 'terminated')),
  rules_accepted     boolean not null default false,
  accepted_at        timestamptz,
  accepted_name      text,
  acceptance_method  text check (acceptance_method in ('upload', 'click', 'otp')),
  document_id        uuid references public.customer_documents (id) on delete set null,   -- signed PDF
  expiry_alerted_at  timestamptz,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  check (end_date > start_date)
);
create index agreements_customer_idx on public.agreements (customer_id);
create index agreements_end_idx on public.agreements (end_date) where status in ('sent', 'active');

-- ---------------------------------------------------------------- notices / announcements
create table public.notices (
  id          uuid primary key default gen_random_uuid(),
  property_id text references public.properties (id) on delete cascade,   -- null = every property
  audience    text not null check (audience in ('tenants', 'staff', 'all')),
  title       text not null check (char_length(title) between 2 and 160),
  body        text not null default '',
  expires_on  date,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index notices_created_idx on public.notices (created_at desc);

-- ---------------------------------------------------------------- notifications
-- One row per message per channel. 'in_app' rows are the user's inbox. Every other channel is an outbox
-- that supabase/functions/send-notifications delivers (email, SMS, WhatsApp, web push) with whatever
-- provider keys are configured; without keys a row is marked 'skipped', never silently lost.
create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete cascade,
  to_phone    text,
  to_email    text,
  channel     text not null check (channel in ('in_app', 'push', 'sms', 'whatsapp', 'email')),
  kind        text not null default 'general',     -- rent_reminder, complaint, visit, alert, report, campaign, ...
  subject     text not null default '',
  body        text not null,
  link        text,
  status      text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped', 'read')),
  dedupe_key  text unique,
  entity      text,
  entity_id   text,
  attempts    int not null default 0,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc) where channel = 'in_app';
create index notifications_queue_idx on public.notifications (created_at) where status = 'queued' and channel <> 'in_app';

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create table public.message_templates (
  key      text primary key,               -- e.g. rent_reminder
  subject  text not null default '',
  body     text not null                   -- {{name}} {{amount}} {{due_date}} {{link}} {{property}} ...
);
insert into public.message_templates (key, subject, body) values
  ('rent_reminder_before', 'Rent due on {{due_date}}',
   'Hi {{name}}, your {{description}} of Rs {{amount}} is due on {{due_date}}. Pay here: {{link}}'),
  ('rent_reminder_due', 'Rent due today',
   'Hi {{name}}, your {{description}} of Rs {{amount}} is due today ({{due_date}}). Pay here: {{link}}'),
  ('rent_reminder_overdue', 'Rent overdue',
   'Hi {{name}}, your {{description}} of Rs {{amount}} was due on {{due_date}} and is still unpaid. Please pay now: {{link}}'),
  ('payment_receipt', 'Payment received',
   'Hi {{name}}, we received Rs {{amount}} for {{description}}. Download your receipt: {{link}}'),
  ('complaint_update', 'Complaint {{status}}',
   'Your complaint "{{title}}" is now {{status}}. {{note}}'),
  ('visit_confirmation', 'Visit confirmed',
   'Hi {{name}}, your visit to {{property}} is booked for {{when}}. Call {{phone}} if you need to change it.'),
  ('visit_reminder', 'Visit reminder',
   'Hi {{name}}, reminder: your visit to {{property}} is at {{when}}.'),
  ('document_rejected', 'Please upload your document again',
   'Hi {{name}}, your {{document}} could not be verified: {{note}}. Please upload it again in the app.'),
  ('agreement_ready', 'Your rental agreement',
   'Hi {{name}}, your rental agreement is ready. Review and accept it here: {{link}}')
on conflict (key) do nothing;

-- Internal: queue one message on several channels. Contacts come from the profile / tenant profile.
create function public.notify(p_user uuid, p_channels text[], p_kind text, p_subject text, p_body text,
                              p_link text default null, p_dedupe text default null,
                              p_entity text default null, p_entity_id text default null,
                              p_to_phone text default null, p_to_email text default null)
returns void language plpgsql security definer set search_path = public as $$
declare ch text; ph text; em text;
begin
  if p_user is not null then
    select p.phone, coalesce(nullif(t.email, ''), u.email) into ph, em
    from public.profiles p left join public.tenant_profiles t on t.user_id = p.id left join auth.users u on u.id = p.id
    where p.id = p_user;
  end if;
  ph := coalesce(p_to_phone, ph); em := coalesce(p_to_email, em);
  foreach ch in array p_channels loop
    if ch in ('in_app', 'push') and p_user is null then continue; end if;
    if ch in ('sms', 'whatsapp') and coalesce(ph, '') = '' then continue; end if;
    if ch = 'email' and coalesce(em, '') = '' then continue; end if;
    insert into public.notifications (user_id, to_phone, to_email, channel, kind, subject, body, link, dedupe_key, entity, entity_id)
    values (p_user, case when ch in ('sms', 'whatsapp') then ph end, case when ch = 'email' then em end,
            ch, p_kind, coalesce(p_subject, ''), p_body, p_link,
            case when p_dedupe is not null then p_dedupe || ':' || ch end, p_entity, p_entity_id)
    on conflict (dedupe_key) do nothing;
  end loop;
end $$;
revoke all on function public.notify(uuid, text[], text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.notify(uuid, text[], text, text, text, text, text, text, text, text, text) to service_role;

-- {{key}} substitution for message_templates
create function public.render_template(p_key text, p_vars jsonb, out subject text, out body text)
language plpgsql stable security definer set search_path = public as $$
declare k text; v text;
begin
  select t.subject, t.body into subject, body from public.message_templates t where t.key = p_key;
  if body is null then subject := ''; body := ''; return; end if;
  for k, v in select * from jsonb_each_text(p_vars) loop
    subject := replace(subject, '{{' || k || '}}', coalesce(v, ''));
    body := replace(body, '{{' || k || '}}', coalesce(v, ''));
  end loop;
end $$;
revoke all on function public.render_template(text, jsonb) from public, anon;
grant execute on function public.render_template(text, jsonb) to authenticated, service_role;

-- alert every owner and every manager of a property (in-app + push)
create function public.alert_managers(p_property text, p_kind text, p_subject text, p_body text, p_link text,
                                      p_dedupe text, p_entity text default null, p_entity_id text default null)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in
    select id from public.profiles where role = 'admin' and is_active
    union
    select m.user_id from public.property_members m join public.profiles p on p.id = m.user_id
    where m.property_id = p_property and p.role = 'manager' and p.is_active
  loop
    perform public.notify(u, array['in_app', 'push'], p_kind, p_subject, p_body, p_link,
                          case when p_dedupe is not null then p_dedupe || ':' || u end, p_entity, p_entity_id);
  end loop;
end $$;
revoke all on function public.alert_managers(text, text, text, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.tenant_profiles    enable row level security;
alter table public.stay_transfers     enable row level security;
alter table public.stay_checklists    enable row level security;
alter table public.agreements         enable row level security;
alter table public.notices            enable row level security;
alter table public.notifications      enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.message_templates  enable row level security;

grant select on public.tenant_profiles, public.stay_transfers, public.stay_checklists, public.agreements,
  public.notices, public.notifications, public.push_subscriptions, public.message_templates to authenticated;
grant insert, update, delete on public.notices, public.stay_checklists, public.message_templates to authenticated;
grant insert, delete on public.push_subscriptions to authenticated;

create policy tenant_profiles_own   on public.tenant_profiles for select using (user_id = auth.uid());
create policy tenant_profiles_staff on public.tenant_profiles for select using (public.can_see_user(user_id));

-- managers see the people, stays, bills and payments of their own properties
create policy profiles_manager_read on public.profiles for select using (public.can_see_user(id));
create policy bookings_manager on public.bookings for select using (public.can_manage_property(property_id));
create policy booking_beds_manager on public.booking_beds for select
  using (public.can_manage_property(public.booking_property(booking_id)));
create policy bills_manager on public.bills for select using (public.can_manage_property(public.booking_property(booking_id)));
create policy payments_manager on public.payments for select
  using (public.can_manage_property((select public.booking_property(b.booking_id) from public.bills b where b.id = bill_id)));
create policy docs_staff_read on public.customer_documents for select using (public.can_see_user(customer_id));
create policy docs_staff_insert on public.customer_documents for insert
  with check (public.can_see_user(customer_id) and file_path like customer_id::text || '/%');

create policy transfers_read on public.stay_transfers for select
  using (public.can_manage_property(public.booking_property(booking_id))
         or exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()));
create policy checklists_read on public.stay_checklists for select
  using (public.can_manage_property(public.booking_property(booking_id))
         or exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()));
create policy checklists_write on public.stay_checklists for all
  using (public.can_manage_property(public.booking_property(booking_id)))
  with check (public.can_manage_property(public.booking_property(booking_id)));

create policy agreements_own   on public.agreements for select using (customer_id = auth.uid() and status <> 'draft');
create policy agreements_staff on public.agreements for select using (public.can_manage_property(property_id));

create policy notices_tenant on public.notices for select using (
  audience in ('tenants', 'all') and (expires_on is null or expires_on >= current_date)
  and (property_id is null or exists (select 1 from public.bookings b where b.customer_id = auth.uid()
        and b.property_id = notices.property_id and b.status in ('pending', 'active'))));
create policy notices_staff on public.notices for select using (
  public.current_app_role() in ('admin', 'manager', 'employee', 'sales')
  and (property_id is null or public.can_access_property(property_id)));
create policy notices_write on public.notices for all
  using (case when property_id is null then public.is_admin() else public.can_manage_property(property_id) end)
  with check (case when property_id is null then public.is_admin() else public.can_manage_property(property_id) end);

create policy notifications_own on public.notifications for select using (user_id = auth.uid() and channel = 'in_app');
create policy notifications_admin on public.notifications for select using (public.is_admin());

create policy push_own on public.push_subscriptions for select using (user_id = auth.uid());
create policy push_insert on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy push_delete on public.push_subscriptions for delete using (user_id = auth.uid());

create policy templates_read on public.message_templates for select using (public.is_manager_or_owner());
create policy templates_write on public.message_templates for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- RPCs
create function public.mark_notifications_read(p_ids bigint[] default null) returns void
language sql security definer set search_path = public as $$
  update public.notifications set status = 'read'
  where user_id = auth.uid() and channel = 'in_app' and status <> 'read' and (p_ids is null or id = any (p_ids));
$$;

-- shared field list for both the tenant's own save and the office's save
create function public.apply_tenant_fields(p_user uuid, f jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_profiles (user_id, created_by) values (p_user, auth.uid()) on conflict do nothing;
  update public.tenant_profiles t set
    email = coalesce(f ->> 'email', t.email),
    photo_path = coalesce(f ->> 'photo_path', t.photo_path),
    dob = coalesce(nullif(f ->> 'dob', '')::date, t.dob),
    gender = coalesce(nullif(f ->> 'gender', ''), t.gender),
    permanent_address = coalesce(f ->> 'permanent_address', t.permanent_address),
    occupation = coalesce(nullif(f ->> 'occupation', ''), t.occupation),
    organisation = coalesce(f ->> 'organisation', t.organisation),
    work_address = coalesce(f ->> 'work_address', t.work_address),
    emergency1_name = coalesce(f ->> 'emergency1_name', t.emergency1_name),
    emergency1_relation = coalesce(f ->> 'emergency1_relation', t.emergency1_relation),
    emergency1_phone = coalesce(regexp_replace(f ->> 'emergency1_phone', '\D', '', 'g'), t.emergency1_phone),
    emergency2_name = coalesce(f ->> 'emergency2_name', t.emergency2_name),
    emergency2_relation = coalesce(f ->> 'emergency2_relation', t.emergency2_relation),
    emergency2_phone = coalesce(regexp_replace(f ->> 'emergency2_phone', '\D', '', 'g'), t.emergency2_phone),
    guardian_name = coalesce(f ->> 'guardian_name', t.guardian_name),
    guardian_relation = coalesce(f ->> 'guardian_relation', t.guardian_relation),
    guardian_phone = coalesce(regexp_replace(f ->> 'guardian_phone', '\D', '', 'g'), t.guardian_phone),
    guardian_email = coalesce(f ->> 'guardian_email', t.guardian_email),
    guardian_consent_payments = coalesce((f ->> 'guardian_consent_payments')::boolean, t.guardian_consent_payments),
    guardian_consent_complaints = coalesce((f ->> 'guardian_consent_complaints')::boolean, t.guardian_consent_complaints),
    updated_at = now()
  where t.user_id = p_user;
  if f ? 'full_name' or f ? 'phone' then
    update public.profiles set full_name = coalesce(nullif(trim(f ->> 'full_name'), ''), full_name),
      phone = coalesce(nullif(regexp_replace(coalesce(f ->> 'phone', ''), '\D', '', 'g'), ''), phone)
    where id = p_user;
  end if;
end $$;
revoke all on function public.apply_tenant_fields(uuid, jsonb) from public, anon, authenticated;

-- PRD 3.1: at least one emergency contact with a 10+ digit mobile
create function public.tenant_profile_complete(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tenant_profiles where user_id = p_user
                 and emergency1_name <> '' and length(emergency1_phone) >= 10)
$$;

-- tenant (self-registration) fills or edits their own details; approval fields are not theirs to set
create function public.save_my_tenant_profile(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_app_role() is distinct from 'customer' then raise exception 'Tenants only' using errcode = '42501'; end if;
  if coalesce(p ->> 'emergency1_name', '') = '' or length(regexp_replace(coalesce(p ->> 'emergency1_phone', ''), '\D', '', 'g')) < 10 then
    raise exception 'Add at least one emergency contact with a 10-digit mobile number';
  end if;
  perform public.apply_tenant_fields(auth.uid(), p - 'property_id');
  if p ? 'property_id' then
    update public.tenant_profiles set property_id = coalesce(property_id, p ->> 'property_id') where user_id = auth.uid();
  end if;
end $$;

-- office registers / edits a tenant (PRD 3.1). Approves at once unless told otherwise.
create function public.staff_save_tenant(p_user uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare prop text := coalesce(p ->> 'property_id', (select property_id from public.tenant_profiles where user_id = p_user));
begin
  if prop is null then raise exception 'Choose a property'; end if;
  perform public.require_manage(prop);
  if (select role from public.profiles where id = p_user) is distinct from 'customer' then raise exception 'Not a tenant account'; end if;
  if coalesce(p ->> 'emergency1_name', '') = '' or length(regexp_replace(coalesce(p ->> 'emergency1_phone', ''), '\D', '', 'g')) < 10 then
    raise exception 'Add at least one emergency contact with a 10-digit mobile number';
  end if;
  perform public.apply_tenant_fields(p_user, p);
  update public.tenant_profiles set property_id = prop,
    police_status = coalesce(nullif(p ->> 'police_status', ''), police_status),
    police_ref = coalesce(p ->> 'police_ref', police_ref),
    police_submitted_on = coalesce(nullif(p ->> 'police_submitted_on', '')::date, police_submitted_on)
  where user_id = p_user;
  if coalesce((p ->> 'approve')::boolean, false) then
    update public.tenant_profiles set approval_status = 'approved', approved_by = auth.uid(), approved_at = now()
    where user_id = p_user and approval_status <> 'approved';
  end if;
  perform public.log_activity('tenant.saved', 'tenant', p_user::text, '{}');
end $$;

create function public.set_tenant_approval(p_user uuid, p_status text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_see_user(p_user) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected', 'pending') then raise exception 'Bad status'; end if;
  if p_status = 'approved' and not public.tenant_profile_complete(p_user) then
    raise exception 'Emergency contact is missing';
  end if;
  update public.tenant_profiles set approval_status = p_status, approval_note = coalesce(p_note, ''),
    approved_by = auth.uid(), approved_at = now() where user_id = p_user;
  if not found then raise exception 'Tenant has no profile yet'; end if;
  perform public.notify(p_user, array['in_app', 'push'], 'account',
    case p_status when 'approved' then 'Registration approved' else 'Registration update' end,
    case p_status when 'approved' then 'Your registration is approved. Welcome to YOLO Nest!'
         else 'Your registration needs attention: ' || coalesce(p_note, '') end, '/account', null, 'tenant', p_user::text);
  perform public.log_activity('tenant.approval', 'tenant', p_user::text, jsonb_build_object('status', p_status));
end $$;

create function public.set_police_verification(p_user uuid, p_status text, p_ref text default '', p_date date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_see_user(p_user) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_status not in ('not_required', 'pending', 'submitted', 'verified', 'rejected') then raise exception 'Bad status'; end if;
  update public.tenant_profiles set police_status = p_status, police_ref = coalesce(p_ref, ''),
    police_submitted_on = coalesce(p_date, case when p_status = 'submitted' then current_date end, police_submitted_on)
  where user_id = p_user;
  perform public.log_activity('tenant.police', 'tenant', p_user::text, jsonb_build_object('status', p_status));
end $$;

-- PRD 3.2: verify / reject (with reason) and re-request
create function public.review_document(p_doc uuid, p_status text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare d public.customer_documents%rowtype; label text;
begin
  select * into d from public.customer_documents where id = p_doc for update;
  if not found or not public.can_see_user(d.customer_id) then raise exception 'Document not found'; end if;
  if p_status not in ('verified', 'rejected') then raise exception 'Bad status'; end if;
  if p_status = 'rejected' and coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for rejecting'; end if;
  update public.customer_documents set status = p_status, review_note = coalesce(p_note, ''),
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_doc;
  if p_status = 'rejected' then
    label := coalesce(replace(d.id_type, '_', ' '), replace(d.doc_type, '_', ' '));
    perform public.notify(d.customer_id, array['in_app', 'push', 'sms', 'email'], 'document',
      (public.render_template('document_rejected', jsonb_build_object('document', label, 'note', p_note,
        'name', (select full_name from public.profiles where id = d.customer_id)))).subject,
      (public.render_template('document_rejected', jsonb_build_object('document', label, 'note', p_note,
        'name', (select full_name from public.profiles where id = d.customer_id)))).body,
      '/account#documents', 'doc-rejected:' || p_doc || ':' || now(), 'document', p_doc::text);
  end if;
  perform public.log_activity('document.' || p_status, 'document', p_doc::text, jsonb_build_object('note', p_note));
end $$;

-- PRD 3.3 notice: tenant or office records notice and planned check-out
create function public.give_notice(p_booking uuid, p_planned_checkout date, p_notice_date date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or not (b.customer_id = auth.uid() or public.can_manage_property(b.property_id)) then
    raise exception 'Stay not found';
  end if;
  if b.status <> 'active' then raise exception 'Only an active stay can be given notice'; end if;
  if p_planned_checkout is null or p_planned_checkout < coalesce(p_notice_date, current_date) then
    raise exception 'Planned check-out must be on or after the notice date';
  end if;
  update public.bookings set notice_date = coalesce(p_notice_date, current_date), expected_checkout = p_planned_checkout
  where id = p_booking;
  perform public.alert_managers(b.property_id, 'notice', 'Notice to vacate',
    (select full_name from public.profiles where id = b.customer_id) || ' plans to check out on ' || to_char(p_planned_checkout, 'DD Mon YYYY'),
    '/admin/tenants/' || b.customer_id, 'notice:' || p_booking || ':' || p_planned_checkout, 'booking', p_booking::text);
  perform public.log_activity('booking.notice', 'booking', p_booking::text, jsonb_build_object('checkout', p_planned_checkout));
end $$;

-- PRD 3.4 agreement generated from the template and the stay
create function public.generate_agreement(p_booking uuid, p_end date, p_rules text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare b public.bookings%rowtype; p public.profiles%rowtype; pr public.properties%rowtype; tpl text; rules text; aid uuid;
  room text;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Stay not found'; end if;
  perform public.require_manage(b.property_id);
  select * into p from public.profiles where id = b.customer_id;
  select * into pr from public.properties where id = b.property_id;
  select room_no into room from public.rooms where id = b.room_id;
  rules := coalesce(p_rules, (select value #>> '{}' from public.app_settings where key = 'house_rules'), '');
  tpl := coalesce((select value #>> '{}' from public.app_settings where key = 'agreement_template'), '');
  tpl := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(tpl,
    '{{tenant}}', p.full_name), '{{property}}', pr.name), '{{address}}', pr.address), '{{room}}', room),
    '{{start}}', to_char(b.check_in, 'DD Mon YYYY')), '{{end}}', to_char(p_end, 'DD Mon YYYY')),
    '{{rent}}', b.rate::text), '{{deposit}}', b.deposit::text), '{{notice}}', b.notice_period_days::text),
    '{{lock_in}}', b.lock_in_months::text);
  insert into public.agreements (booking_id, customer_id, property_id, start_date, end_date, lock_in_months,
                                 notice_period_days, rent, deposit, rules, body, status, created_by)
  values (b.id, b.customer_id, b.property_id, b.check_in, p_end, b.lock_in_months, b.notice_period_days, b.rate,
          b.deposit, rules, tpl || E'\n\nHouse rules\n' || rules, 'sent', auth.uid())
  returning id into aid;
  perform public.notify(b.customer_id, array['in_app', 'push', 'email'], 'agreement',
    (public.render_template('agreement_ready', jsonb_build_object('name', p.full_name, 'link', '/account#agreement'))).subject,
    (public.render_template('agreement_ready', jsonb_build_object('name', p.full_name, 'link', '/account#agreement'))).body,
    '/account#agreement', 'agreement:' || aid, 'agreement', aid::text);
  perform public.log_activity('agreement.generated', 'agreement', aid::text, '{}');
  return aid;
end $$;

-- office records an agreement signed on paper (the signed PDF is uploaded as a customer document)
create function public.record_agreement(p_booking uuid, p_start date, p_end date, p_lock_in int, p_notice int,
                                        p_rent int, p_deposit int, p_rules text, p_document uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings%rowtype; aid uuid;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Stay not found'; end if;
  perform public.require_manage(b.property_id);
  if p_document is not null and not exists (select 1 from public.customer_documents where id = p_document and customer_id = b.customer_id) then
    raise exception 'Upload the signed agreement for this tenant first';
  end if;
  insert into public.agreements (booking_id, customer_id, property_id, start_date, end_date, lock_in_months, notice_period_days,
                                 rent, deposit, rules, status, rules_accepted, accepted_at, acceptance_method, document_id, created_by)
  values (b.id, b.customer_id, b.property_id, p_start, p_end, coalesce(p_lock_in, 0), coalesce(p_notice, 30), p_rent,
          coalesce(p_deposit, 0), coalesce(p_rules, ''), 'active', true, now(), 'upload', p_document, auth.uid())
  returning id into aid;
  update public.bookings set lock_in_months = coalesce(p_lock_in, 0), notice_period_days = coalesce(p_notice, 30) where id = b.id;
  perform public.log_activity('agreement.recorded', 'agreement', aid::text, '{}');
  return aid;
end $$;

-- tenant accepts online: typed full name + rules checkbox, while signed in (click-wrap e-sign)
create function public.accept_agreement(p_id uuid, p_name text, p_rules_accepted boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a public.agreements%rowtype;
begin
  select * into a from public.agreements where id = p_id and customer_id = auth.uid() for update;
  if not found then raise exception 'Agreement not found'; end if;
  if a.status <> 'sent' then raise exception 'This agreement is not waiting for acceptance'; end if;
  if not coalesce(p_rules_accepted, false) then raise exception 'Please accept the house rules'; end if;
  if lower(trim(p_name)) <> lower(trim((select full_name from public.profiles where id = auth.uid()))) then
    raise exception 'Type your full name exactly as on your profile';
  end if;
  update public.agreements set status = 'active', rules_accepted = true, accepted_at = now(), accepted_name = trim(p_name),
    acceptance_method = 'click' where id = p_id;
  perform public.log_activity('agreement.accepted', 'agreement', p_id::text, '{}');
end $$;

create function public.set_agreement_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.agreements%rowtype;
begin
  select * into a from public.agreements where id = p_id;
  if not found then raise exception 'Agreement not found'; end if;
  perform public.require_manage(a.property_id);
  if p_status not in ('active', 'expired', 'terminated') then raise exception 'Bad status'; end if;
  update public.agreements set status = p_status where id = p_id;
end $$;

insert into public.app_settings (key, value) values
  ('agreement_template', to_jsonb(
    'LEAVE AND LICENCE AGREEMENT' || E'\n\n' ||
    'This agreement is between {{property}}, {{address}} (the Licensor) and {{tenant}} (the Licensee).' || E'\n' ||
    'Room: {{room}}. Period: {{start}} to {{end}}.' || E'\n' ||
    'Monthly licence fee: Rs {{rent}}. Refundable security deposit: Rs {{deposit}}.' || E'\n' ||
    'Lock-in period: {{lock_in}} month(s). Notice period: {{notice}} day(s).' || E'\n' ||
    'The deposit is refunded at check-out after deducting pending dues and damages.'::text)),
  ('house_rules', to_jsonb('1. Rent is due on the due date shown in the app.' || E'\n' ||
    '2. Visitors are allowed in common areas only.' || E'\n' ||
    '3. Keep rooms and shared areas clean.' || E'\n' ||
    '4. No smoking or alcohol inside rooms.' || E'\n' ||
    '5. Give notice before moving out as per the agreement.'::text))
on conflict (key) do nothing;

revoke all on function public.mark_notifications_read(bigint[]), public.tenant_profile_complete(uuid),
  public.save_my_tenant_profile(jsonb), public.staff_save_tenant(uuid, jsonb), public.set_tenant_approval(uuid, text, text),
  public.set_police_verification(uuid, text, text, date), public.review_document(uuid, text, text),
  public.give_notice(uuid, date, date), public.generate_agreement(uuid, date, text),
  public.record_agreement(uuid, date, date, int, int, int, int, text, uuid), public.accept_agreement(uuid, text, boolean),
  public.set_agreement_status(uuid, text) from public, anon;
grant execute on function public.mark_notifications_read(bigint[]), public.tenant_profile_complete(uuid),
  public.save_my_tenant_profile(jsonb), public.staff_save_tenant(uuid, jsonb), public.set_tenant_approval(uuid, text, text),
  public.set_police_verification(uuid, text, text, date), public.review_document(uuid, text, text),
  public.give_notice(uuid, date, date), public.generate_agreement(uuid, date, text),
  public.record_agreement(uuid, date, date, int, int, int, int, text, uuid), public.accept_agreement(uuid, text, boolean),
  public.set_agreement_status(uuid, text) to authenticated, service_role;
