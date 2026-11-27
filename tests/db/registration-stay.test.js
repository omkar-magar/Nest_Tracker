// @vitest-environment node
// Registration v2: the guest picks stay type, a free room, dates and due day; prices come from Settings (PGlite).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, freshDb, makeUser } from './pg'

let db, guest, other, manager, room, flat
const day = (offset = 0) => {
  const d = new Date(Date.now() + offset * 864e5)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}
const form = (extra = {}) => JSON.stringify({
  property_id: 'P1', full_name: 'Amit', phone: '9800000000', emergency1_name: 'Parent', emergency1_phone: '9800000001',
  rules_accepted: true, stay_type: 'pg', room_no: room, move_in_date: day(), due_day: 5, ...extra,
})
const submit = (who, extra) => as(db, who, ({ q }) => q('select public.submit_resident_registration($1)', [form(extra)]))
const reg = (who = guest) => as(db, who, ({ one }) => one('select public.my_registration() r')).then((x) => x.r)
const one = async (sql, params) => (await db.query(sql, params)).rows[0]

beforeAll(async () => {
  db = await freshDb()
  guest = await makeUser(db, 'customer', 'Amit')
  other = await makeUser(db, 'customer', 'Neha')
  manager = await makeUser(db, 'manager', 'Priya')
  await db.query("insert into public.property_members(property_id, user_id) values ('P1', $1)", [manager])
  room = (await one("select wing || '-' || room_no k from public.rooms where property_id = 'P1' and is_active and room_type <> 'flat' order by room_no limit 1")).k
  // one flat with two beds, free
  const f = await one("select id, wing || '-' || room_no k from public.rooms where property_id = 'P1' and is_active order by room_no desc limit 1")
  await db.query("update public.rooms set room_type = 'flat' where id = $1", [f.id])
  flat = f.k
}, 120000)
afterAll(async () => { await db?.close() })

describe('stay prices', () => {
  it('quotes a month plus deposit for monthly stays and nights for daily stays', async () => {
    const q = (t, a, b) => as(db, null, ({ one: o }) => o('select public.stay_quote($1, $2, $3) q', [t, a, b])).then((x) => x.q)
    expect(await q('pg')).toMatchObject({ daily: false, rent: 7000, deposit: 7000, amount: 14000 })
    expect(await q('pg_daily', '2026-12-01', '2026-12-04')).toMatchObject({ daily: true, nights: 3, rent: 2400, deposit: 1000, amount: 3400 })
    // 40 nights: one month's rent + 10 nights, but the 10 nights never cost more than a month
    expect(await q('pg_daily', '2026-12-01', '2027-01-10')).toMatchObject({ nights: 40, rent: 7000 + 7000 })
    expect(await q('flat_daily', '2026-12-01', '2026-12-03')).toMatchObject({ rent: 5000, amount: 7000 })
    await expect(q('pg_daily', '2026-12-04', '2026-12-04')).rejects.toThrow(/check-out date after/)
  })
  it('works out the first due date', async () => {
    const f = (a, d) => one('select public.registration_first_due($1, $2)::text d', [a, d]).then((x) => x.d)
    expect(await f('2026-12-05', 9)).toBe('2027-01-05') // joined on the 1st-10th: joining day is the due day
    expect(await f('2026-12-20', 5)).toBe('2027-01-05')
  })
})

describe('rooms a guest can pick', () => {
  it('lists PG rooms with free beds and only completely free flats', async () => {
    const rooms = (t) => as(db, null, ({ one: o }) => o("select public.registration_rooms('P1', $1) r", [t])).then((x) => x.r)
    const pg = await rooms('pg')
    expect(pg.map((r) => r.room_no)).toContain(room)
    expect(pg.map((r) => r.room_no)).not.toContain(flat)
    expect((await rooms('flat_daily')).map((r) => r.room_no)).toEqual([flat])
    await db.query("insert into public.register_guests (property_id, room_no, name) values ('P1', $1, 'Someone')", [flat])
    expect(await rooms('flat')).toEqual([])
    await db.query("delete from public.register_guests where room_no = $1", [flat])
  })
})

describe('submit', () => {
  it('needs a stay type, a free room, a move-in date that is not past and a due day of 1-10', async () => {
    await expect(submit(guest, { stay_type: '' })).rejects.toThrow(/Choose PG, flat/)
    await expect(submit(guest, { room_no: 'Z-999' })).rejects.toThrow(/no longer free/)
    await expect(submit(guest, { room_no: flat })).rejects.toThrow(/no longer free/)
    await expect(submit(guest, { move_in_date: day(-3) })).rejects.toThrow(/past/)
    await expect(submit(guest, { move_in_date: '2099-01-20', due_day: 12 })).rejects.toThrow(/due day from 1 to 10/)
    await expect(submit(guest, { stay_type: 'pg_daily', checkout_date: '' })).rejects.toThrow(/check-out date after/)
  })
  it('saves the choice, waits for payment and alerts the wing manager', async () => {
    await submit(guest, { move_in_date: '2099-01-20', due_day: 4 })
    expect(await reg()).toMatchObject({ state: 'pending', stay_type: 'pg', room_no: room, due_day: 4, first_due: '2099-02-04',
      payment_mode: 'online', payment_status: 'waiting', amount_due: 14000, amount_paid: 0 })
    const n = await one("select body from public.notifications where kind = 'registration' and user_id = $1 and channel = 'in_app'", [manager])
    expect(n.body).toMatch(/waiting for payment/)
  })
  it('uses the joining day as due day when joining on the 1st-10th', async () => {
    await submit(guest, { move_in_date: '2099-01-07', due_day: 2 })
    expect(await reg()).toMatchObject({ due_day: 7, first_due: '2099-02-07' })
  })
  it('keeps a check-out date and charges nights for a daily stay', async () => {
    await submit(other, { stay_type: 'flat_daily', room_no: flat, move_in_date: '2099-01-20', checkout_date: '2099-01-22' })
    expect(await reg(other)).toMatchObject({ stay_type: 'flat_daily', checkout_date: '2099-01-22', due_day: null, amount_due: 7000 })
  })
})

describe('payment and approval', () => {
  const approve = (who, user, extra = {}) => as(db, who, ({ one: o }) => o('select public.approve_resident_registration($1, $2) id', [user, JSON.stringify({
    room_no: room, rent: 7000, deposit: 7000, due_date: '2099-02-04', check_in: '2099-01-20', room_type: 'pg', ...extra })])).then((x) => x.id)
  const payOnline = async (who, outcome = 'success') => {
    const order = await as(db, who, ({ one: o }) => o('select public.start_my_registration_payment() r')).then((x) => x.r)
    return as(db, who, ({ one: o }) => o('select public.demo_complete_my_registration_payment($1, $2) r', [order.id, outcome])).then((x) => x.r)
  }
  const guestRow = (user) => one('select * from public.register_guests where customer_id = $1 and checked_out_on is null', [user])

  it('will not approve an online registration before it is paid', async () => {
    await submit(guest, { move_in_date: '2099-01-20', due_day: 4 })
    await expect(approve(manager, guest)).rejects.toThrow(/Waiting for the online payment/)
  })
  it('takes the online payment, marks it paid, tells the managers, then approves', async () => {
    expect(await payOnline(guest, 'failure')).toMatchObject({ status: 'failed' })
    expect(await reg()).toMatchObject({ payment_status: 'waiting', amount_paid: 0 })
    expect(await payOnline(guest)).toMatchObject({ status: 'succeeded', amount: 14000, is_simulated: true })
    expect(await reg()).toMatchObject({ payment_status: 'paid', amount_paid: 14000 })
    await expect(payOnline(guest)).rejects.toThrow(/Nothing left to pay/)
    const paid = await one("select body from public.notifications where kind = 'registration' and subject = 'Registration paid' and user_id = $1", [manager])
    expect(paid.body).toMatch(/paid ₹14000 online/)
    await approve(manager, guest)
    expect(await reg()).toMatchObject({ state: 'active', payment_status: 'paid' })
    expect(await guestRow(guest)).toMatchObject({ stay_type: 'pg', rent_status: 'paid', deposit_status: 'paid', carry_forward: 0 })
  })
  it('registering again while the stay is active changes nothing', async () => {
    const before = { reg: await reg(), row: await guestRow(guest),
      rows: (await one('select count(*)::int n from public.register_guests')).n,
      notes: (await one("select count(*)::int n from public.notifications where kind = 'registration'")).n,
      pays: (await one('select count(*)::int n from public.registration_payments')).n }
    const free = (await as(db, null, ({ one: o }) => o("select public.registration_rooms('P1', 'pg') r")).then((x) => x.r))[0].room_no
    await expect(submit(guest, { room_no: free, move_in_date: '2099-03-01' })).rejects.toThrow(/Your stay is active/)
    await expect(payOnline(guest)).rejects.toThrow(/Send your registration form first|Nothing left to pay/)
    await expect(as(db, guest, ({ q }) => q("select public.apply_registration_coupon('ANY')"))).rejects.toThrow()
    await expect(approve(manager, guest)).rejects.toThrow(/no longer pending/)
    expect(await reg()).toEqual(before.reg)
    expect(await guestRow(guest)).toEqual(before.row)
    expect((await one('select count(*)::int n from public.register_guests')).n).toBe(before.rows)
    expect((await one("select count(*)::int n from public.notifications where kind = 'registration'")).n).toBe(before.notes)
    expect((await one('select count(*)::int n from public.registration_payments')).n).toBe(before.pays)
  })
  it('lets the manager switch to offline and approve with a part payment; the rest goes into the first rent', async () => {
    await expect(payOnline(other, 'success').then(() => null)).resolves.toBeNull() // other has a daily flat registration
    // a fresh guest who has not paid
    const late = await makeUser(db, 'customer', 'Ravi')
    const free = (await as(db, null, ({ one: o }) => o("select public.registration_rooms('P1', 'pg') r")).then((x) => x.r))[0].room_no
    await submit(late, { room_no: free, move_in_date: '2099-01-20', due_day: 4 })
    await expect(approve(manager, late, { room_no: free, payment_mode: 'offline', payment_status: 'partially_paid', amount_paid: 0 }))
      .rejects.toThrow(/Enter the amount received/)
    await approve(manager, late, { room_no: free, payment_mode: 'offline', payment_status: 'partially_paid', amount_paid: 10000 })
    expect(await reg(late)).toMatchObject({ state: 'active', payment_mode: 'offline', payment_status: 'partially_paid', amount_paid: 10000 })
    expect(await guestRow(late)).toMatchObject({ rent_status: 'partially_paid', carry_forward: 4000 })
    const s = await as(db, late, ({ one: o }) => o('select public.my_stay() s')).then((x) => x.s)
    expect(s.carry_forward).toBe(4000)
    const told = await one("select body from public.notifications where subject = 'Registration approved' and user_id = $1", [late])
    expect(told.body).toMatch(/₹4000 still to pay/)
  })
  it('approves offline with nothing paid yet (pending)', async () => {
    const pend = await makeUser(db, 'customer', 'Sita')
    const free = (await as(db, null, ({ one: o }) => o("select public.registration_rooms('P1', 'pg') r")).then((x) => x.r))[0].room_no
    await submit(pend, { room_no: free, move_in_date: '2099-01-20', due_day: 4 })
    await approve(manager, pend, { room_no: free, payment_mode: 'offline', payment_status: 'pending', amount_paid: 500 })
    expect(await guestRow(pend)).toMatchObject({ rent_status: 'pending', carry_forward: 14000 })
  })
  it('shows the payment state on the owner registrations view', async () => {
    const owner = await makeUser(db, 'admin', 'Owner')
    const r = await as(db, owner, ({ one: o }) => o('select public.admin_registrations() r')).then((x) => x.r)
    expect(r.rows.find((x) => x.id === other)).toMatchObject({ stage: 'waiting', payment: 'paid', stay_type: 'flat_daily', room_no: flat })
  })
})

describe('first due date', () => {
  const bill = (rent, a, d) => one('select public.first_bill_for($1, $2, $3) b', [rent, a, d]).then((x) => x.b)
  it('bills only the extra days from the end of the paid month to the next due date', async () => {
    // joined 20 Dec, due day 5: the month paid covers 20 Dec - 19 Jan; 5 Jan bills 20 Jan - 4 Feb (16 days)
    expect(await bill(7500, '2026-12-20', '2027-01-05')).toEqual({ days: 16, amount: 4000 })
    // joined on the 1st-10th: the due date is a month after joining, no extra days
    expect(await bill(7000, '2026-12-05', '2027-01-05')).toBeNull()
  })
  it('stores the first bill on approval of a monthly stay', async () => {
    // the part-paid guest from above: joined 20 Jan 2099, due 4 Feb -> 20 Feb - 3 Mar = 12 days of 7000
    const g = await one("select first_bill, first_bill_days, carry_forward from public.register_guests where customer_id is not null and carry_forward = 4000")
    expect(g).toEqual({ first_bill: 2800, first_bill_days: 12, carry_forward: 4000 })
  })
  it('shows the extra days and what is carried on the first due date, then the usual rent', async () => {
    const u = await makeUser(db, 'customer', 'Kiran')
    const free = (await as(db, null, ({ one: o }) => o("select public.registration_rooms('P1', 'pg') r")).then((x) => x.r))[0].room_no
    await submit(u, { room_no: free, move_in_date: day(), due_day: 4 })
    const today = day()
    const d = Number(today.slice(8, 10))
    const [y, m] = today.split('-').map(Number)
    const due = new Date(Date.UTC(y, m, 4)).toISOString().slice(0, 10) // the 4th of next month
    await as(db, manager, ({ q }) => q('select public.approve_resident_registration($1, $2)', [u, JSON.stringify({
      room_no: free, rent: 6000, deposit: 6000, due_date: due, check_in: today, payment_mode: 'offline', payment_status: 'paid' })]))
    const s = await as(db, u, ({ one: o }) => o('select public.my_stay() s')).then((x) => x.s)
    const next = s.months[1]
    if (d > 4) { // check-in after the 4th: next month's due date falls inside the paid month
      expect(next.extra_days).toBeGreaterThan(0)
      expect(next.rent).toBe(Math.round(6000 * next.extra_days / 30))
    } else {
      expect(next.rent).toBe(6000)
    }
  })
})

describe('payment shown for the current registration only', () => {
  it('ignores a payment made before this registration was sent', async () => {
    const back = await makeUser(db, 'customer', 'Kiran')
    await db.query(`insert into public.registration_payments (email, phone, property_id, amount, provider, is_simulated, customer_id, claimed_at, status, created_at)
      values ('k@x.test', '', 'P1', 1000, 'demo', true, $1, now() - interval '1 day', 'succeeded', now() - interval '1 day')`, [back])
    const free = (await one("select public.registration_rooms('P1', 'pg') -> 0 ->> 'room_no' k")).k
    await submit(back, { full_name: 'Kiran', room_no: free })
    const r = await reg(back)
    expect(r.payment).toBeNull()
    expect(r).toMatchObject({ amount_paid: 0, to_pay: 14000 })
  })
})

describe('owner registrations list on a returning guest', () => {
  it('shows the room chosen for the waiting registration, not the old stay', async () => {
    const back = await makeUser(db, 'customer', 'Ravi')
    await db.query(`insert into public.register_guests (property_id, room_no, name, customer_id, stay_type, rent, check_in, checked_out_on)
      values ('P1', 'A-999', 'Ravi', $1, 'pg', 7000, '2026-01-01', '2026-02-01')`, [back])
    const free = (await one("select public.registration_rooms('P1', 'pg') -> 0 ->> 'room_no' k")).k
    await submit(back, { full_name: 'Ravi', room_no: free })
    const owner = await makeUser(db, 'admin', 'Owner2')
    const r = await as(db, owner, ({ one: o }) => o('select public.admin_registrations() r')).then((x) => x.r)
    expect(r.rows.find((x) => x.id === back)).toMatchObject({ stage: 'waiting', room_no: free, check_in: null })
  })
})

describe('paying online once', () => {
  it('reuses the open payment on a second click and never takes more than is owed', async () => {
    const payer = await makeUser(db, 'customer', 'Meera')
    const free = (await one("select public.registration_rooms('P1', 'pg') -> 0 ->> 'room_no' k")).k
    await submit(payer, { full_name: 'Meera', room_no: free })
    const start = () => as(db, payer, ({ one: o }) => o('select public.start_my_registration_payment() r')).then((x) => x.r)
    const done = (id) => as(db, payer, ({ one: o }) => o("select public.demo_complete_my_registration_payment($1, 'success') r", [id])).then((x) => x.r)
    const a = await start()
    const b = await start() // second click before the first finished
    expect(b.id).toBe(a.id)
    expect((await done(a.id)).status).toBe('succeeded')
    expect((await done(b.id)).status).toBe('succeeded') // same payment, not added again
    expect(await reg(payer)).toMatchObject({ amount_paid: 14000, payment_status: 'paid', to_pay: 0 })
    expect((await one('select count(*)::int n from public.registration_payments where customer_id = $1', [payer])).n).toBe(1)
    await expect(start()).rejects.toThrow(/Nothing left to pay/)
  })
  it('fails an old open order once the registration is paid another way', async () => {
    const payer = await makeUser(db, 'customer', 'Tara')
    const free = (await one("select public.registration_rooms('P1', 'pg') -> 0 ->> 'room_no' k")).k
    await submit(payer, { full_name: 'Tara', room_no: free })
    await db.query(`insert into public.registration_payments (email, property_id, amount, provider, customer_id, claimed_at)
      values ('t@x.test', 'P1', 14000, 'demo', $1, now())`, [payer])
    const old = (await one('select id from public.registration_payments where customer_id = $1', [payer])).id
    await db.query('update public.tenant_profiles set amount_paid = 14000, payment_status = $2 where user_id = $1', [payer, 'paid'])
    const r = await as(db, payer, ({ one: o }) => o("select public.demo_complete_my_registration_payment($1, 'success') r", [old])).then((x) => x.r)
    expect(r.status).toBe('failed')
    expect(await reg(payer)).toMatchObject({ amount_paid: 14000 })
  })
})
