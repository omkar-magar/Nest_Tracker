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
