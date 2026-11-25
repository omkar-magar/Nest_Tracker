-- Furniture and mattress stock per room (Admin -> Inventory). Keyed by wing (property) and plain room number,
-- like electricity_connections, so a count survives rooms being re-created. Seeded from the owner's floor-wise
-- A wing stock lists (1st to 5th floor, counted 2026-11).
create table public.room_inventory (
  property_id text not null references public.properties (id) on delete cascade,
  room_no     text not null check (room_no ~ '^[0-9A-Za-z]{1,10}$'),   -- '101', no wing prefix
  item        text not null check (item ~ '^[a-z_]{1,30}$'),           -- mattress, cupboard, table, bed, chair, ...
  qty         int  not null default 0 check (qty between 0 and 999),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  primary key (property_id, room_no, item)
);

alter table public.room_inventory enable row level security;
grant select, insert, update, delete on public.room_inventory to authenticated;
create policy inventory_read on public.room_inventory for select using (public.can_access_property(property_id));
create policy inventory_write on public.room_inventory for all
  using (public.can_manage_property(property_id)) with check (public.can_manage_property(property_id));

create function public.room_inventory_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger room_inventory_touch before insert or update on public.room_inventory
  for each row execute function public.room_inventory_touch();

insert into public.room_inventory (property_id, room_no, item, qty)
select 'P1', s.room_no, i.item, i.qty
from (values
  -- room, mattress, cupboard, table, bed, chair
  ('101', 0, 0, 0, 0, 0), ('102', 5, 5, 2, 5, 1), ('103', 3, 3, 2, 3, 0),
  ('104', 2, 2, 1, 2, 0), ('105', 3, 3, 2, 3, 1), ('106', 6, 1, 4, 0, 0),
  ('201', 4, 4, 2, 4, 1), ('202', 0, 0, 0, 0, 0), ('203', 0, 1, 1, 0, 2),
  ('204', 2, 2, 1, 2, 1), ('205', 3, 3, 1, 3, 1), ('206', 4, 4, 2, 4, 0),
  ('301', 2, 3, 1, 2, 0), ('302', 0, 0, 0, 0, 0), ('303', 3, 4, 2, 3, 1),
  ('304', 3, 3, 2, 3, 1), ('305', 0, 0, 0, 0, 0), ('306', 4, 4, 2, 4, 0),
  ('401', 4, 4, 2, 4, 0), ('402', 4, 4, 3, 4, 0), ('403', 3, 3, 2, 3, 0),
  ('404', 2, 3, 3, 2, 2), ('405', 0, 0, 0, 0, 0), ('406', 4, 3, 1, 3, 0),
  ('501', 0, 0, 0, 0, 0), ('502', 1, 5, 0, 3, 0), ('503', 3, 3, 0, 3, 0),
  ('504', 1, 1, 1, 1, 1), ('505', 3, 3, 2, 3, 0), ('506', 4, 3, 4, 4, 0)
) s (room_no, mattress, cupboard, tbl, bed, chair)
cross join lateral (values ('mattress', s.mattress), ('cupboard', s.cupboard), ('table', s.tbl),
                           ('bed', s.bed), ('chair', s.chair)) i (item, qty)
where exists (select 1 from public.properties where id = 'P1')
on conflict do nothing;
