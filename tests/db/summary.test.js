// @vitest-environment node
// register_summary (supabase/migrations/20261123000001_register_summary.sql): the guest register's figures for the
// dashboards, against real Postgres (PGlite).
import { beforeAll, describe, expect, it } from 'vitest'
import { as, freshDb, makeUser } from './pg'

let db, owner, manager, caretaker, aRooms
const summary = (who, pid = null) => as(db, who, ({ one }) => one('select public.register_summary($1) s', [pid])).then((r) => r.s)
const add = (pid, ops) => as(db, owner, ({ q }) => q('select public.register_apply($1, $2)', [pid, JSON.stringify(ops)]))
// the function counts in India time
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

beforeAll(async () => {
  db = await freshDb()
  owner = await makeUser(db, 'admin', 'Owner')
  manager = await makeUser(db, 'manager', 'Manager')
  caretaker = await makeUser(db, 'employee', 'Caretaker')
  await as(db, owner, async ({ q }) => {
    await q("select public.admin_assign_member('P1', $1, true)", [manager])
    await q("select public.admin_assign_member('P1', $1, true)", [caretaker])
  })
  // the register names rooms "A-101" in a wing
  aRooms = (await db.query("select wing || '-' || room_no k from public.rooms where property_id = 'P1' and is_active order by room_no")).rows.map((r) => r.k)
  await add('P1', [
    { op: 'add', set: { room_no: aRooms[0], name: 'Rahul', rent: 6000, rent_status: 'paid', deposit: 6000, deposit_status: 'paid', check_in: today } },
    { op: 'add', set: { room_no: aRooms[0], name: 'Amit', rent: 6000, rent_status: 'pending', expected_checkout: inDays(3) } },
    { op: 'add', set: { room_no: aRooms[1], name: 'Neha', rent: 15000, rent_status: 'partially_paid', deposit_status: 'pending' } },
    { op: 'add', set: { room_no: aRooms[1], name: '' } },
  ])
  await add('P2', [{ op: 'add', set: { room_no: 'B-101', name: 'Sara', rent: 7000, rent_status: 'pending' } }])
}, 120000)

describe('register summary', () => {
  it('counts guests, rooms and rent per wing the way the register screen does', async () => {
    const s = await summary(owner, 'P1')
    const t = s.totals
    expect(t.guests).toBe(3)
    expect(t.rooms_total).toBe(aRooms.length)
    expect([t.rooms_occupied, t.pg_rooms, t.pg_people, t.rented_rooms]).toEqual([2, 1, 2, 1])
    expect(t.empty_rooms).toBe(aRooms.length - 2)
    expect([t.rent_roll, t.rent_paid, t.rent_pending]).toEqual([27000, 6000, 21000])
    expect([t.rent_pending_guests, t.rent_partial_guests, t.deposit_held, t.deposit_pending_guests]).toEqual([1, 1, 6000, 1])
    expect([t.checkins_month, t.leaving_week]).toEqual([1, 1])
    expect(s.leaving.map((x) => x.name)).toEqual(['Amit'])
    expect(s.rent_pending.map((x) => x.name).sort()).toEqual(['Amit', 'Neha'])
    expect(s.recent.length).toBeGreaterThan(0)
    expect(JSON.stringify(s)).not.toMatch(/contact/)
  })

  it('adds wings up for the grand total and counts check-outs this month', async () => {
    const sara = (await db.query("select id from public.register_guests where name = 'Sara'")).rows[0].id
    await as(db, owner, ({ q }) => q('select public.register_checkout($1, $2)', [sara, today]))
    const s = await summary(owner)
    expect(s.properties.map((p) => p.id)).toEqual(['P1', 'P2'])
    expect(s.properties[1]).toMatchObject({ guests: 0, checkouts_month: 1 })
    expect(s.totals.guests).toBe(3)
    expect(s.totals.checkouts_month).toBe(1)
    expect(s.recent[0]).toMatchObject({ op: 'CHECKOUT', name: 'Sara', room: 'B-101' })
  })

  it('lists rent marked paid in recent activity but not other edits', async () => {
    const amit = (await db.query("select id from public.register_guests where name = 'Amit'")).rows[0].id
    await as(db, owner, ({ q }) => q("update public.register_guests set notes = 'call after 6' where id = $1", [amit]))
    await as(db, owner, ({ q }) => q("update public.register_guests set rent_status = 'paid' where id = $1", [amit]))
    const { recent } = await summary(owner)
    expect(recent[0]).toMatchObject({ op: 'PAID', name: 'Amit', rent: 6000 })
    expect(recent.filter((r) => r.name === 'Amit').map((r) => r.op)).toEqual(['PAID', 'INSERT'])
  })

  it('shows a manager only their wings and keeps other staff out', async () => {
    const s = await summary(manager)
    expect(s.properties.map((p) => p.id)).toEqual(['P1'])
    await expect(summary(caretaker)).rejects.toThrow(/owner and managers/)
  })
})
