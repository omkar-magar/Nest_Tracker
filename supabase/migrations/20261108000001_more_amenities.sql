-- Adds four amenities to the six in seed.sql. These live here only: migrations run before the seed, so repeating them there would duplicate them.
insert into public.amenities (title, description, icon, image_url, sort_order)
select t.title, t.description, t.icon, null, t.sort_order
from (values
  ('Self-cooking kitchen',   'Cook your own meals with induction stoves, a microwave and a fridge, plus 24x7 RO water.', '🍳', 7),
  ('High-speed Wi-Fi',       'Included in your rent, for work calls and streaming.',                                     '📶', 8),
  ('Laundry station',        'Wash your clothes without leaving the building.',                                          '🧺', 9),
  ('CCTV & biometric entry', 'Monitored common areas and controlled entry to the building.',                             '📹', 10)
) as t(title, description, icon, sort_order)
where not exists (select 1 from public.amenities a where a.title = t.title);
