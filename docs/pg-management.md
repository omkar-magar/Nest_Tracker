# PG management (PRD v1.0, 19 Nov 2026)

The owner / manager / sales console lives at `/admin`, the staff app at `/staff`, the tenant app at `/account`.
All three are the existing installable PWAs. Every rule (who may see what, money maths, status flows) is in the
database: RLS policies and RPCs in `supabase/migrations/2026112100000[1-9]_*.sql`. The React screens only call them.

## Roles
| PRD role | `profiles.role` | Opens | Sees |
|---|---|---|---|
| Super Admin / Owner | `admin` | `/admin` (all modules), `/staff` | everything, every property |
| Property Manager | `manager` | `/admin` (no Settings / Website), `/staff` | only properties ticked for them in Settings → Users |
| Staff | `employee` | `/staff` | own tasks, attendance, assigned complaints, leave, payslips |
| Sales / Marketing | `sales` | `/admin` → Beds, Enquiries, Marketing & sales | leads assigned to them or their properties |
| Tenant | `customer` | `/account` | own stay, invoices, documents, complaints, agreement, notices |

Owner creates logins in **Settings & users → Create login** (Edge Function `create-user`), sets roles, and
assigns properties. Managers register tenants (login by mobile OTP; email optional).

## Setup
1. Run the new migrations in order (`supabase db push`, or paste them into the SQL editor). `..._01_roles.sql` must be
   committed before the others (it adds enum values). On Render, `npm run db:migrate` applies them too; the storage file
   (`..._09_storage_pg.sql`) is Supabase-only and skipped there.
2. Deploy the functions: `supabase functions deploy create-user run-jobs` (plus the existing ones).
3. Secrets (`supabase secrets set ...`):

   | Secret | For |
   |---|---|
   | `CRON_SECRET` | protects `run-jobs` (required) |
   | `SITE_URL` | links inside messages, e.g. `https://yolonest.in` (also set it in Settings → Rules) |
   | `RESEND_API_KEY`, `MAIL_FROM` | email reminders, receipts, the owner's monthly report |
   | `MSG91_AUTH_KEY`, `MSG91_SENDER`, `MSG91_TEMPLATE_ID` | SMS (DLT-registered template with one variable) |
   | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | WhatsApp Cloud API |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | web push (`npx web-push generate-vapid-keys`) |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | online payments (docs/payments.md) |

   The browser needs `VITE_VAPID_PUBLIC_KEY` (same public key) at build time for "Turn on phone alerts".
   A channel without keys is not an error: its messages are marked `skipped` with the reason (Rent & payments → Reminders sent).
4. Scheduler: call `run-jobs` every 30 minutes, e.g. Supabase Dashboard → Integrations → Cron → HTTP request
   `POST https://<project>.supabase.co/functions/v1/run-jobs` with header `x-cron-secret: <CRON_SECRET>`.
   If `pg_cron` is enabled the migration also schedules `run_scheduled_jobs()` (rules only, no delivery).
   Opening the console also runs the rules (at most every 30 minutes); Settings → Automation → Run now forces it.
5. Phone OTP login: Supabase → Authentication → Providers → Phone, with an SMS provider (MSG91 / Twilio).
6. Fill in Settings → Rent, reminders & rules (due day, late fee, reminder schedule, approval limit, lead assignment,
   referral reward, payroll PF/ESI, Google review link) and Settings → Message templates (match DLT text for SMS).
7. Properties & rooms → Properties: set latitude / longitude for each property, or staff GPS check-in is accepted without a distance check.

## What runs on its own (`run_scheduled_jobs`)
Monthly invoices (pro-rata, recurring charges, offer discounts, credit applied) · late fees · rent reminders before / on /
after due date, then weekly · reservations released after expiry · online booking holds released · repeat-defaulter flags ·
recurring expenses · overdue complaint escalation · preventive maintenance tickets and reminders · daily staff checklists ·
visit and follow-up reminders · agreement renewal alerts (30 days) · referral rewards · owner's monthly email report (1st–3rd).

## Tests
`npm test` (UI, mocked Supabase) and `npm run test:db` (all migrations in an in-process Postgres via PGlite; 33 tests on
billing, check-in/out, RLS, complaints, sales, payroll, reports, jobs). The DB tests run one file at a time with
`--liftoff-only` because V8's optimising wasm compiler runs out of memory on this machine.

## Not done / needs a decision
- **Native Android / iOS apps**: the tenant, staff and admin apps are installable PWAs (Android TWA via `assetlinks.json`
  already exists). Store packaging (Play Store TWA build, iOS wrapper) is a release task, not code here.
- **Message delivery** needs the provider accounts above (MSG91 DLT registration, WhatsApp Business verification,
  Resend domain, VAPID keys). Without them messages queue and are marked `skipped`.
- **Phone OTP** needs an SMS provider in Supabase Auth. Agreement acceptance is click-wrap (signed-in tenant types their
  full name and accepts the rules), not OTP or Aadhaar e-sign; an e-sign provider (e.g. Digio, Leegality) would be a new integration.
- **Payment gateway**: Razorpay is wired (orders, verify, webhook) and supports part payments; it needs live keys.
  Auto-reconciliation of settlements and gateway refunds [Should] need the Razorpay Settlements / Refunds APIs and
  credentials; deposit refunds are recorded manually at check-out.
- **Online token for leads without a login** [Should 9.1]: leads can be reserved with an advance taken at the office;
  paying a token online needs Razorpay Payment Links. Logged-in visitors can still book and pay online (`/book`).
- **Dates** use the database's `current_date` (UTC on Supabase), as the original booking code did. Between midnight and
  05:30 IST "today" is still yesterday for due dates and reminders. Setting the database time zone to Asia/Kolkata would fix it; ask first.
- **Documents at rest**: Supabase Storage encrypts files at rest (AES-256) and the buckets are private with signed URLs;
  no extra application-level encryption was added. Only the last 4 characters of ID numbers are stored.
- Prices, deposits and the agreement template text are demo values; replace them with the owner's.

## Requirement checklist
✔ done and tested against Postgres · ✔ᵘ done, UI only (no live backend to click through here) · ◐ partly · ✖ blocked (see above)

| PRD | Requirement | Status | Where |
|---|---|---|---|
| 2.1 | Unlimited properties, details, map, photos, GST/licence | ✔ | `properties`; Properties & rooms |
| 2.1 | Manager login per property; owner sees all + switches | ✔ | `property_members`, property switcher |
| 2.1 | Role-based access by property | ✔ | `can_manage_property` + RLS; tests |
| 2.1 | Mobile + OTP login, email/password, password reset | ◐ | Login (OTP needs SMS provider), `/forgot-password` |
| 2.1 | [Should] branded login per property | ✔ᵘ | `/admin/login?property=P1` |
| 2.2 | Property > Floor > Room > Bed, add/edit/deactivate | ✔ | `floors`, rooms, beds; `set_floor_active` |
| 2.2 | Room attributes | ✔ | rooms columns |
| 2.2 | Bed id P1-F2-R204-B1, bed or room rent | ✔ | `beds.code`, `beds.rent` |
| 2.2 | [Should] bulk creation | ✔ | `bulk_create_rooms` |
| 2.3 | Vacant / Occupied / Reserved / Maintenance, colours | ✔ | `bed_state`; Beds |
| 2.3 | Reservation with name, advance, expiry; auto-release + alert | ✔ | `reserve_bed`, `release_expired_reservations` |
| 2.3 | Visual bed map, tap to see / allocate | ✔ᵘ | Beds |
| 2.3 | Real-time | ✔ᵘ | Realtime on `beds` + 60 s refresh |
| 2.3 | [Should] upcoming vacancies | ✔ᵘ | Beds, Dashboard |
| 2.4 | Rent per bed/room, tenant, paid/due per room | ✔ᵘ | Properties → Room-wise rent |
| 2.4 | Rent history with effective dates | ✔ | `rent_changes` (+ transfers) |
| 2.4 | [Should] expected vs collected per room | ✔ᵘ | Room-wise rent |
| 3.1 | Office registration; self-registration + approval | ✔ | `create-user`, `staff_save_tenant`, `save_my_tenant_profile`, `set_tenant_approval` |
| 3.1 | Profile fields; at least one emergency contact | ✔ | `tenant_profiles`; enforced in RPCs |
| 3.1 | Mobile verified by OTP | ◐ | OTP login (needs SMS provider) |
| 3.1 | [Should] guardian details + consent | ✔ | reminders / complaint copies to guardian |
| 3.2 | ID uploads front/back, image or PDF | ✔ᵘ | Tenant → Documents |
| 3.2 | Secure storage, role-only access, last-4 masking | ✔ | private bucket, RLS, `id_last4` |
| 3.2 | Verify / reject with reason, re-request | ✔ | `review_document` (+ notification) |
| 3.2 | [Should] police verification tracking | ✔ | `set_police_verification` |
| 3.3 | Check-in / expected / actual check-out, notice | ✔ | bookings columns, `give_notice` |
| 3.3 | Check-in flow | ✔ | `check_in_tenant`; Check in wizard |
| 3.3 | Check-out final bill − deposit = refund/payable | ✔ | `checkout_quote`, `check_out_tenant` |
| 3.3 | Transfer with history | ✔ | `transfer_stay` |
| 3.3 | [Should] checklists with photos | ✔ᵘ | `stay_checklists` |
| 3.4 | Upload signed agreement PDF; agreement details | ✔ | `record_agreement` |
| 3.4 | [Should] template generation + acceptance | ◐ | `generate_agreement`, click-wrap `accept_agreement` (no OTP e-sign) |
| 3.4 | [Should] expiry alert | ✔ | `run_agreement_alerts` |
| 3.4 | Tenant views/downloads agreement and receipts | ✔ᵘ | Account (PDFs) |
| 4.1 | Monthly auto rent (fixed day or check-in cycle) | ✔ | `generate_invoices_for_booking` |
| 4.1 | Pending / partially paid / paid / overdue | ✔ | `bill_state` |
| 4.1 | Part / advance payments, discounts, adjustments w/ reason + audit | ✔ | `bill_lines`, `tenant_credits`, `add_bill_line` |
| 4.1 | Pro-rata | ✔ | tested |
| 4.2 | Push / SMS / WhatsApp / email reminders | ◐ | queued per channel; delivery needs keys |
| 4.2 | Configurable schedule; editable templates | ✔ | Settings |
| 4.2 | [Should] copy to guardian | ✔ | |
| 4.3 | UPI / card / net banking via gateway | ◐ | Razorpay wired; needs live keys |
| 4.3 | One-tap pay from app and reminder link | ✔ᵘ | `/account?pay=<bill>` |
| 4.3 | Auto receipt PDF; webhook status | ✔ᵘ | `receipt_no`, receipt PDF + notification; existing webhook |
| 4.3 | Manual cash/bank/cheque with reference + proof | ✔ | `record_manual_payment` |
| 4.3 | [Should] auto-reconciliation and refunds | ✖ | needs Razorpay settlement/refund API access |
| 4.4 | Deposit record, statuses, itemised deductions, refund | ✔ | `security_deposits` |
| 4.4 | [Should] deposit held per property | ✔ | `report_deposits_held` |
| 4.5 | Overdue dashboard; late fee rules | ✔ | Rent & payments → Overdue; `apply_late_fees` |
| 4.5 | [Should] repeat-defaulter flag | ✔ | `refresh_risk_flags` |
| 4.6 | Extra charges, electricity fixed/split/meter, separate lines | ✔ | `staff_add_charge`, `add_electricity` |
| 4.6 | [Should] recurring charges | ✔ | `recurring_charges` |
| 4.7 | Outstanding by tenant/room/property/month with ageing; export; remind | ✔ | `report_outstanding` |
| 5.1 | Expense categories, custom categories, links to salaries / repairs / marketing | ✔ | `expense_categories`, auto-booked expenses |
| 5.2 | Expense fields + receipt photo; recurring | ✔ | Expenses |
| 5.2 | [Should] approval above a limit | ✔ | `expense_guard`, `approve_expense` |
| 5.3 | Property income/expense, monthly P&L, charts, PDF/Excel | ✔ | `report_profit_loss`, Reports |
| 6.1 | Tenant complaint with photos/video, preferred time; categories; office logging | ✔ | `raise_complaint` |
| 6.2 | Assign staff/vendor, priority, SLA; status flow + reopen | ✔ | `update_complaint` |
| 6.2 | Push to tenant and staff on each change | ◐ | queued (push needs VAPID keys); in-app inbox works |
| 6.2 | Dashboard pending/resolved/overdue/avg time | ✔ᵘ | Complaints |
| 6.2 | [Should] rating, escalation | ✔ | |
| 6.3 | History per room/bed/property with cost and photos; cost → expenses | ✔ | |
| 6.3 | [Should] preventive schedule | ✔ | `maintenance_schedules` |
| 7.1 | Dashboard metrics, check-ins/outs, property comparison | ✔ | `owner_dashboard` |
| 7.2 | 8 reports, filters, PDF/Excel export | ✔ | Reports |
| 7.2 | Monthly report emailed to owner | ◐ | queued on the 1st; needs Resend key |
| 7.2 | [Should] 12-month trends, seasonality, conversion | ✔ | `report_trends` |
| 8.1 | Capture from website / app / walk-in / call | ✔ | `submit_enquiry`, Add enquiry |
| 8.1 | Google / Facebook / Instagram lead forms, WhatsApp, click-to-call | ◐ | tracked links + CSV import; direct API sync needs Meta/Google lead-form webhooks and accounts |
| 8.1 | Raw data as received; duplicates by mobile; CSV export/import | ✔ | `enquiry_submissions`, `import_enquiries` |
| 8.2 | List with search/filters/sort; detail actions; statuses; convert | ✔ᵘ | Enquiries |
| 8.2 | [Should] Kanban + timeline | ✔ᵘ | Board view |
| 9.1 | Lead temperature, auto-assignment, follow-ups, call log, visits | ✔ | |
| 9.1 | [Should] online token + hold + convert | ◐ | office reservation with advance; online token needs payment links |
| 9.1 | [Should] lost-lead analysis | ✔ | funnel lost reasons |
| 9.2 | Campaigns, sources, spend → expenses, CPL / CPB | ✔ | |
| 9.2 | [Should] bulk SMS/WhatsApp/email with opt-out | ◐ | queued + unsubscribe link; delivery needs keys |
| 9.2 | [Should] tracked links / QR, referrals, offers | ✔ | |
| 9.3 | [Should] brokers, commissions | ✔ | |
| 9.4 | [Should] public vacancy page + enquiry form; brochure; WhatsApp message | ✔ᵘ | `/vacancies`, `/brochure`, Beds → Share vacancies |
| 9.4 | [Later] Google review link | ✔ᵘ | Settings → Google review link |
| 9.5 | Funnel, source/campaign, executive reports; [Should] time to close, vacancy days, forecast | ✔ | |
| 10.1 | Employee profiles, documents, emergency, status/exit | ✔ | `staff_members`, `staff_documents` |
| 10.1 | [Should] employee app login | ✔ | `staff_members.user_id` |
| 10.2 | Attendance by manager or self check-in; roster; leave | ✔ | |
| 10.2 | [Should] selfie + GPS; overtime | ✔ | `staff_check_in`, `staff_check_out` |
| 10.3 | Salary structure, auto payroll, advances, payslip PDF, → expenses | ✔ | `generate_payroll`, `pay_payslip` |
| 10.3 | [Should] PF/ESI, bonus, increment history | ✔ | `salary_revisions` |
| 10.4 | Role checklists with photo proof; assigned complaints in task list | ✔ | `generate_daily_tasks`, staff app |
| 10.4 | [Should] performance view; staff notices | ✔ | `report_staff_performance`, notices |
| 10.5 | Attendance, salary, advances, leave reports; [Should] staff cost % | ✔ | Reports |
| 1.3 | Android/iOS tenant app; staff mobile screens | ◐ | installable PWAs; store builds not done |
