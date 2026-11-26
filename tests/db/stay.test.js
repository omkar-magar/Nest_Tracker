// @vitest-environment node
// Registration, the resident's stay dashboard, and extra-furniture requests (PGlite).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, freshDb, makeUser } from './pg'

let db, guest, other, manager, outsider, room
const form = (extra = {}) => JSON.stringify({
  property_id: 'P1', full_name: 'Amit', phone: '9800000000', emergency1_name: 'Parent', emergency1_phone: '9800000001', rules_accepted: true,
  stay_type: 'pg', room_no: room.k, move_in_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), due_day: 5, ...extra,
})
const submit = (who, extra) => as(db, who, ({ q }) => q('select public.submit_resident_registration($1)', [form(extra)]))
const stay = (who = guest) => as(db, who, ({ one }) => one('select public.my_stay() s')).then((x) => x.s)

beforeAll(async () => {
  db = await freshDb()
  guest = await makeUser(db, 'customer', 'Amit')
  other = await makeUser(db, 'customer', 'Neha')
  manager = await makeUser(db, 'manager', 'Priya')
  outsider = await makeUser(db, 'manager', 'Rahul')
  await db.query("insert into public.property_members(property_id, user_id) values ('P1', $1), ('P2', $2)", [manager, outsider])
  room = (await db.query("select wing || '-' || room_no k, room_no from public.rooms where property_id = 'P1' and is_active order by room_no limit 1")).rows[0]
}, 120000)
afterAll(async () => { await db?.close() })

describe('registration', () => {
  it('sends the registration without any payment before the OTP', async () => {
    await submit(guest)
    const reg = await as(db, guest, ({ one }) => one('select public.my_registration() r')).then((x) => x.r)
    expect(reg).toMatchObject({ state: 'pending', stay_type: 'pg', room_no: room.k, payment_status: 'waiting', payment_mode: 'online' })
  })
})

describe('resident stay and extra furniture', () => {
  it('has no stay until approval', async () => {
    expect(await stay()).toBeNull()
    await expect(as(db, guest, ({ q }) => q("select public.request_addon('chair', 1)"))).rejects.toThrow(/stay has started/)
  })
  it('shows room, rent for this month and next, and the room furniture after approval', async () => {
    const today = (await db.query("select public.ist_date(now()) d")).rows[0].d
    const due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 5)).toISOString().slice(0, 10)
    await db.query("insert into public.room_inventory (property_id, room_no, item, qty) values ('P1', $1, 'pillow', 3) on conflict (property_id, room_no, item) do update set qty = 3", [room.room_no])
    await as(db, manager, ({ q }) => q('select public.approve_resident_registration($1, $2)', [guest, JSON.stringify({
      room_no: room.k, rent: 6000, deposit: 6000, due_date: due, check_in: due })]))
    const s = await stay()
    expect(s).toMatchObject({ room_no: room.k, rent: 6000, deposit: 6000, inventory: expect.objectContaining({ pillow: 3 }),
      addon_prices: { chair: 100, table: 400, cupboard: 500 } })
    expect(s.months).toHaveLength(2)
    expect(s.months[0]).toMatchObject({ due_date: due, rent: 6000, total: 6000, extras: [] })
    expect(s.months[1].status).toBe('upcoming')
  })
  it('lets the resident request extras and the wing manager approve them into the next rent and the room', async () => {
    await expect(as(db, guest, ({ q }) => q("select public.request_addon('sofa', 1)"))).rejects.toThrow(/not available/)
    await expect(as(db, guest, ({ q }) => q("select public.request_addon('chair', 9)"))).rejects.toThrow(/1 to 5/)
    const chair = await as(db, guest, ({ one }) => one("select public.request_addon('chair', 2) id")).then((x) => x.id)
    const table = await as(db, guest, ({ one }) => one("select public.request_addon('table', 1) id")).then((x) => x.id)
    const cupboard = await as(db, guest, ({ one }) => one("select public.request_addon('cupboard', 1) id")).then((x) => x.id)
    expect((await db.query("select count(*)::int n from public.notifications where kind = 'addon' and user_id = $1 and channel = 'in_app'", [manager])).rows[0].n).toBe(3)

    await expect(as(db, outsider, ({ q }) => q('select public.decide_addon($1, true)', [chair]))).rejects.toThrow(/manage this property/)
    await expect(as(db, guest, ({ q }) => q('select public.decide_addon($1, true)', [chair]))).rejects.toThrow(/manage this property/)
    expect(await as(db, outsider, ({ one }) => one('select public.addon_requests() r')).then((x) => x.r)).toEqual([])
    const queue = await as(db, manager, ({ one }) => one("select public.addon_requests('P1') r")).then((x) => x.r)
    expect(queue.map((x) => x.item).sort()).toEqual(['chair', 'cupboard', 'table'])
    expect(queue.find((x) => x.item === 'chair')).toMatchObject({ amount: 200, resident: 'Amit', status: 'requested' })

    const chairsBefore = (await db.query("select coalesce(sum(qty), 0)::int n from public.room_inventory where property_id = 'P1' and room_no = $1 and item = 'chair'", [room.room_no])).rows[0].n
    await as(db, manager, ({ q }) => q('select public.decide_addon($1, true)', [chair]))
    await as(db, manager, ({ q }) => q("select public.decide_addon($1, false, 'None spare')", [table]))
    await as(db, guest, ({ q }) => q('select public.cancel_addon($1)', [cupboard]))
    await expect(as(db, manager, ({ q }) => q('select public.decide_addon($1, true)', [chair]))).rejects.toThrow(/already been answered/)
    await expect(as(db, guest, ({ q }) => q('select public.cancel_addon($1)', [chair]))).rejects.toThrow(/waiting request/)

    const chairsAfter = (await db.query("select qty from public.room_inventory where property_id = 'P1' and room_no = $1 and item = 'chair'", [room.room_no])).rows[0].qty
    expect(chairsAfter).toBe(chairsBefore + 2)
    const s = await stay()
    expect(s.addons.map((x) => [x.item, x.status])).toEqual(expect.arrayContaining([['chair', 'approved'], ['table', 'rejected'], ['cupboard', 'cancelled']]))
    const charged = s.months.find((m) => m.extras.length)
    expect(charged).toMatchObject({ total: 6200, extras: [{ item: 'chair', qty: 2, amount: 200 }] })
    expect(s.addons.find((x) => x.item === 'chair').charge_month).toBe(charged.month)
    const told = (await db.query("select subject from public.notifications where kind = 'addon' and user_id = $1 and channel = 'in_app' order by id", [guest])).rows
    expect(told.map((n) => n.subject)).toEqual(['Extra furniture approved', 'Extra furniture request declined'])
  })
  it('moves the charge to next month once this month is marked paid', async () => {
    await db.query("update public.register_guests set rent_status = 'paid' where customer_id = $1", [guest])
    const id = await as(db, guest, ({ one }) => one("select public.request_addon('cupboard', 1) id")).then((x) => x.id)
    await as(db, manager, ({ q }) => q('select public.decide_addon($1, true)', [id]))
    const s = await stay()
    expect(s.months[0].status).toBe('paid')
    expect(s.months[1].extras).toContainEqual({ item: 'cupboard', qty: 1, amount: 500 })
  })
  it('keeps one resident out of another resident\'s extras', async () => {
    expect(await as(db, other, ({ q }) => q('select id from public.resident_addons'))).toEqual([])
    expect(await stay(other)).toBeNull()
  })
})
