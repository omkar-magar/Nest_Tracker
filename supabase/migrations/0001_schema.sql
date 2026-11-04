-- YOLO Nest: core schema.
-- Occupancy truth lives in booking_beds (one active row per bed, enforced by a unique index).
-- beds.is_occupied is a trigger-maintained mirror so the public site can subscribe to it with Realtime
-- without ever being able to read bookings.

create extension if not exists pgcrypto;

create type public.app_role as enum ('customer', 'employee', 'admin');

-- ---------------------------------------------------------------- users
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.app_role not null default 'customer',
  full_name   text not null default '',
  phone       text,                       -- digits only, with country code if known (used for WhatsApp links)
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Per-employee switches, enforced in RLS / RPCs (see 0002 + 0003). Admin ignores this table.
create table public.employee_permissions (
  employee_id             uuid primary key references public.profiles (id) on delete cascade,
  can_view_customers      boolean not null default true,   -- names, rooms, due dates
  can_view_contacts       boolean not null default true,   -- phone numbers / WhatsApp
  can_view_payments       boolean not null default false,  -- amounts and payment history
  can_manage_beds         boolean not null default false   -- mark beds under maintenance
);

create table public.app_settings (
  key    text primary key,
  value  jsonb not null
);

-- ---------------------------------------------------------------- inventory
create table public.categories (
  id          text primary key,
  name        text not null,
  tag         text not null default '',
  sort_order  int  not null default 0
);

create table public.rooms (
  id            text primary key,                 -- same as public/images/rooms/<id>.webp
  category_id   text not null references public.categories (id),
  room_no       text not null unique,
  floor         int  not null default 0,
  ac_type       text not null check (ac_type in ('AC', 'Non-AC')),
  description   text not null default '',
  features      text[] not null default '{}',
  image_url     text,
  -- rent_basis 'bed': price is per bed. 'room': price is for the whole room and a booking takes every bed.
  rent_basis    text not null check (rent_basis in ('bed', 'room')),
  billing_period text not null check (billing_period in ('month', 'night')),
  price         int  not null check (price > 0),  -- rupees
  deposit       int  not null default 0 check (deposit >= 0),
  is_active     boolean not null default true,
  is_demo_price boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.beds (
  id           uuid primary key default gen_random_uuid(),
  room_id      text not null references public.rooms (id) on delete cascade,
  label        text not null,
  status       text not null default 'available' check (status in ('available', 'maintenance')),
  is_occupied  boolean not null default false,
  unique (room_id, label)
);
create index beds_room_idx on public.beds (room_id);

create table public.amenities (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null default '',
  icon        text not null default '',
  image_url   text,
  sort_order  int not null default 0
);

-- ---------------------------------------------------------------- bookings and billing
create table public.bookings (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.profiles (id),
  room_id        text not null references public.rooms (id),
  status         text not null default 'pending'
                   check (status in ('pending', 'active', 'completed', 'cancelled', 'expired')),
  billing_period text not null check (billing_period in ('month', 'night')),
  rate           int  not null check (rate > 0),          -- rupees per bed (or per room) per period, frozen at booking time
  deposit        int  not null default 0,
  check_in       date not null,
  check_out      date,                                     -- required for nightly stays
  hold_expires_at timestamptz,                             -- pending bookings release their beds after this
  created_at     timestamptz not null default now(),
  check (billing_period = 'month' or check_out is not null),
  check (check_out is null or check_out > check_in)
);
create index bookings_customer_idx on public.bookings (customer_id);
create index bookings_room_idx on public.bookings (room_id);
-- one live booking per customer keeps a single person from holding every bed
create unique index bookings_one_live_per_customer
  on public.bookings (customer_id) where status in ('pending', 'active');

create table public.booking_beds (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  bed_id     uuid not null references public.beds (id),
  active     boolean not null default true,
  primary key (booking_id, bed_id)
);
-- the race-condition guard: a bed can have at most one active booking
create unique index booking_beds_one_active_per_bed on public.booking_beds (bed_id) where active;

create table public.bills (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings (id) on delete cascade,
  customer_id  uuid not null references public.profiles (id),
  kind         text not null check (kind in ('deposit', 'rent')),
  description  text not null,
  amount       int  not null check (amount > 0),
  due_date     date not null,
  status       text not null default 'unpaid' check (status in ('unpaid', 'paid', 'void')),
  paid_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index bills_customer_idx on public.bills (customer_id);
create index bills_due_idx on public.bills (due_date) where status = 'unpaid';

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  bill_id             uuid not null references public.bills (id),
  customer_id         uuid not null references public.profiles (id),
  amount              int  not null check (amount > 0),
  provider            text not null check (provider in ('demo', 'razorpay', 'cash')),
  is_simulated        boolean not null default false,       -- true for every demo payment
  status              text not null default 'created' check (status in ('created', 'succeeded', 'failed')),
  provider_order_id   text,
  provider_payment_id text,
  failure_reason      text,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);
create index payments_bill_idx on public.payments (bill_id);
create index payments_customer_idx on public.payments (customer_id);
-- a bill can only have one succeeded payment, so a replayed webhook can't double-count it
create unique index payments_one_success_per_bill on public.payments (bill_id) where status = 'succeeded';

create table public.customer_documents (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.profiles (id) on delete cascade,
  booking_id   uuid references public.bookings (id) on delete set null,
  doc_type     text not null check (doc_type in ('id_proof', 'address_proof', 'photo', 'agreement', 'other')),
  file_path    text not null,            -- storage key inside the customer-documents bucket: <customer_id>/<file>
  file_name    text not null,
  created_at   timestamptz not null default now()
);
create index customer_documents_customer_idx on public.customer_documents (customer_id);

-- Only genuine reviews: written by a customer who has a booking, published by the admin.
create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade unique,
  author_name text not null,
  rating      int  not null check (rating between 1 and 5),
  body        text not null check (char_length(body) between 10 and 1000),
  status      text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  created_at  timestamptz not null default now()
);

create table public.activity_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  entity     text,
  entity_id  text,
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_log_actor_idx on public.activity_log (actor_id, created_at desc);

-- ---------------------------------------------------------------- triggers
-- New auth user -> customer profile. The role is never taken from client-supplied metadata.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g'), '')
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep beds.is_occupied in step with booking_beds.
create function public.sync_bed_occupancy() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update public.beds set is_occupied = false where id = old.bed_id;
    return old;
  end if;
  update public.beds set is_occupied = new.active where id = new.bed_id;
  return new;
end $$;

create trigger booking_beds_sync after insert or update of active or delete on public.booking_beds
  for each row execute function public.sync_bed_occupancy();

insert into public.app_settings (key, value) values
  ('demo_payments_enabled', 'true'::jsonb),
  ('hold_minutes', '30'::jsonb);
