-- A double click on "Extend stay" ran the extension twice, so the extra charge was added to the rent twice. A current
-- stay that already ends on the chosen date is not extended again (to change only the charge or status, edit the guest).
create or replace function public.extend_stay(p_guest bigint, p_until date, p_charge int default 0, p_status text default null,
  p_note text default '', p_request bigint default null) returns void
language plpgsql security definer set search_path = public as $$
declare g public.register_guests; today date := public.ist_date(now());
begin
  select * into g from public.register_guests where id = p_guest for update;
  if not found then raise exception 'Guest not found'; end if;
  perform public.require_manage(g.property_id);
  if p_until is null or p_until <= today or (g.check_in is not null and p_until <= g.check_in) then
    raise exception 'Choose a new check-out date after today';
  end if;
  if g.checked_out_on is null and g.expected_checkout = p_until then
    raise exception 'This stay already ends on %. Choose another date.', to_char(p_until, 'DD Mon YYYY');
  end if;
  if coalesce(p_charge, 0) < 0 then raise exception 'The extra charge cannot be negative'; end if;
  if p_status is not null and p_status not in ('paid', 'partially_paid', 'pending', 'not_updated') then raise exception 'Unknown rent status'; end if;
  if g.checked_out_on is not null and g.customer_id is not null
    and exists (select 1 from public.register_guests where customer_id = g.customer_id and checked_out_on is null and id <> g.id) then
    raise exception 'This guest already has another current stay';
  end if;
  update public.register_guests set expected_checkout = p_until, checked_out_on = null, checkout_note = '',
    rent = coalesce(rent, 0) + coalesce(p_charge, 0), rent_status = coalesce(p_status, rent_status),
    notes = case when coalesce(trim(p_note), '') = '' then notes else trim(both ' ' from notes || ' ' || trim(p_note)) end
  where id = g.id;
  if p_request is not null then
    update public.stay_extensions set status = 'approved', approved_until = p_until, charge = coalesce(p_charge, 0),
      answer = coalesce(p_note, ''), decided_by = auth.uid(), decided_at = now()
    where id = p_request and guest_id = g.id and status = 'requested';
  end if;
  update public.stay_extensions set status = 'cancelled', answer = 'Extended by the office', decided_at = now()
  where guest_id = g.id and status = 'requested';
  perform public.log_activity('register.extend', 'register_guest', g.id::text,
    jsonb_build_object('until', p_until, 'charge', coalesce(p_charge, 0), 'status', p_status, 'was_checked_out', g.checked_out_on is not null));
  if g.customer_id is not null then
    perform public.notify(g.customer_id, array['in_app', 'push'], 'registration', 'Stay extended',
      'Your stay in room ' || g.room_no || ' is extended until ' || to_char(p_until, 'DD Mon YYYY') || '.'
        || case when coalesce(p_charge, 0) > 0 then ' ₹' || p_charge || ' is added to your rent.' else '' end,
      '/account#my-stay', 'extended:' || g.id || ':' || p_until, 'tenant', g.customer_id::text);
  end if;
end $$;
