-- Registration v2, part 5: coupons. Managers and the owner create discount codes (₹ off or % off) for exclusive
-- offers, share them (mostly with enquiries), and the guest applies the code on the registration payment page.
-- Codes live in the existing offers table. A code may be tied to one mobile number (e.g. the enquiry it was sent
-- to), to one wing, an expiry date and a number of uses. Codes made by a manager show in the owner's list too.

alter table public.offers
  add column created_by uuid references public.profiles (id) on delete set null,
  add column phone      text check (phone is null or phone ~ '^[0-9]{10}$'),
  add column enquiry_id uuid references public.enquiries (id) on delete set null;

alter table public.tenant_profiles
  add column coupon_code text references public.offers (code) on update cascade on delete set null,
  add column discount    int not null default 0 check (discount >= 0);

alter table public.enquiries
  add column coupon_code   text references public.offers (code) on update cascade on delete set null,
  add column approached_at timestamptz;   -- first call, message or coupon after the enquiry came in

create function public.coupon_discount(o public.offers, p_amount int) returns int
language sql immutable as $$
  select greatest(least(coalesce(p_amount, 0), case when o.kind = 'flat' then o.value::int else round(coalesce(p_amount, 0) * o.value / 100)::int end), 0)
$$;

-- what the guest still has to pay: price minus coupon minus what was paid
create or replace function public.registration_balance(t public.tenant_profiles) returns int
language sql stable as $$
  select greatest(coalesce(t.amount_due, 0) - coalesce(t.discount, 0) - coalesce(t.amount_paid, 0), 0)
$$;

-- a coupon fits a registration: active, in date, uses left, the right wing, and the right mobile if tied to one
create function public.coupon_for_registration(p_code text, t public.tenant_profiles) returns public.offers
language plpgsql stable security definer set search_path = public as $$
declare o public.offers; today date := public.ist_date(now()); my_phone text;
begin
  select * into o from public.offers where code = upper(trim(coalesce(p_code, '')));
  if not found or not o.is_active then raise exception 'This coupon code is not valid'; end if;
  if today < o.valid_from or (o.valid_to is not null and today > o.valid_to) then raise exception 'This coupon has expired'; end if;
  if o.max_uses is not null and o.used_count >= o.max_uses then raise exception 'This coupon has been fully used'; end if;
  if o.property_id is not null and o.property_id is distinct from t.property_id then raise exception 'This coupon is for another wing'; end if;
  if o.phone is not null then
    select right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) into my_phone from public.profiles where id = t.user_id;
    if my_phone is distinct from o.phone then raise exception 'This coupon is for another mobile number'; end if;
  end if;
  return o;
end $$;

-- the registration's price can change when the form is sent again; keep the coupon's discount in step
create function public.tenant_coupon_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  if new.coupon_code is null then new.discount := 0; return new; end if;
  if new.amount_due is distinct from old.amount_due then
    select * into o from public.offers where code = new.coupon_code;
    new.discount := case when found then public.coupon_discount(o, new.amount_due) else 0 end;
  end if;
  return new;
end $$;
create trigger tenant_profiles_coupon_sync before update of amount_due, coupon_code on public.tenant_profiles
  for each row execute function public.tenant_coupon_sync();

-- manager / owner: make a coupon. p: code (blank = generated), description, kind, value, valid_to, max_uses,
-- property_id, phone, enquiry_id. A coupon for an enquiry is tied to its mobile and marks the enquiry approached.
create function public.create_coupon(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare c text; k text := p ->> 'kind'; v numeric; pid text := nullif(p ->> 'property_id', ''); ph text; e public.enquiries;
  eid uuid; uses int;
begin
  if public.current_app_role() not in ('admin', 'manager') then raise exception 'Only managers and the owner can make coupons' using errcode = '42501'; end if;
  c := upper(trim(coalesce(nullif(p ->> 'code', ''), 'YN' || upper(substr(md5(gen_random_uuid()::text), 1, 6)))));
  if c !~ '^[A-Z0-9_-]{3,24}$' then raise exception 'Use 3-24 letters, digits, - or _ for the code'; end if;
  if exists (select 1 from public.offers where code = c) then raise exception 'Code % already exists', c; end if;
  if k not in ('flat', 'percent') then raise exception 'Choose ₹ off or %% off'; end if;
  begin v := (p ->> 'value')::numeric; exception when others then v := null; end;
  if v is null or v <= 0 or (k = 'percent' and v > 100) then raise exception 'Enter the discount'; end if;
  if pid is not null then perform public.require_manage(pid);
  elsif not public.is_admin() then raise exception 'Choose the wing for this coupon';
  end if;
  begin eid := nullif(p ->> 'enquiry_id', '')::uuid; exception when others then eid := null; end;
  if eid is not null then
    select * into e from public.enquiries where id = eid;
    if not found or not public.can_see_enquiry(e) then raise exception 'Enquiry not found'; end if;
  end if;
  ph := nullif(right(regexp_replace(coalesce(nullif(p ->> 'phone', ''), e.phone, ''), '\D', '', 'g'), 10), '');
  if ph is not null and length(ph) <> 10 then raise exception 'Enter a 10-digit mobile number'; end if;
  uses := nullif(p ->> 'max_uses', '')::int;
  if uses is not null and uses < 1 then raise exception 'Uses must be at least 1'; end if;
  insert into public.offers (code, description, kind, value, applies_to, valid_to, max_uses, property_id, created_by, phone, enquiry_id)
  values (c, coalesce(nullif(trim(p ->> 'description'), ''), case k when 'flat' then '₹' || v::int || ' off' else v || '% off' end),
    k, v, 'first_month', nullif(p ->> 'valid_to', '')::date, uses, pid, auth.uid(), ph, eid);
  if eid is not null then
    update public.enquiries set coupon_code = c, approached_at = coalesce(approached_at, now()),
      status = case when status = 'new' then 'contacted' else status end
    where id = eid;
  end if;
  perform public.log_activity('coupon.created', 'offer', c, jsonb_build_object('kind', k, 'value', v, 'property_id', pid, 'enquiry_id', eid));
  return c;
end $$;

-- coupons a manager or the owner can see: the owner sees all; a manager sees their wings' and their own
create function public.coupons_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
    select o.code, o.description, o.kind, o.value, o.valid_from, o.valid_to, o.max_uses, o.used_count, o.property_id,
      o.is_active, o.created_at, o.phone, o.enquiry_id, pr.full_name created_by_name, e.name enquiry_name,
      (select count(*) from public.tenant_profiles t where t.coupon_code = o.code and t.registration_state = 'pending') applied_waiting
    from public.offers o
    left join public.profiles pr on pr.id = o.created_by
    left join public.enquiries e on e.id = o.enquiry_id
    where public.current_app_role() in ('admin', 'manager')
      and (public.is_admin() or o.created_by = auth.uid() or (o.property_id is not null and public.can_manage_property(o.property_id)))
    order by o.created_at desc limit 300) x
$$;

create function public.set_coupon_active(p_code text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Coupon not found'; end if;
  if not (public.is_admin() or o.created_by = auth.uid() or (o.property_id is not null and public.can_manage_property(o.property_id))) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.offers set is_active = p_active where code = o.code;
end $$;

-- the guest applies or removes a code on the payment page
create function public.apply_registration_coupon(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tenant_profiles; o public.offers;
begin
  select * into t from public.tenant_profiles where user_id = auth.uid() for update;
  if not found or t.registration_state is distinct from 'pending' or t.stay_type is null then raise exception 'Send your registration form first'; end if;
  if t.payment_status = 'paid' or t.amount_paid > 0 then raise exception 'A coupon can only be used before paying'; end if;
  o := public.coupon_for_registration(p_code, t);
  update public.tenant_profiles set coupon_code = o.code, discount = public.coupon_discount(o, t.amount_due) where user_id = auth.uid() returning * into t;
  return jsonb_build_object('code', o.code, 'description', o.description, 'discount', t.discount, 'to_pay', public.registration_balance(t));
end $$;

create function public.remove_registration_coupon() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.tenant_profiles set coupon_code = null, discount = 0
  where user_id = auth.uid() and registration_state = 'pending' and amount_paid = 0;
end $$;

-- the coupon counts as used when the registration is approved
create function public.coupon_mark_used() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.registration_state = 'active' and old.registration_state = 'pending' and new.coupon_code is not null then
    update public.offers set used_count = used_count + 1 where code = new.coupon_code;
  end if;
  return null;
end $$;
create trigger tenant_profiles_coupon_used after update of registration_state on public.tenant_profiles
  for each row execute function public.coupon_mark_used();

revoke all on function public.coupon_for_registration(text, public.tenant_profiles), public.create_coupon(jsonb), public.coupons_list(),
  public.set_coupon_active(text, boolean), public.apply_registration_coupon(text), public.remove_registration_coupon() from public, anon;
grant execute on function public.create_coupon(jsonb), public.coupons_list(), public.set_coupon_active(text, boolean),
  public.apply_registration_coupon(text), public.remove_registration_coupon() to authenticated;

-- approval takes the coupon off what is still owed
create or replace function public.approve_resident_registration(p_user uuid, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare t public.tenant_profiles; u public.profiles; gid bigint; mode text; pst text; paid int; owed int; st text;
begin
  select * into u from public.profiles where id = p_user for update;
  select * into t from public.tenant_profiles where user_id = p_user for update;
  if not found then raise exception 'Registration not found'; end if;
  perform public.require_manage(t.property_id);
  if t.registration_state is distinct from 'pending' then raise exception 'Registration is no longer pending'; end if;
  if not exists (select 1 from public.rooms where property_id = t.property_id and is_active
    and public.room_key(wing, room_no) = p ->> 'room_no') then
    raise exception 'Choose an active room in this property';
  end if;
  if nullif(p ->> 'rent', '') is null or nullif(p ->> 'deposit', '') is null
    or nullif(p ->> 'due_date', '') is null or nullif(p ->> 'check_in', '') is null then
    raise exception 'Rent, deposit, check-in and due date are required';
  end if;

  mode := coalesce(nullif(p ->> 'payment_mode', ''), t.payment_mode, 'online');
  if mode not in ('online', 'offline') then raise exception 'Payment is online or offline'; end if;
  if mode = 'online' then
    if t.payment_status <> 'paid' and t.stay_type is not null then
      raise exception 'Waiting for the online payment. Switch the payment to offline to approve now.';
    end if;
    paid := t.amount_paid;
    pst := case when t.stay_type is null then 'paid' else t.payment_status end;
  else
    pst := coalesce(nullif(p ->> 'payment_status', ''), 'pending');
    if pst not in ('paid', 'partially_paid', 'pending') then raise exception 'Payment is paid, partly paid or pending'; end if;
    paid := coalesce(nullif(p ->> 'amount_paid', '')::int, case pst when 'paid' then public.registration_balance(t) + t.amount_paid else 0 end, 0);
    if paid < 0 then raise exception 'The amount received cannot be negative'; end if;
    if pst = 'partially_paid' and paid <= 0 then raise exception 'Enter the amount received'; end if;
    if pst = 'pending' then paid := 0; end if;
  end if;
  -- what the registration should have collected: the rent and deposit the manager set
  owed := case when t.stay_type is null then 0 else greatest((p ->> 'rent')::int + (p ->> 'deposit')::int - coalesce(t.discount, 0) - paid, 0) end;
  if pst = 'paid' then owed := 0; end if;
  st := coalesce(t.stay_type, case when p ->> 'room_type' = 'rented' then 'flat' else 'pg' end);

  insert into public.register_guests(property_id, customer_id, room_no, name, contact, rent, deposit,
    check_in, expected_checkout, due_date, room_type, stay_type, notes, sort_order, rent_status, deposit_status, carry_forward)
  values (t.property_id, p_user, p ->> 'room_no', u.full_name, right(regexp_replace(u.phone, '\D', '', 'g'), 10),
    (p ->> 'rent')::int, (p ->> 'deposit')::int, (p ->> 'check_in')::date,
    nullif(p ->> 'expected_checkout', '')::date, (p ->> 'due_date')::date, coalesce(p ->> 'room_type', 'pg'), st,
    coalesce(p ->> 'notes', ''), coalesce((select max(sort_order) + 1 from public.register_guests where property_id = t.property_id), 0),
    case when t.stay_type is null then 'not_updated' else pst end, case when t.stay_type is null then 'not_updated' else pst end, owed)
  returning id into gid;
  update public.tenant_profiles set registration_state = 'active', approval_status = 'approved',
    approved_by = auth.uid(), approved_at = now(), payment_mode = mode, payment_status = pst, amount_paid = paid
  where user_id = p_user;
  perform public.log_activity('tenant.approval', 'tenant', p_user::text,
    jsonb_build_object('status', 'approved', 'room_no', p ->> 'room_no', 'property_id', t.property_id,
      'payment_mode', mode, 'payment_status', pst, 'amount_paid', paid, 'carried', owed, 'coupon', t.coupon_code, 'discount', t.discount));
  perform public.notify(p_user, array['in_app', 'push'], 'registration', 'Registration approved',
    'Welcome to YOLO Nest! Your stay in room ' || (p ->> 'room_no') || ' is confirmed.'
      || case when owed > 0 then ' ₹' || owed || ' still to pay is added to your first rent.' else '' end,
    '/account', 'registration-approved:' || gid, 'tenant', p_user::text);
  return gid;
end $$;

-- the resident sees the coupon and what is left to pay
create or replace function public.my_registration() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('state', t.registration_state, 'approval', t.approval_status, 'property_id', t.property_id,
    'stay_type', t.stay_type, 'room_no', t.room_no, 'move_in_date', t.move_in_date, 'checkout_date', t.checkout_date,
    'due_day', t.due_day, 'first_due', public.registration_first_due(t.move_in_date, t.due_day),
    'payment_mode', t.payment_mode, 'payment_status', t.payment_status, 'amount_due', t.amount_due, 'amount_paid', t.amount_paid,
    'coupon_code', t.coupon_code, 'discount', t.discount, 'to_pay', public.registration_balance(t),
    'coupon_description', (select description from public.offers where code = t.coupon_code),
    'payment', (select jsonb_build_object('amount', r.amount, 'status', r.status, 'is_simulated', r.is_simulated, 'paid_at', r.completed_at)
                from public.registration_payments r where r.customer_id = auth.uid() order by r.claimed_at desc nulls last limit 1),
    'stays', coalesce((select jsonb_agg(s.row_data order by s.guest_id desc) from (
      select distinct on (h.guest_id) h.guest_id,
        coalesce(h.new_row, h.old_row) || jsonb_build_object('removed', h.op = 'DELETE') as row_data
      from public.register_history h
      where coalesce(h.new_row ->> 'customer_id', h.old_row ->> 'customer_id') = auth.uid()::text
      order by h.guest_id desc, h.id desc limit 100
    ) s), '[]'::jsonb))
  from public.tenant_profiles t where t.user_id = auth.uid()
$$;
