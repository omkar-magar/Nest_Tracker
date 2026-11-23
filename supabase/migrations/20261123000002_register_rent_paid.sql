-- Rent collected through the guest register, by month, so the dashboard's revenue, net income and income chart
-- include it. The register keeps no payment date, so a guest's rent counts in the month it was marked paid: an
-- edit from another status to "paid", or a guest added already paid (not past guests imported as checked out).
-- Each guest counts at most once a month, at the rent on the latest such change.

create function public.register_rent_paid(p_property text default null, p_months int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  this_month date := date_trunc('month', public.ist_date(now()))::date;
  first_month date := (date_trunc('month', public.ist_date(now())) - make_interval(months => greatest(p_months, 1) - 1))::date;
  res jsonb;
begin
  perform public.require_reports();
  with ev as (
    select distinct on (h.guest_id, date_trunc('month', public.ist_date(h.changed_at)))
           h.property_id, date_trunc('month', public.ist_date(h.changed_at))::date mon, coalesce((h.new_row ->> 'rent')::numeric, 0) amount
    from public.register_history h
    where h.property_id in (select public.report_scope(p_property))
      and public.ist_date(h.changed_at) >= first_month
      and h.new_row ->> 'rent_status' = 'paid'
      and ((h.op = 'INSERT' and h.new_row ->> 'checked_out_on' is null)
           or (h.op = 'UPDATE' and h.old_row ->> 'rent_status' is distinct from 'paid'))
    order by h.guest_id, date_trunc('month', public.ist_date(h.changed_at)), h.changed_at desc, h.id desc)
  select jsonb_build_object(
    'months', (select jsonb_agg(jsonb_build_object('month', m::date, 'amount', coalesce((select sum(amount) from ev where ev.mon = m::date), 0)) order by m)
               from generate_series(first_month, this_month, interval '1 month') m),
    'properties', coalesce((select jsonb_agg(jsonb_build_object('id', property_id, 'amount', amount) order by property_id)
               from (select property_id, sum(amount) amount from ev where mon = this_month group by property_id) s), '[]'))
  into res;
  return res;
end $$;

revoke all on function public.register_rent_paid(text, int) from public, anon;
grant execute on function public.register_rent_paid(text, int) to authenticated, service_role;
