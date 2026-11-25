// @vitest-environment node
// Owner-only registration pipeline and recent-activity feed against real Postgres (PGlite).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, freshDb, makeUser } from './pg'

let db, owner, manager, other, guest, starter, room
const regs = (p = null) => as(db, owner, ({ one }) => one('select public.admin_registrations($1) r', [p])).then((x) => x.r)
const feed = (p = null) => as(db, owner, ({ one }) => one('select public.admin_recent_activity($1) r', [p])).then((x) => x.r)
const row = (r, id) => r.rows.find((x) => x.id === id)

beforeAll(async () => {
  db = await freshDb()
  await db.query("update public.app_settings set value = '0' where key = 'registration_fee'") // payment covered in stay.test.js
  owner = await makeUser(db, 'admin', 'Owner')
  manager = await makeUser(db, 'manager', 'Priya')
  other = await makeUser(db, 'manager', 'Rahul')
  guest = await makeUser(db, 'customer', 'Amit')
  starter = await makeUser(db, 'customer', 'Neha')
  await db.query("insert into public.property_members(property_id, user_id) values ('P1', $1), ('P2', $2)", [manager, other])
  room = (await db.query("select wing || '-' || room_no k from public.rooms where property_id = 'P1' and is_active limit 1")).rows[0].k
  await as(db, guest, ({ q }) => q('select public.submit_resident_registration($1)', [JSON.stringify({
    property_id: 'P1', full_name: 'Amit', phone: '9800000000', emergency1_name: 'Parent', emergency1_phone: '9800000001', rules_accepted: true,
  })]))
}, 120000)
afterAll(async () => { await db?.close() })

describe('admin_registrations', () => {
  it('is for the owner only', async () => {
    await expect(as(db, manager, ({ q }) => q('select public.admin_registrations()'))).rejects.toThrow(/owner/)
    await expect(as(db, guest, ({ q }) => q('select public.admin_recent_activity()'))).rejects.toThrow(/owner/)
  })

  it('shows a waiting registration with the wing manager who was alerted, and a started one', async () => {
    const r = await regs()
    expect(r.counts).toMatchObject({ waiting: 1, started: 1, living: 0 })
    expect(row(r, guest)).toMatchObject({ stage: 'waiting', property_id: 'P1', handlers: [{ name: 'Priya', seen: false }] })
    expect(row(r, starter)).toMatchObject({ stage: 'started', submitted_at: null, handlers: [] })
    // P2 filter keeps people who have not picked a wing, drops the P1 registration
    const p2 = await regs('P2')
    expect(row(p2, guest)).toBeUndefined()
    expect(row(p2, starter)).toBeDefined()
  })

  it('marks the handler as seen once they open their alerts', async () => {
    await as(db, manager, ({ q }) => q('select public.mark_notifications_read()'))
    expect(row(await regs(), guest).handlers).toEqual([{ name: 'Priya', seen: true }])
  })

  it('moves to living with the room and approver, and logs the approval', async () => {
    await as(db, manager, ({ q }) => q('select public.approve_resident_registration($1, $2)', [guest, JSON.stringify({
      room_no: room, rent: 6000, deposit: 6000, due_date: '2026-12-03', check_in: '2026-11-25',
    })]))
    const r = row(await regs(), guest)
    expect(r).toMatchObject({ stage: 'living', room_no: room, approved_by: 'Priya' })
    const log = (await db.query("select actor_id, details from public.activity_log where action = 'tenant.approval' and entity_id = $1", [guest])).rows
    expect(log).toEqual([{ actor_id: manager, details: { status: 'approved', room_no: room, property_id: 'P1' } }])
  })
})

describe('admin_recent_activity', () => {
  it('groups events by area and flags what still needs action', async () => {
    await db.query("insert into public.enquiries (property_id, name, phone) values ('P2', 'Lead One', '9811111111')")
    const f = await feed()
    expect(f.registrations.items.map((i) => i.kind)).toEqual(expect.arrayContaining(['submitted', 'approved']))
    expect(f.registrations.items.find((i) => i.kind === 'approved')).toMatchObject({ ref: guest, who: 'Priya', detail: room })
    expect(f.guests.items[0]).toMatchObject({ kind: 'insert', name: 'Amit', detail: room })
    expect(f.enquiries).toMatchObject({ count: 1, open: 1, items: [expect.objectContaining({ name: 'Lead One', open: true })] })
  })

  it('lists rent marked paid with its amount under money', async () => {
    await as(db, manager, ({ q }) => q("update public.register_guests set rent_status = 'paid' where customer_id = $1", [guest]))
    const f = await feed()
    expect(f.money.items[0]).toMatchObject({ kind: 'rent_paid', name: 'Amit', detail: `Room ${room}`, amount: 6000, property_id: 'P1' })
  })

  it('filters by wing', async () => {
    const f = await feed('P1')
    expect(f.enquiries).toBeUndefined()
    expect(f.registrations.count).toBeGreaterThan(0)
  })
})
