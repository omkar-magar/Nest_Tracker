// @vitest-environment node
// Automatic check-out of daily stays, guest extension requests and manager extensions (PGlite).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, asService, freshDb, makeUser } from './pg'

let db, guest, monthly, manager, outsider, gid, mid
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const shift = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const state = (who) => as(db, who, ({ one: o }) => o('select public.my_registration() r')).then((x) => x.r.state)
const addGuest = async (customer, stay, until) => {
  await db.query("insert into public.tenant_profiles (user_id, property_id, registration_state, approval_status) values ($1, 'P1', 'active', 'approved')", [customer])
  return (await one(`insert into public.register_guests (property_id, room_no, name, customer_id, stay_type, rent, check_in, expected_checkout, rent_status)
    values ('P1', 'A-101', 'G', $1, $2, 2400, $3, $4, 'paid') returning id`, [customer, stay, shift(-3), until])).id
}

beforeAll(async () => {
  db = await freshDb()
  guest = await makeUser(db, 'customer', 'Asha')
  monthly = await makeUser(db, 'customer', 'Ravi')
  manager = await makeUser(db, 'manager', 'Priya')
  outsider = await makeUser(db, 'manager', 'Rahul')
  await db.query("insert into public.property_members(property_id, user_id) values ('P1', $1), ('P2', $2)", [manager, outsider])
  gid = await addGuest(guest, 'pg_daily', shift(2))
  mid = await addGuest(monthly, 'pg', shift(0))
}, 120000)
afterAll(async () => { await db?.close() })

describe('guest asks to extend a daily stay', () => {
  it('only for daily stays, after the current check-out date, one at a time', async () => {
    await expect(as(db, monthly, ({ q }) => q('select public.request_extension($1)', [shift(10)]))).rejects.toThrow(/daily stays/)
    await expect(as(db, guest, ({ q }) => q('select public.request_extension($1)', [shift(1)]))).rejects.toThrow(/after your current check-out/)
    await as(db, guest, ({ q }) => q("select public.request_extension($1, 'Project extended')", [shift(5)]))
    await expect(as(db, guest, ({ q }) => q('select public.request_extension($1)', [shift(6)]))).rejects.toThrow(/already asked/)
    const n = await one("select body from public.notifications where subject = 'Extension request' and user_id = $1", [manager])
    expect(n.body).toMatch(/asks to stay until/)
    expect(await as(db, guest, ({ one: o }) => o('select public.my_extension() x')).then((x) => x.x)).toMatchObject({ status: 'requested', note: 'Project extended' })
  })
  it('shows requests to the wing manager only', async () => {
    expect(await as(db, outsider, ({ one: o }) => o('select public.extension_requests() r')).then((x) => x.r)).toEqual([])
    const list = await as(db, manager, ({ one: o }) => o("select public.extension_requests('P1') r")).then((x) => x.r)
    expect(list[0]).toMatchObject({ guest_id: gid, open: true, guest: 'G', rent: 2400 })
  })
  it('lets the manager approve it for the dates they choose, with a charge and its status', async () => {
    const req = await one('select id from public.stay_extensions where guest_id = $1', [gid])
    await expect(as(db, outsider, ({ q }) => q('select public.extend_stay($1, $2, 1600, $3, $4, $5)', [gid, shift(4), 'pending', '', req.id])))
      .rejects.toThrow(/manage this property/)
    await as(db, manager, ({ q }) => q("select public.extend_stay($1, $2, 1600, 'pending', '', $3)", [gid, shift(4), req.id]))
    expect(await one('select expected_checkout::text d, rent, rent_status from public.register_guests where id = $1', [gid]))
      .toEqual({ d: shift(4), rent: 4000, rent_status: 'pending' })
    expect(await one('select status, approved_until::text a, charge from public.stay_extensions where id = $1', [req.id]))
      .toEqual({ status: 'approved', a: shift(4), charge: 1600 })
  })
})

describe('automatic check-out', () => {
  it('checks out daily stays at 12 AM on the check-out date, not monthly stays', async () => {
    await db.query('update public.register_guests set expected_checkout = $1 where id = $2', [shift(0), gid])
    const n = await asService(db, ({ one: o }) => o('select public.register_auto_checkout() n')).then((x) => x.n)
    expect(n).toBe(1)
    expect(await one('select checked_out_on::text d, checkout_note from public.register_guests where id = $1', [gid]))
      .toEqual({ d: shift(0), checkout_note: 'Automatic check-out' })
    expect(await one('select checked_out_on from public.register_guests where id = $1', [mid])).toEqual({ checked_out_on: null })
    expect(await state(guest)).toBe('ended')
    const told = await one("select subject from public.notifications where user_id = $1 and subject = 'Thank you for staying with us'", [guest])
    expect(told).toBeTruthy()
  })
  it('runs with the scheduled jobs', async () => {
    const r = await asService(db, ({ one: o }) => o('select public.run_scheduled_jobs(true) r')).then((x) => x.r)
    expect(r.auto_checkouts).toBe(0)
  })
  it('lets the manager extend after check-out, bringing the guest back', async () => {
    await expect(as(db, manager, ({ q }) => q('select public.extend_stay($1, $2)', [gid, shift(0)]))).rejects.toThrow(/after today/)
    await as(db, manager, ({ q }) => q("select public.extend_stay($1, $2, 800, 'paid')", [gid, shift(3)]))
    expect(await one('select checked_out_on, expected_checkout::text d from public.register_guests where id = $1', [gid])).toEqual({ checked_out_on: null, d: shift(3) })
    expect(await state(guest)).toBe('active')
  })
  it('lets the manager decline a request', async () => {
    const id = await as(db, guest, ({ one: o }) => o('select public.request_extension($1) id', [shift(9)])).then((x) => x.id)
    await as(db, manager, ({ q }) => q("select public.decline_extension($1, 'Room is booked')", [id]))
    expect(await as(db, guest, ({ one: o }) => o('select public.my_extension() x')).then((x) => x.x)).toMatchObject({ status: 'declined', answer: 'Room is booked' })
  })
})
