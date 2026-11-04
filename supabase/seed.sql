-- Catalogue seed, copied from the original src/data/site.js.
-- ALL PRICES AND DEPOSITS ARE DEMO VALUES (rooms.is_demo_price = true). Replace them with the client's real
-- numbers from the admin dashboard or by editing this file before going live.

insert into public.categories (id, name, tag, sort_order) values
  ('monthly-pg', 'Monthly PG',        'From ₹6,500 / month',         1),
  ('daily-pg',   'Daily PG',          'From ₹700 / night',         2),
  ('flat-1bhk',  '1BHK Flat',         'Furnished or empty',            3),
  ('lodge',      'Lodge Rooms',       'From ₹1,200 / night',            4),
  ('airbnb',     'Airbnb-style Stay', 'From ₹2,500 / night',            5)
on conflict (id) do nothing;

insert into public.rooms (id, category_id, room_no, floor, ac_type, description, features, image_url,
                          rent_basis, billing_period, price, deposit) values
  ('pg-101',   'monthly-pg', '101', 1, 'AC',     'Shared AC room in the PG block.',           '{AC,Furnished}',     '/images/rooms/pg-101.webp',   'bed',  'month', 7500,  7500),
  ('pg-102',   'monthly-pg', '102', 1, 'Non-AC', 'Shared non-AC room in the PG block.',       '{Furnished}',        '/images/rooms/pg-102.webp',   'bed',  'month', 6500,  6500),
  ('dpg-201',  'daily-pg',   '201', 2, 'AC',     'Shared AC room for short stays.',           '{AC,Furnished}',     '/images/rooms/dpg-201.webp',  'bed',  'night',  800,     0),
  ('flat-301', 'flat-1bhk',  '301', 3, 'AC',     'Self-contained 1BHK flat.',                 '{AC,Furnished}',     '/images/rooms/flat-301.webp', 'room', 'month', 18000, 18000),
  ('lodge-401','lodge',      '401', 4, 'AC',     'Private lodge room.',                       '{AC}',               '/images/rooms/lodge-401.webp','room', 'night', 1500,     0),
  ('stay-501', 'airbnb',     '501', 5, 'AC',     'Airbnb-style stay for a group.',            '{AC,Furnished}',     '/images/rooms/stay-501.webp', 'room', 'night', 3200,     0)
on conflict (id) do nothing;

insert into public.beds (room_id, label)
select r.id, chr(64 + n)
from (values ('pg-101', 2), ('pg-102', 3), ('dpg-201', 2), ('flat-301', 2), ('lodge-401', 2), ('stay-501', 4)) as t(room_id, cnt)
join public.rooms r on r.id = t.room_id
cross join lateral generate_series(1, t.cnt) as n
on conflict (room_id, label) do nothing;

insert into public.amenities (title, description, icon, image_url, sort_order) values
  ('AC & Non-AC rooms', 'Pick the room that suits your budget. Both are furnished and cleaned regularly.', '🛏️', '/images/rooms/pg-101.webp', 1),
  ('Gaming zone',       'A common gaming area to unwind with your housemates.',                             '🎮', '/images/hero/gaming.webp',    2),
  ('Gym',               'An in-house gym in the common area. No separate membership.',                      '🏋️', '/images/hero/gym.webp',       3),
  ('Pickleball court',  'Play a game after work without leaving the building.',                             '🏓', '/images/hero/pickleball.webp',4),
  ('Chill café area',   'A relaxed corner for coffee, work calls and conversation.',                        '☕', '/images/hero/cafe.webp',       5),
  ('Security guard',    'Guard on duty so you and your belongings stay safe.',                              '💂', null,                          6);

-- No reviews are seeded on purpose. Reviews come only from real customers (see reviews table).
