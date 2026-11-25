-- Link account registrations to the office register without deleting the login or stay history.
alter table public.tenant_profiles add column registration_state text
  check (registration_state in ('pending', 'active', 'ended'));
alter table public.register_guests
  add column customer_id uuid references public.profiles(id),
  add column due_date date;
create unique index register_one_live_customer on public.register_guests(customer_id)
  where customer_id is not null and checked_out_on is null;
create index register_history_customer_idx on public.register_history
  ((coalesce(new_row ->> 'customer_id', old_row ->> 'customer_id')), guest_id, id desc);

-- Keep profile edits separate from property-scoped registration notifications.
-- Every new registration selects its property; managers only access their assigned properties.
create or replace function public.can_see_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.current_app_role() = 'manager' and (
    exists (select 1 from public.tenant_profiles t where t.user_id = p_user and public.can_manage_property(t.property_id))
    or exists (select 1 from public.bookings b where b.customer_id = p_user and public.can_manage_property(b.property_id))
    or exists (select 1 from public.property_members m where m.user_id = p_user and public.can_manage_property(m.property_id))))
$$;

create or replace function public.save_my_tenant_profile(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare accepted timestamptz;
begin
  if public.current_app_role() is distinct from 'customer' then raise exception 'Tenants only' using errcode = '42501'; end if;
  if coalesce(p ->> 'emergency1_name', '') = '' or length(regexp_replace(coalesce(p ->> 'emergency1_phone', ''), '\D', '', 'g')) < 10 then
    raise exception 'Add at least one emergency contact with a 10-digit mobile number';
  end if;
  select rules_accepted_at into accepted from public.tenant_profiles where user_id = auth.uid();
  if accepted is null and not coalesce((p ->> 'rules_accepted')::boolean, false) then
    raise exception 'Accept the rules and regulations to register';
  end if;
  perform public.apply_tenant_fields(auth.uid(), p - 'property_id');
  if accepted is null then
    update public.tenant_profiles set rules_accepted_at = now(),
      rules_signature = coalesce(nullif(trim(p ->> 'rules_signature'), ''), (select full_name from public.profiles where id = auth.uid()))
    where user_id = auth.uid();
  end if;
  if p ? 'property_id' then
    update public.tenant_profiles set property_id = coalesce(property_id, p ->> 'property_id') where user_id = auth.uid();
  end if;
end $$;

create function public.submit_resident_registration(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare manager_id uuid;
begin
  if public.current_app_role() is distinct from 'customer' then raise exception 'Tenants only'; end if;
  perform 1 from public.profiles where id = auth.uid() for update;
  if exists (select 1 from public.register_guests where customer_id = auth.uid() and checked_out_on is null) then
    raise exception 'Your stay is active. Contact your manager to change it';
  end if;
  if not exists (select 1 from public.properties where id = p ->> 'property_id' and is_active) then
    raise exception 'Choose an active property';
  end if;
  if not coalesce((p ->> 'rules_accepted')::boolean, false) then raise exception 'Accept the rules and regulations to register'; end if;
  perform public.save_my_tenant_profile(p);
  update public.tenant_profiles set property_id = p ->> 'property_id', registration_state = 'pending',
    approval_status = 'pending', approved_by = null, approved_at = null, approval_note = '',
    rules_accepted_at = now(), rules_signature = coalesce(nullif(trim(p ->> 'rules_signature'), ''), p ->> 'full_name')
  where user_id = auth.uid();
  for manager_id in select pr.id from public.profiles pr where pr.is_active and
    (pr.role = 'admin' or (pr.role = 'manager' and exists (select 1 from public.property_members pm
      where pm.user_id = pr.id and pm.property_id = p ->> 'property_id'))) loop
    perform public.notify(manager_id, array['in_app', 'push'], 'registration', 'New registration',
      coalesce(p ->> 'full_name', 'A new resident') || ' registered and is waiting for approval.',
      '/admin/register?wing=' || (p ->> 'property_id') || '&tab=new',
      'registration:' || auth.uid() || ':' || manager_id || ':' || txid_current(), 'tenant', auth.uid()::text);
  end loop;
end $$;

create function public.approve_resident_registration(p_user uuid, p jsonb) returns bigint
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
  return gid;
end $$;

create function public.sync_resident_register_state() returns trigger
language plpgsql security definer set search_path = public as $$
declare g public.register_guests;
begin
  g := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'UPDATE' and old.checked_out_on is not distinct from new.checked_out_on then return null; end if;
  if tg_op = 'DELETE' and old.checked_out_on is not null then return null; end if;
  if g.customer_id is not null then
    update public.tenant_profiles set registration_state = case
      when tg_op = 'DELETE' or g.checked_out_on is not null then 'ended' else 'active' end
    where user_id = g.customer_id;
  end if;
  return null;
end $$;
create trigger register_resident_state after insert or update or delete on public.register_guests
  for each row execute function public.sync_resident_register_state();

create function public.my_registration() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('state', t.registration_state, 'approval', t.approval_status, 'stays',
    coalesce((select jsonb_agg(s.row_data order by s.guest_id desc) from (
      select distinct on (h.guest_id) h.guest_id,
        coalesce(h.new_row, h.old_row) || jsonb_build_object('removed', h.op = 'DELETE') as row_data
      from public.register_history h
      where coalesce(h.new_row ->> 'customer_id', h.old_row ->> 'customer_id') = auth.uid()::text
      order by h.guest_id desc, h.id desc limit 100
    ) s), '[]'::jsonb))
  from public.tenant_profiles t where t.user_id = auth.uid()
$$;
revoke all on function public.submit_resident_registration(jsonb), public.approve_resident_registration(uuid, jsonb),
  public.my_registration(), public.sync_resident_register_state() from public, anon;
grant execute on function public.submit_resident_registration(jsonb), public.approve_resident_registration(uuid, jsonb),
  public.my_registration() to authenticated;

-- Restoring a removed account-linked guest must restore the link and stay terms too.
create or replace function public.register_restore(p_history bigint) returns void
language plpgsql security definer set search_path = public as $$
declare h public.register_history; o public.register_guests;
begin
  select * into h from public.register_history where id = p_history;
  if not found then raise exception 'History entry not found'; end if;
  perform public.require_manage(h.property_id);
  if h.op = 'INSERT' then
    delete from public.register_guests where id = h.guest_id;
    return;
  end if;
  o := jsonb_populate_record(null::public.register_guests, h.old_row);
  if o.property_id is distinct from h.property_id then raise exception 'History entry does not match its property'; end if;
  insert into public.register_guests as g (id, property_id, room_no, sort_order, name, contact, rent, deposit, rent_status,
    deposit_status, check_in, expected_checkout, checked_out_on, checkout_note, notes, created_at, customer_id, due_date, room_type)
  values (o.id, o.property_id, o.room_no, o.sort_order, o.name, o.contact, o.rent, o.deposit, o.rent_status,
    o.deposit_status, o.check_in, o.expected_checkout, o.checked_out_on, o.checkout_note, o.notes, o.created_at,
    o.customer_id, o.due_date, coalesce(o.room_type, 'rented'))
  on conflict (id) do update set room_no = excluded.room_no, sort_order = excluded.sort_order, name = excluded.name,
    contact = excluded.contact, rent = excluded.rent, deposit = excluded.deposit, rent_status = excluded.rent_status,
    deposit_status = excluded.deposit_status, check_in = excluded.check_in, expected_checkout = excluded.expected_checkout,
    checked_out_on = excluded.checked_out_on, checkout_note = excluded.checkout_note, notes = excluded.notes,
    customer_id = excluded.customer_id, due_date = excluded.due_date, room_type = excluded.room_type
  where g.property_id = excluded.property_id;
end
$$;
