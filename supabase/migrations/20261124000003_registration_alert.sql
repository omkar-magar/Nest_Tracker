-- A new self-registration waits for manager approval: tell every owner and manager when the form is first submitted.
-- (The tenant sees "waiting for approval" on their dashboard until set_tenant_approval approves it.)

create or replace function public.save_my_tenant_profile(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare accepted timestamptz; u uuid; who text;
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
    select full_name into who from public.profiles where id = auth.uid();
    for u in select id from public.profiles where role in ('admin', 'manager') and is_active loop
      perform public.notify(u, array['in_app', 'push'], 'registration', 'New registration',
        coalesce(who, 'A new resident') || ' registered and is waiting for approval.', '/admin/registrations',
        'registration:' || auth.uid() || ':' || u, 'tenant', auth.uid()::text);
    end loop;
  end if;
  if p ? 'property_id' then
    update public.tenant_profiles set property_id = coalesce(property_id, p ->> 'property_id') where user_id = auth.uid();
  end if;
end $$;

-- A new registration has no property yet, so managers could not see it. Let every manager see (and approve)
-- registrations that are still unassigned and pending; the property is set at check-in.
create or replace function public.can_see_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.current_app_role() = 'manager' and (
    exists (select 1 from public.tenant_profiles t where t.user_id = p_user and public.can_manage_property(t.property_id))
    or exists (select 1 from public.tenant_profiles t where t.user_id = p_user and t.property_id is null and t.approval_status = 'pending')
    or exists (select 1 from public.bookings b where b.customer_id = p_user and public.can_manage_property(b.property_id))
    or exists (select 1 from public.property_members m where m.user_id = p_user and public.can_manage_property(m.property_id))))
$$;
