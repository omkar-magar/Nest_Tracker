-- Electricity consumer IDs (MSEDCL) per flat. Residents pay the power bill themselves with their flat's ID.
-- Kept out of public.rooms because rooms are readable by anyone (public catalogue).
create table public.electricity_connections (
  id          bigint generated always as identity primary key,
  property_id text not null references public.properties (id),
  room_no     text not null check (room_no ~ '^[0-9A-Za-z]{1,10}$'),   -- plain room number, no wing prefix: '101'
  consumer_id text not null unique check (consumer_id ~ '^[0-9]{6,20}$'),
  note        text not null default '',
  updated_at  timestamptz not null default now(),
  unique (property_id, room_no)
);

alter table public.electricity_connections enable row level security;
grant select, insert, update, delete on public.electricity_connections to authenticated;
grant usage on sequence public.electricity_connections_id_seq to authenticated;
create policy elec_read on public.electricity_connections for select using (public.can_access_property(property_id));
create policy elec_write on public.electricity_connections for all
  using (public.can_manage_property(property_id)) with check (public.can_manage_property(property_id));

create function public.electricity_connections_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger electricity_connections_touch before update on public.electricity_connections
  for each row execute function public.electricity_connections_touch();

-- the signed-in resident's own flat and its consumer ID (booking or guest-register stay), else null
create function public.my_electricity_connection() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare place jsonb := public.my_complaint_place(); rno text; e public.electricity_connections%rowtype;
begin
  if place is null then return null; end if;
  rno := coalesce((select room_no from public.rooms where id = place ->> 'room_id'),
                  regexp_replace(coalesce(place ->> 'room_label', ''), '^[A-Za-z]+-', ''));
  select * into e from public.electricity_connections where property_id = place ->> 'property_id' and room_no = rno;
  return jsonb_build_object('room_label', place ->> 'room_label', 'consumer_id', e.consumer_id);
end $$;
revoke all on function public.my_electricity_connection() from public;
grant execute on function public.my_electricity_connection() to authenticated;

-- A wing (P1), flats 101-506, from the management notice of Nov 2026
insert into public.electricity_connections (property_id, room_no, consumer_id)
select 'P1', r, c from (values
  ('101', '170681865287'), ('102', '170681865295'), ('103', '170681865309'), ('104', '170681865317'), ('105', '170681865325'), ('106', '170681865333'),
  ('201', '170681865341'), ('202', '170681865350'), ('203', '170681865368'), ('204', '170681865376'), ('205', '170681865384'), ('206', '170681865392'),
  ('301', '170681865406'), ('302', '170681865414'), ('303', '170681865422'), ('304', '170681865431'), ('305', '170681865449'), ('306', '170681865457'),
  ('401', '170681865465'), ('402', '170681865473'), ('403', '170681865481'), ('404', '170681865490'), ('405', '170681865503'), ('406', '170681865511'),
  ('501', '170681865520'), ('502', '170681865538'), ('503', '170681865546'), ('504', '170681865554'), ('505', '170681865562'), ('506', '170681865571')
) v (r, c)
where exists (select 1 from public.properties where id = 'P1')
on conflict do nothing;
