-- A guest who came back for a new registration still had the coupon of their previous (approved) registration, so a
-- single-use code that was already used came off the new price again. A new registration (moving into 'pending' from
-- any other state) starts without a coupon; sending the same waiting registration again keeps its coupon.
create function public.tenant_new_registration_coupon() returns trigger
language plpgsql as $$
begin
  if new.registration_state = 'pending' and old.registration_state is distinct from 'pending' then
    new.coupon_code := null;
    new.discount := 0;
  end if;
  return new;
end $$;
create trigger tenant_profiles_new_registration_coupon before update of registration_state on public.tenant_profiles
  for each row execute function public.tenant_new_registration_coupon();
