-- Log in with a phone number (customers) or a username (staff, manager, admin) instead of an email.
-- Supabase Auth still signs in by email, so the login page asks this function for the email first.
alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key on public.profiles (lower(username)) where username is not null;

create or replace function public.login_email(p_identifier text, p_staff boolean default false)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.email::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.is_active
    and case
      when p_staff then p.role <> 'customer' and lower(p.username) = lower(trim(p_identifier))
      else p.role = 'customer'
        and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(p_identifier, '\D', '', 'g'), 10)
        and length(regexp_replace(p_identifier, '\D', '', 'g')) >= 10
    end
  order by p.created_at
  limit 1;
$$;

revoke all on function public.login_email(text, boolean) from public;
grant execute on function public.login_email(text, boolean) to anon, authenticated;

-- Existing staff get their email's first part as username (the full email if that is taken); change it later in settings.
update public.profiles p set username = case
    when exists (select 1 from public.profiles q join auth.users qu on qu.id = q.id
                 where q.id <> p.id and q.role <> 'customer' and split_part(qu.email, '@', 1) = split_part(u.email, '@', 1)) then u.email
    else split_part(u.email, '@', 1) end
from auth.users u
where u.id = p.id and p.role <> 'customer' and p.username is null;
