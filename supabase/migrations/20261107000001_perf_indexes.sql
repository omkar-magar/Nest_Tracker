-- Indexes for the lists that grow over time. Tables are small today, so this is cheap insurance, not a fix.
-- Safe to re-run.

-- admin Payments tab and Activity tab: newest first
create index if not exists payments_created_idx on public.payments (created_at desc);
create index if not exists activity_log_created_idx on public.activity_log (created_at desc);

-- public "What residents say": published reviews, newest first
create index if not exists reviews_published_idx on public.reviews (created_at desc) where status = 'published';

-- admin Customers tab: customers newest first, one page at a time
create index if not exists profiles_customers_idx on public.profiles (created_at desc) where role = 'customer';
