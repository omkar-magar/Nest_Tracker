-- Saving a room failed with 'record "new" has no field "rent"': the shared rent-history trigger tested
-- `tg_table_name = 'beds' and new.rent ...` as one expression, and a rooms row has no rent column. Check the table
-- first, then the column, so each branch only reads columns its table has.
create or replace function public.track_rent_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'rooms' then
    if new.price is distinct from old.price then
      insert into public.rent_changes (room_id, old_rent, new_rent, changed_by, reason)
      values (new.id, old.price, new.price, auth.uid(), 'Room rent changed');
    end if;
  elsif tg_table_name = 'beds' then
    if new.rent is distinct from old.rent then
      insert into public.rent_changes (room_id, bed_id, old_rent, new_rent, changed_by, reason)
      values (new.room_id, new.id, old.rent, new.rent, auth.uid(), 'Bed rent changed');
    end if;
  end if;
  return new;
end $$;
