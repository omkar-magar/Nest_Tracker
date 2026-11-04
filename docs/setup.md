# Setup

## 1. Supabase
Local (needs Docker + Supabase CLI):
```bash
supabase start            # prints API URL and anon key
supabase db reset         # runs supabase/migrations/*.sql, then supabase/seed.sql
supabase functions serve create-employee
```
Hosted: create a project, then run the four files in `supabase/migrations/` in order in the SQL editor, then `seed.sql`.
Deploy the function: `supabase functions deploy create-employee`.

## 2. Environment (`.env.local`, see `.env.example`)
| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | project URL |
| `VITE_SUPABASE_ANON_KEY` | public anon key (safe in the browser) |
| `VITE_PAYMENT_PROVIDER` | `demo` (default) |

The service-role key is only used inside the Edge Function (injected by Supabase). Never put it in a `VITE_` variable.
Without the two Supabase variables the public site still works from `src/data/site.js`; login, booking and dashboards show a "not configured" notice.

## 3. First admin
Sign up on `/signup`, then in the SQL editor:
```sql
update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'owner@example.com');
```
Admin then creates employees in the Admin dashboard > Employees (uses the `create-employee` function).
Local dev only: `supabase/dev/demo_users.sql` creates admin/employee/customer test accounts with a known password. Never run it on a real project.

In Auth settings decide whether email confirmation is required; signup handles both.

## 4. Database
| File | Contents |
|---|---|
| `20261104000001_schema.sql` | tables, constraints, indexes, signup trigger, bed-occupancy trigger |
| `20261104000002_rls.sql` | RLS on every table, column grants, realtime publication (`beds`, `rooms` only) |
| `20261104000003_functions.sql` | `book_room`, `cancel_booking`, payment functions, staff and admin RPCs |
| `20261104000004_storage.sql` | buckets `customer-documents` (private, `<user_id>/…`) and `room-images` (public read, admin write) |

Key rules: customers read only their own rows; employees get customer data only through `staff_customer_overview()`, trimmed by their permission switches (`employee_permissions`); roles cannot be changed from the client; payments/bookings/bills have no client write policies.
Double booking: `book_room` locks the room row, and a unique index allows one active `booking_beds` row per bed. Unpaid holds expire after 30 minutes (`app_settings.hold_minutes`).

## 5. PWAs (one build, three installable apps)
| App | Open | Manifest | Scope |
|---|---|---|---|
| Public | `/` | `manifest.webmanifest` | `/` |
| Employee | `/staff/` | `manifest-staff.webmanifest` | `/staff/` |
| Admin | `/admin/` | `manifest-admin.webmanifest` | `/admin/` |

The page's manifest link switches by URL area (`usePwaIdentity`). Install from the browser menu while on that area (Chrome: Install app; iOS: Share > Add to Home Screen). `/staff/` and `/admin/` open the dashboard if a session exists, else the matching login. Sessions persist in Supabase's local storage and refresh automatically.
`public/sw.js` handles only same-origin GETs (app shell, hashed assets, images). Supabase traffic is cross-origin and never cached. It registers in production builds only (`npm run build && npm run preview`). HTTPS is required for install (localhost is exempt).
Note: all three apps share one origin, so one browser holds one login. Icons are generated from `logo.png` (low resolution); supply a higher-res logo for sharper icons.

## 6. Images
Admin room photos can use the `room-images` bucket; existing photos still come from `public/images/rooms/<room-id>.webp`.
