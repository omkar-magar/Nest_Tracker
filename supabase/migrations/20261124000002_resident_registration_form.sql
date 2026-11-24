-- Resident registration form (the paper form): stay preference, ID proof and the house-rules sign-off are now
-- part of the tenant record. Only the last 4 digits of the ID number are kept; the full number stays on the
-- uploaded document, not in a text column.

alter table public.tenant_profiles
  add column room_type_pref text check (room_type_pref in ('bed_in_hall', 'shared_room', 'private_room', 'one_bhk')),
  add column move_in_date date,
  add column stay_duration text not null default '',
  add column id_proof_type text check (id_proof_type in ('aadhaar', 'pan', 'passport', 'driving_licence')),
  add column id_last4 text not null default '' check (id_last4 ~ '^[0-9A-Za-z]{0,4}$'),
  add column rules_accepted_at timestamptz,
  add column rules_signature text not null default '';

-- the form's Occupation has a Business option
alter table public.tenant_profiles drop constraint tenant_profiles_occupation_check;
alter table public.tenant_profiles add constraint tenant_profiles_occupation_check
  check (occupation in ('student', 'working', 'business', 'other'));

create or replace function public.apply_tenant_fields(p_user uuid, f jsonb) returns void
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
    room_type_pref = coalesce(nullif(f ->> 'room_type_pref', ''), t.room_type_pref),
    move_in_date = coalesce(nullif(f ->> 'move_in_date', '')::date, t.move_in_date),
    stay_duration = coalesce(f ->> 'stay_duration', t.stay_duration),
    id_proof_type = coalesce(nullif(f ->> 'id_proof_type', ''), t.id_proof_type),
    id_last4 = coalesce(right(regexp_replace(f ->> 'id_last4', '\s', '', 'g'), 4), t.id_last4),
    updated_at = now()
  where t.user_id = p_user;
  if f ? 'full_name' or f ? 'phone' then
    update public.profiles set full_name = coalesce(nullif(trim(f ->> 'full_name'), ''), full_name),
      phone = coalesce(nullif(regexp_replace(coalesce(f ->> 'phone', ''), '\D', '', 'g'), ''), phone)
    where id = p_user;
  end if;
end $$;
revoke all on function public.apply_tenant_fields(uuid, jsonb) from public, anon, authenticated;

-- the tenant's own save also records the house-rules sign-off (typed name + time); it is required the first time
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
