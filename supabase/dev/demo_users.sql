-- LOCAL DEVELOPMENT ONLY. Never run this against a real project: it creates accounts with known passwords.
-- Run manually after `supabase db reset`:   psql "$DB_URL" -f supabase/dev/demo_users.sql
--   admin@yolonest.test / employee@yolonest.test / customer@yolonest.test   password: Demo#12345

do $$
declare
  u record;
  uid uuid;
begin
  for u in select * from (values
    ('admin@yolonest.test',    'Demo Admin',    'admin'),
    ('employee@yolonest.test', 'Demo Employee', 'employee'),
    ('customer@yolonest.test', 'Demo Customer', 'customer')) as t(email, name, role)
  loop
    if exists (select 1 from auth.users where email = u.email) then continue; end if;
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', u.email,
            crypt('Demo#12345', gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name, 'phone', '9100000000'),
            now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', u.email),
            'email', now(), now(), now());
    -- the on_auth_user_created trigger made a customer profile; promote it
    update public.profiles set role = u.role::public.app_role where id = uid;
    if u.role = 'employee' then
      insert into public.employee_permissions (employee_id) values (uid);
    end if;
  end loop;
end $$;
