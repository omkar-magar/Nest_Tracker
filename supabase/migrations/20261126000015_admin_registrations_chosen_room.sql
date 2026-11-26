-- The owner's registrations list showed the room of a guest's previous (checked-out) stay on a new registration that
-- is still waiting. While a registration waits, show the room the guest chose; the stay's own room and dates only
-- once it is approved (living) or ended.
create or replace function public.admin_registrations(p_property text default null, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'Only the owner can see this' using errcode = '42501'; end if;
  with base as (
    select p.id, p.full_name, p.phone, p.created_at signed_up_at, t.property_id, t.approval_note,
      t.payment_mode, t.payment_status, t.room_no chosen_room, t.stay_type,
      case when t.registration_state is not null then t.rules_accepted_at end submitted_at,
      t.approved_at, ap.full_name approved_by,
      case when t.registration_state = 'ended' then 'ended'
           when t.registration_state = 'active' then 'living'
           when t.registration_state = 'pending' and t.approval_status = 'rejected' then 'rejected'
           when t.registration_state = 'pending' then 'waiting'
           -- older app tenants were approved without this flow; they are not "started"
           when t.user_id is null or t.approval_status = 'pending' then 'started' end stage
    from public.profiles p
    left join public.tenant_profiles t on t.user_id = p.id
    left join public.profiles ap on ap.id = t.approved_by
    where p.role = 'customer' and p.is_active
      and (p_property is null or t.property_id = p_property or t.property_id is null)
  ), regs as (select * from base where stage is not null)
  select jsonb_build_object(
    'counts', (select jsonb_object_agg(s, (select count(*) from regs where stage = s))
               from unnest(array['started', 'waiting', 'rejected', 'living', 'ended']) s),
    'rows', coalesce((select jsonb_agg(x order by x ->> 'sort_at' desc) from (
      select jsonb_build_object(
        'id', r.id, 'name', r.full_name, 'phone', r.phone, 'stage', r.stage, 'property_id', r.property_id,
        'signed_up_at', r.signed_up_at, 'submitted_at', r.submitted_at, 'approved_at', r.approved_at,
        'approved_by', r.approved_by, 'note', r.approval_note,
        'sort_at', coalesce(r.submitted_at, r.signed_up_at),
        'room_no', case when r.stage in ('living', 'ended') then coalesce(g.room_no, r.chosen_room) else coalesce(r.chosen_room, g.room_no) end,
        'stay_type', r.stay_type,
        'payment', case when r.stay_type is null then null when r.payment_mode = 'online' and r.payment_status <> 'paid' then 'waiting' else r.payment_status end,
        'payment_mode', r.payment_mode,
        'check_in', case when r.stage in ('living', 'ended') then g.check_in end,
        'checked_out_on', case when r.stage in ('living', 'ended') then g.checked_out_on end,
        'handlers', coalesce((select jsonb_agg(jsonb_build_object('name', m.full_name, 'seen', n.status = 'read') order by m.full_name)
          from public.notifications n join public.profiles m on m.id = n.user_id
          where n.kind = 'registration' and n.channel = 'in_app' and n.entity_id = r.id::text and m.role = 'manager'
            and n.created_at >= coalesce(r.submitted_at, r.signed_up_at)), '[]')) x
      from regs r
      left join lateral (select room_no, check_in, checked_out_on from public.register_guests rg
        where rg.customer_id = r.id order by rg.id desc limit 1) g on true
      order by coalesce(r.submitted_at, r.signed_up_at) desc
      limit least(greatest(coalesce(p_limit, 200), 1), 500)) s), '[]'))
  into res;
  return res;
end $$;
