-- Replaces Supabase Realtime. Any change to beds or rooms sends a NOTIFY; the API listens and pushes
-- an event to open browsers (server/events.js), so availability stays live.

create or replace function public.notify_availability() returns trigger
language plpgsql as $$
begin
  perform pg_notify('availability', tg_table_name);
  return null;
end $$;

create trigger beds_notify after insert or update or delete on public.beds
  for each statement execute function public.notify_availability();
create trigger rooms_notify after insert or update or delete on public.rooms
  for each statement execute function public.notify_availability();
