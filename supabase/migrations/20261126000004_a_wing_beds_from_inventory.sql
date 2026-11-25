-- A wing bed map had placeholder counts (4 per room). Match it to the stock lists in room_inventory:
-- beds = bed frames; a room with no frames counts its mattresses (106 sleeps on 6); a room with neither keeps
-- one bed for the guest renting it. Only free, never-used beds are removed. Safe to run again.
create temporary table _bed_target as
select r.id room_id,
       greatest(coalesce(max(i.qty) filter (where i.item = 'bed'), 0),
                case when coalesce(max(i.qty) filter (where i.item = 'bed'), 0) = 0
                     then coalesce(max(i.qty) filter (where i.item = 'mattress'), 0) else 0 end,
                1) n
from public.rooms r
join public.room_inventory i on i.property_id = r.property_id and i.room_no = r.room_no
where r.property_id = 'P1'
group by r.id;

insert into public.beds (room_id, label)
select t.room_id, chr(64 + g) from _bed_target t cross join generate_series(1, t.n) g
on conflict (room_id, label) do nothing;

delete from public.beds b using _bed_target t
where b.room_id = t.room_id
  and b.label ~ '^[A-Z]$' and ascii(b.label) - 64 > t.n
  and not b.is_occupied and not b.is_reserved and b.status = 'available'
  and not exists (select 1 from public.booking_beds x where x.bed_id = b.id)
  and not exists (select 1 from public.reservations x where x.bed_id = b.id);

drop table _bed_target;
