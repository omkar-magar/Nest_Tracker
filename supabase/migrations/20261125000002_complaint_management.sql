-- Complaint management. Residents raise and track their own complaints (also residents who only have a
-- guest-register stay). Both managers see every complaint in both wings, take unassigned ones for themselves
-- and work only on complaints assigned to them. The owner (admin) assigns, reassigns, sets priority, closes
-- and reopens. Every change is written to complaint_events, which can be added to but not edited.
-- Stored status 'new' is shown as "Open".

-- ---------------------------------------------------------------- columns
alter table public.complaints drop constraint complaints_category_check;
alter table public.complaints add constraint complaints_category_check check (category in ('electrical', 'plumbing', 'wifi',
  'housekeeping', 'maintenance', 'food', 'ac_appliances', 'furniture', 'security', 'noise', 'preventive', 'other'));

alter table public.complaints
  add column register_guest_id bigint references public.register_guests (id) on delete set null,  -- stay from the guest register
  add column room_label  text not null default '',     -- room as the resident knows it (e.g. A-101), kept if the room is renamed
  add column assigned_by uuid,                          -- no FK: keeps a single complaints -> profiles link per column for embeds
  add column assigned_at timestamptz;

-- one row per action; old rows keep action 'updated'
alter table public.complaint_events
  add column action        text not null default 'updated',
  add column from_assignee uuid,
  add column to_assignee   uuid,
  add column details       jsonb not null default '{}';

create function public.complaint_events_frozen() returns trigger
language plpgsql as $$
begin
  raise exception 'Complaint history cannot be changed' using errcode = '42501';
end $$;
create trigger complaint_events_no_update before update on public.complaint_events
  for each row execute function public.complaint_events_frozen();

-- ---------------------------------------------------------------- read access: managers see every complaint
create policy complaints_managers on public.complaints for select using (public.is_manager_or_owner());
create policy events_managers on public.complaint_events for select using (public.is_manager_or_owner());

-- ---------------------------------------------------------------- helpers
create function public.complaint_log(p_id uuid, p_action text, p_from text, p_to text, p_note text,
                                     p_from_as uuid default null, p_to_as uuid default null, p_details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.complaint_events (complaint_id, actor_id, action, from_status, to_status, note, from_assignee, to_assignee, details)
  values (p_id, auth.uid(), p_action, p_from, p_to, coalesce(p_note, ''), p_from_as, p_to_as, coalesce(p_details, '{}'))
$$;

-- new complaints go to the owner and to both managers (they cover for each other)
create function public.complaint_alert_office(c public.complaints) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select id from public.profiles where role in ('admin', 'manager') and is_active loop
    perform public.notify(u, array['in_app', 'push'], 'complaint', 'New complaint #' || c.ticket_no,
      c.title || case when c.room_label <> '' then ' · room ' || c.room_label else '' end,
      '/admin/complaints?open=' || c.id, 'complaint-new:' || c.id || ':' || u, 'complaint', c.id::text);
  end loop;
end $$;

-- the resident hears about every status change (guardian copy if they consented)
create or replace function public.complaint_notify(c public.complaints, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare t record; label text := case c.status when 'new' then 'open' else replace(c.status, '_', ' ') end;
  tp public.tenant_profiles%rowtype; k text := c.id || ':' || (select count(*) from public.complaint_events where complaint_id = c.id);
begin
  if c.customer_id is null then return; end if;
  select * into t from public.render_template('complaint_update',
    jsonb_build_object('title', c.title, 'status', label, 'note', coalesce(p_note, '')));
  perform public.notify(c.customer_id, array['in_app', 'push'], 'complaint', t.subject, t.body,
    '/account#complaints', 'complaint:' || k, 'complaint', c.id::text);
  select * into tp from public.tenant_profiles where user_id = c.customer_id;
  if tp.guardian_consent_complaints and tp.guardian_phone <> '' then
    perform public.notify(null, array['sms', 'whatsapp'], 'complaint', t.subject, 'Copy for guardian: ' || t.body, null,
      'complaint-g:' || k, 'complaint', c.id::text, tp.guardian_phone);
  end if;
end $$;

create function public.complaint_notify_assignee(c public.complaints) returns void
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if c.assigned_to is null or c.assigned_to = auth.uid() then return; end if;
  select role into r from public.profiles where id = c.assigned_to;
  perform public.notify(c.assigned_to, array['in_app', 'push'], 'complaint', 'Complaint #' || c.ticket_no || ' assigned to you', c.title,
    case when r in ('admin', 'manager') then '/admin/complaints?open=' || c.id else '/staff#tasks' end,
    'complaint-assign:' || c.id || ':' || c.assigned_to || ':' || (select count(*) from public.complaint_events where complaint_id = c.id),
    'complaint', c.id::text);
end $$;

-- the resident's current place: an active booking, else a live guest-register stay linked to their login
create function public.my_complaint_place() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare bk public.bookings%rowtype; g public.register_guests%rowtype;
begin
  if auth.uid() is null then return null; end if;
  select * into bk from public.bookings where customer_id = auth.uid() and status = 'active' order by check_in desc limit 1;
  if found then
    return jsonb_build_object('property_id', bk.property_id, 'room_id', bk.room_id,
      'bed_id', (select bed_id from public.booking_beds where booking_id = bk.id and active limit 1),
      'room_label', (select case when coalesce(r.wing, '') <> '' then r.wing || '-' || r.room_no else r.room_no end from public.rooms r where r.id = bk.room_id),
      'register_guest_id', null);
  end if;
  select * into g from public.register_guests where customer_id = auth.uid() and checked_out_on is null order by id desc limit 1;
  if found then
    return jsonb_build_object('property_id', g.property_id, 'bed_id', null, 'room_label', g.room_no, 'register_guest_id', g.id,
      'room_id', (select r.id from public.rooms r where r.property_id = g.property_id
                  and (case when coalesce(r.wing, '') <> '' then r.wing || '-' || r.room_no else r.room_no end) = g.room_no limit 1));
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- raise
-- resident raises one for their own room; the office logs one for a resident or a common area
create or replace function public.raise_complaint(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); place jsonb; prop text; cust uuid; room text; bed uuid; rg bigint; rlabel text := '';
  c public.complaints%rowtype; v_photos text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'photos', '[]'))), '{}');
  sla jsonb := coalesce(public.setting('complaint_sla_hours'), '{}'); prio text := coalesce(nullif(p ->> 'priority', ''), 'medium');
  cat text := coalesce(nullif(p ->> 'category', ''), 'other'); ttl text := trim(coalesce(p ->> 'title', ''));
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if cat not in ('electrical', 'plumbing', 'wifi', 'housekeeping', 'maintenance', 'food', 'ac_appliances', 'furniture',
                 'security', 'noise', 'other') then raise exception 'Choose a category'; end if;
  if char_length(ttl) < 3 or char_length(ttl) > 120 then raise exception 'Title must be 3 to 120 characters'; end if;
  if char_length(coalesce(p ->> 'description', '')) > 2000 then raise exception 'Description is too long (2000 characters max)'; end if;
  if cardinality(v_photos) > 5 then raise exception 'Attach at most 5 images'; end if;
  if exists (select 1 from unnest(v_photos) f where f not like uid || '/%') then
    raise exception 'Images must be uploaded by you' using errcode = '42501';
  end if;
  if prio not in ('low', 'medium', 'high', 'urgent') then raise exception 'Unknown priority'; end if;

  if public.current_app_role() = 'customer' then
    place := public.my_complaint_place();
    if place is null then raise exception 'You need an active stay to raise a complaint'; end if;
    prop := place ->> 'property_id'; cust := uid; room := place ->> 'room_id'; bed := nullif(place ->> 'bed_id', '')::uuid;
    rg := nullif(place ->> 'register_guest_id', '')::bigint; rlabel := coalesce(place ->> 'room_label', '');
    prio := 'medium';                                  -- priority is the owner's call
  else
    prop := p ->> 'property_id';
    if not (public.is_manager_or_owner() or public.can_access_property(prop)) then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    if not exists (select 1 from public.properties where id = prop) then raise exception 'Choose a property'; end if;
    cust := nullif(p ->> 'customer_id', '')::uuid; room := nullif(p ->> 'room_id', '');
    bed := nullif(p ->> 'bed_id', '')::uuid;
    if cust is not null and room is null then
      select room_id into room from public.bookings where customer_id = cust and status = 'active' limit 1;
    end if;
    if room is not null then
      select case when coalesce(wing, '') <> '' then wing || '-' || room_no else room_no end into rlabel from public.rooms where id = room;
    end if;
  end if;
  insert into public.complaints (property_id, room_id, bed_id, customer_id, register_guest_id, room_label, is_common_area, category,
                                 title, description, photos, preferred_time, priority, due_at, created_by)
  values (prop, room, bed, cust, rg, coalesce(rlabel, ''), cust is null and coalesce((p ->> 'is_common_area')::boolean, true), cat,
          ttl, trim(coalesce(p ->> 'description', '')), v_photos, left(coalesce(p ->> 'preferred_time', ''), 120),
          prio, now() + make_interval(hours => coalesce((sla ->> prio)::int, 48)), uid)
  returning * into c;
  perform public.complaint_log(c.id, 'created', null, 'new', 'Raised');
  perform public.complaint_alert_office(c);
  return c.id;
end $$;

-- ---------------------------------------------------------------- update
-- p: assigned_to, priority, status (in_progress | resolved | closed | reopen), note, resolution, after_photos,
--    fixed_by, cost, vendor_id, staff_member_id, rating, feedback.
-- admin: everything. manager: take an unassigned complaint for themselves; work only on their own.
-- assigned staff: work on their own. resident: confirm (close) or reopen a resolved complaint, and rate it.
create or replace function public.update_complaint(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.complaints%rowtype; c0 public.complaints%rowtype; uid uuid := auth.uid();
  adm boolean := public.is_admin(); mgr boolean := public.current_app_role() = 'manager'; mine boolean; tenant boolean;
  v_next text := nullif(p ->> 'status', ''); v_note text := left(trim(coalesce(p ->> 'note', '')), 2000); noted boolean := false;
  sla jsonb := coalesce(public.setting('complaint_sla_hours'), '{}'); new_as uuid; ok boolean; v_from text; act text;
  work jsonb := '{}'; v_photos text[]; changed boolean := false;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into c from public.complaints where id = p_id for update;
  if not found then raise exception 'Complaint not found'; end if;
  c0 := c;
  mine := coalesce(c.assigned_to = uid, false);
  tenant := coalesce(c.customer_id = uid, false) and not adm and not mgr and not mine;
  if not (adm or mgr or mine or tenant) then raise exception 'Complaint not found'; end if;

  -- assignment
  if p ? 'assigned_to' then
    new_as := nullif(p ->> 'assigned_to', '')::uuid;
    if new_as is distinct from c.assigned_to then
      if adm then
        if new_as is not null and not exists (select 1 from public.profiles where id = new_as and is_active
                                               and role in ('admin', 'manager', 'employee')) then
          raise exception 'Choose an active manager or staff member';
        end if;
      elsif mgr then
        if new_as is distinct from uid then
          raise exception 'Only the admin can assign a complaint to someone else' using errcode = '42501';
        end if;
        if c.assigned_to is not null then raise exception 'This complaint is already assigned' using errcode = '42501'; end if;
      else
        raise exception 'Only the admin can assign complaints' using errcode = '42501';
      end if;
      if c.status = 'closed' then raise exception 'Reopen the complaint before assigning it'; end if;
      update public.complaints set assigned_to = new_as, assigned_by = uid, assigned_at = case when new_as is null then null else now() end,
        status = case when new_as is null and status in ('assigned', 'in_progress') then 'new'
                      when new_as is not null and status in ('new', 'in_progress') then 'assigned' else status end
      where id = p_id returning * into c;
      act := case when new_as is null then 'unassigned' when c0.assigned_to is not null then 'reassigned'
                  when new_as = uid then 'taken' else 'assigned' end;
      perform public.complaint_log(p_id, act, c0.status, c.status, case when v_next is null then v_note else '' end, c0.assigned_to, new_as);
      noted := v_next is null; changed := true;
      mine := coalesce(c.assigned_to = uid, false);
    end if;
  end if;

  -- priority (owner only)
  if p ? 'priority' and (p ->> 'priority') is distinct from c.priority then
    if not adm then raise exception 'Only the admin can change priority' using errcode = '42501'; end if;
    if (p ->> 'priority') not in ('low', 'medium', 'high', 'urgent') then raise exception 'Unknown priority'; end if;
    update public.complaints set priority = p ->> 'priority',
      due_at = created_at + make_interval(hours => coalesce((sla ->> (p ->> 'priority'))::int, 48))
    where id = p_id returning * into c;
    perform public.complaint_log(p_id, 'priority_changed', c.status, c.status, '', null, null,
      jsonb_build_object('from', c0.priority, 'to', c.priority));
    changed := true;
  end if;

  -- work details (owner or the person it is assigned to)
  if p ?| array['resolution', 'fixed_by', 'cost', 'vendor_id', 'staff_member_id', 'after_photos', 'due_at'] then
    if not (adm or mine) then raise exception 'You can only work on complaints assigned to you' using errcode = '42501'; end if;
    if p ? 'due_at' and not adm then raise exception 'Only the admin can change the due time' using errcode = '42501'; end if;
    v_photos := case when p ? 'after_photos' then coalesce(array(select jsonb_array_elements_text(p -> 'after_photos')), '{}') else c.after_photos end;
    if cardinality(v_photos) > 10 then raise exception 'Attach at most 10 resolution images'; end if;
    if exists (select 1 from unnest(v_photos) f where not (f = any (c.after_photos)) and f not like uid || '/%') then
      raise exception 'Images must be uploaded by you' using errcode = '42501';
    end if;
    if coalesce((p ->> 'cost')::int, 0) < 0 then raise exception 'Cost cannot be negative'; end if;
    update public.complaints set
      resolution = left(coalesce(p ->> 'resolution', resolution), 2000), fixed_by = coalesce(p ->> 'fixed_by', fixed_by),
      cost = coalesce((p ->> 'cost')::int, cost), after_photos = v_photos,
      vendor_id = case when p ? 'vendor_id' then nullif(p ->> 'vendor_id', '')::uuid else vendor_id end,
      staff_member_id = case when p ? 'staff_member_id' then nullif(p ->> 'staff_member_id', '')::uuid else staff_member_id end,
      due_at = case when p ? 'due_at' then (p ->> 'due_at')::timestamptz else due_at end
    where id = p_id returning * into c;
    work := jsonb_strip_nulls(jsonb_build_object(
      'resolution', case when c.resolution is distinct from c0.resolution then c.resolution end,
      'fixed_by', case when c.fixed_by is distinct from c0.fixed_by then c.fixed_by end,
      'cost', case when c.cost is distinct from c0.cost then c.cost end,
      'vendor_id', case when c.vendor_id is distinct from c0.vendor_id then c.vendor_id end,
      'staff_member_id', case when c.staff_member_id is distinct from c0.staff_member_id then c.staff_member_id end,
      'due_at', case when c.due_at is distinct from c0.due_at then c.due_at end,
      'photos_added', nullif(cardinality(c.after_photos) - cardinality(c0.after_photos), 0)));
    if work <> '{}' then
      perform public.complaint_log(p_id, 'work_updated', c.status, c.status, '', null, null, work);
      changed := true;
    end if;
  end if;

  -- rating (resident, after it is resolved)
  if p ? 'rating' then
    if not tenant then raise exception 'Only the resident can rate a complaint' using errcode = '42501'; end if;
    if (p ->> 'rating')::int not between 1 and 5 then raise exception 'Rating must be 1 to 5'; end if;
    if c.status not in ('resolved', 'closed') then raise exception 'Rate after it is resolved'; end if;
    update public.complaints set rating = (p ->> 'rating')::int, feedback = left(coalesce(p ->> 'feedback', ''), 500)
    where id = p_id returning * into c;
    perform public.complaint_log(p_id, 'rated', c.status, c.status, coalesce(p ->> 'feedback', ''), null, null,
      jsonb_build_object('rating', c.rating));
    changed := true;
  end if;

  -- status
  if v_next is not null then
    if v_next in ('in_progress', 'resolved') and not (adm or mine) then
      raise exception 'You can only work on complaints assigned to you' using errcode = '42501';
    end if;
    if v_next = 'closed' and not (adm or tenant) then raise exception 'Only the admin can close a complaint' using errcode = '42501'; end if;
    if v_next = 'reopen' and not (adm or tenant) then
      raise exception 'Only the admin or the resident can reopen a complaint' using errcode = '42501';
    end if;
    ok := case
      when v_next = 'reopen' then c.status = 'resolved' or (adm and c.status = 'closed')
      when v_next = 'in_progress' then c.status = 'assigned'
      when v_next = 'resolved' then c.status in ('assigned', 'in_progress')
      when v_next = 'closed' then (adm and c.status <> 'closed') or c.status = 'resolved'
      else false end;
    if not ok then
      raise exception 'Cannot move a % complaint to %', case c.status when 'new' then 'open' else replace(c.status, '_', ' ') end,
        replace(v_next, '_', ' ');
    end if;
    if v_next = 'resolved' and trim(c.resolution) = '' then raise exception 'Add resolution notes before marking it resolved'; end if;
    if v_next = 'reopen' and tenant and v_note = '' then raise exception 'Tell us what is still wrong'; end if;
    v_from := c.status;
    update public.complaints set
      status = case when v_next = 'reopen' then case when assigned_to is not null then 'assigned' else 'new' end else v_next end,
      reopen_count = reopen_count + case when v_next = 'reopen' then 1 else 0 end,
      resolved_at = case when v_next = 'resolved' then now() when v_next = 'reopen' then null else resolved_at end,
      closed_at = case when v_next = 'closed' then now() when v_next = 'reopen' then null else closed_at end,
      escalated_at = case when v_next = 'reopen' then null else escalated_at end,
      due_at = case when v_next = 'reopen' then now() + make_interval(hours => coalesce((sla ->> priority)::int, 48)) else due_at end
    where id = p_id returning * into c;
    perform public.complaint_log(p_id, case v_next when 'reopen' then 'reopened' when 'in_progress' then 'started' else v_next end,
      v_from, c.status, v_note);
    noted := true; changed := true;
  end if;

  -- a note on its own is a comment (owner or the person it is assigned to)
  if v_note <> '' and not noted then
    if not (adm or mine) then raise exception 'You can only comment on complaints assigned to you' using errcode = '42501'; end if;
    perform public.complaint_log(p_id, 'comment', c.status, c.status, v_note);
    changed := true;
  end if;

  if not changed then return; end if;
  update public.complaints set updated_at = now() where id = p_id returning * into c;

  -- repair cost flows into expenses (PRD 6.3), kept in step if the cost is edited later
  if c.status in ('resolved', 'closed') and c.cost > 0 then
    insert into public.expenses (property_id, category_id, spent_on, amount, vendor, notes, source, source_id, status, created_by)
    values (c.property_id, 'repairs', coalesce(c.resolved_at, now())::date, c.cost,
            coalesce((select name from public.vendors where id = c.vendor_id), c.fixed_by),
            'Complaint #' || c.ticket_no || ': ' || c.title, 'complaint', c.id::text, 'approved', uid)
    on conflict (source, source_id) where source_id is not null do update set amount = excluded.amount, vendor = excluded.vendor;
  end if;
  if c.assigned_to is distinct from c0.assigned_to then perform public.complaint_notify_assignee(c); end if;
  if c.status <> c0.status then perform public.complaint_notify(c, v_note); end if;
end $$;

-- ---------------------------------------------------------------- reads
-- who the owner can assign to; managers use it for names on the board
create function public.complaint_assignees() returns table (id uuid, full_name text, role text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager_or_owner() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query select p.id, p.full_name, p.role::text from public.profiles p
    where p.is_active and p.role in ('admin', 'manager', 'employee')
    order by case p.role when 'manager' then 0 when 'admin' then 1 else 2 end, p.full_name;
end $$;

-- the full timeline with names, for anyone who can see the complaint
create function public.complaint_timeline(p_id uuid)
returns table (id bigint, created_at timestamptz, action text, actor_name text, actor_role text, from_status text, to_status text,
               from_assignee_name text, to_assignee_name text, note text, details jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.complaints c where c.id = p_id
                 and (public.is_manager_or_owner() or c.customer_id = auth.uid() or c.assigned_to = auth.uid())) then
    raise exception 'Complaint not found';
  end if;
  return query
  select e.id, e.created_at, e.action, coalesce(a.full_name, case when e.actor_id is null then 'System' else 'Former user' end),
         coalesce(a.role::text, ''), e.from_status, e.to_status, fa.full_name, ta.full_name, e.note, e.details
  from public.complaint_events e
  left join public.profiles a on a.id = e.actor_id
  left join public.profiles fa on fa.id = e.from_assignee
  left join public.profiles ta on ta.id = e.to_assignee
  where e.complaint_id = p_id order by e.id;
end $$;

-- the resident's own complaints, with the assignee's name (residents cannot read staff profiles)
create function public.my_complaints()
returns table (id uuid, ticket_no bigint, category text, title text, description text, photos text[], after_photos text[],
               priority text, status text, room_label text, assignee_name text, resolution text, preferred_time text,
               resolved_at timestamptz, closed_at timestamptz, created_at timestamptz, updated_at timestamptz,
               rating int, feedback text, reopen_count int)
language sql stable security definer set search_path = public as $$
  select c.id, c.ticket_no, c.category, c.title, c.description, c.photos, c.after_photos, c.priority, c.status,
         coalesce(nullif(c.room_label, ''), r.room_no, ''), a.full_name, c.resolution, c.preferred_time,
         c.resolved_at, c.closed_at, c.created_at, c.updated_at, c.rating, c.feedback, c.reopen_count
  from public.complaints c left join public.profiles a on a.id = c.assigned_to left join public.rooms r on r.id = c.room_id
  where c.customer_id = auth.uid() order by c.created_at desc limit 100
$$;

-- summary for the board: counts by status, average resolution time, per-assignee load
create function public.complaint_stats(p_property text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_manager_or_owner() then raise exception 'Not allowed' using errcode = '42501'; end if;
  with base as (select * from public.complaints where p_property is null or property_id = p_property)
  select jsonb_build_object(
    'total', (select count(*) from base),
    'open', (select count(*) from base where status = 'new'),
    'unassigned', (select count(*) from base where assigned_to is null and status in ('new', 'assigned', 'in_progress')),
    'assigned', (select count(*) from base where status = 'assigned'),
    'in_progress', (select count(*) from base where status = 'in_progress'),
    'pending', (select count(*) from base where status in ('new', 'assigned')),
    'resolved', (select count(*) from base where status = 'resolved'),
    'closed', (select count(*) from base where status = 'closed'),
    'overdue', (select count(*) from base where status in ('new', 'assigned', 'in_progress') and due_at < now()),
    'avg_resolution_hours', (select round((avg(extract(epoch from resolved_at - created_at)) / 3600)::numeric, 1)
                             from base where resolved_at is not null),
    'by_assignee', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role, 'active', s.active, 'resolved', s.resolved,
                                          'total', s.total, 'avg_hours', s.avg_hours) order by p.full_name)
      from public.profiles p
      cross join lateral (
        select count(*) filter (where b.status in ('assigned', 'in_progress')) active,
               count(*) filter (where b.status in ('resolved', 'closed')) resolved, count(*) total,
               round((avg(extract(epoch from b.resolved_at - b.created_at)) / 3600)::numeric, 1) avg_hours
        from base b where b.assigned_to = p.id) s
      where (p.role = 'manager' and p.is_active) or s.total > 0), '[]'))
  into res;
  return res;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.complaint_events_frozen(), public.complaint_log(uuid, text, text, text, text, uuid, uuid, jsonb),
  public.complaint_alert_office(public.complaints), public.complaint_notify_assignee(public.complaints),
  public.my_complaint_place(), public.complaint_assignees(), public.complaint_timeline(uuid), public.my_complaints(),
  public.complaint_stats(text) from public, anon;
revoke all on function public.complaint_log(uuid, text, text, text, text, uuid, uuid, jsonb),
  public.complaint_alert_office(public.complaints), public.complaint_notify_assignee(public.complaints) from authenticated;
grant execute on function public.my_complaint_place(), public.complaint_assignees(), public.complaint_timeline(uuid),
  public.my_complaints(), public.complaint_stats(text) to authenticated, service_role;
