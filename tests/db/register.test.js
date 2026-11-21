// @vitest-environment node
// Guest register (supabase/migrations/20261121152007_guest_register.sql) against real Postgres (PGlite).
import { beforeAll, describe, expect, it } from 'vitest'
import { as, freshDb, makeUser } from './pg'

let db, owner, manager, otherManager, caretaker
const live = (who, sql = 'select id, room_no, name from public.register_guests where checked_out_on is null order by sort_order') =>
  as(db, who, ({ q }) => q(sql))
const apply = (who, ops, imp = false) => as(db, who, ({ one }) => one('select public.register_apply($1, $2, $3) n', ['P1', JSON.stringify(ops), imp]))

beforeAll(async () => {
  db = await freshDb()
  owner = await makeUser(db, 'admin', 'Owner')
  manager = await makeUser(db, 'manager', 'Manager')
  otherManager = await makeUser(db, 'manager', 'Other')
  caretaker = await makeUser(db, 'employee', 'Caretaker')
  await db.query("insert into public.properties (id, name) values ('P2', 'Second PG') on conflict do nothing")
  await as(db, owner, async ({ q }) => {
    await q("select public.admin_assign_member('P1', $1, true)", [manager])
    await q("select public.admin_assign_member('P1', $1, true)", [caretaker])
    await q("select public.admin_assign_member('P2', $1, true)", [otherManager])
  })
}, 120000)

describe('guest register', () => {
  it('lets a manager add and edit guests, and records every change with who made it', async () => {
    const n = await apply(manager, [
      { op: 'add', set: { room_no: '101', name: 'Rahul Sinha', contact: '9876543210', rent: 5500, rent_status: 'paid', check_in: '2026-10-01' } },
      { op: 'add', set: { room_no: '101', name: 'Amit Rao', contact: '9876500000', rent: 5500 } },
      { op: 'add', set: { room_no: '102', name: 'Neha Joshi', rent: 12000 } },
    ])
    expect(n.n).toBe(3)
    const rows = await live(manager)
    expect(rows.map((r) => r.name)).toEqual(['Rahul Sinha', 'Amit Rao', 'Neha Joshi'])
    const rahul = rows[0].id
    await apply(manager, [{ op: 'update', id: rahul, set: { rent_status: 'pending', notes: 'Nov rent due', property_id: 'P2' } }])
    const r = (await as(db, manager, ({ q }) => q('select property_id, rent_status, notes from public.register_guests where id = $1', [rahul])))[0]
    expect(r).toEqual({ property_id: 'P1', rent_status: 'pending', notes: 'Nov rent due' })
    const h = await as(db, manager, ({ q }) => q('select op, changed_by_name from public.register_history where guest_id = $1 order by id', [rahul]))
    expect(h).toEqual([{ op: 'INSERT', changed_by_name: 'Manager' }, { op: 'UPDATE', changed_by_name: 'Manager' }])
  })

  it('places a guest added "after" someone next to them in the same room', async () => {
    const [rahul] = await live(manager)
    await apply(manager, [{ op: 'add', after: rahul.id, set: { room_no: '101', name: 'Third Bed' } }])
    expect((await live(manager)).map((r) => r.name)).toEqual(['Rahul Sinha', 'Third Bed', 'Amit Rao', 'Neha Joshi'])
  })

  it('rejects bad data and rolls back the whole batch', async () => {
    await expect(apply(manager, [
      { op: 'add', set: { room_no: '103', name: 'Good Row' } },
      { op: 'add', set: { room_no: '103', name: 'Bad Phone', contact: '123' } },
    ])).rejects.toThrow(/contact/)
    await expect(apply(manager, [{ op: 'add', set: { name: 'No room' } }])).rejects.toThrow(/room is required/)
    expect((await live(manager)).some((r) => r.name === 'Good Row')).toBe(false)
  })

  it('checks a guest out to Past guests with the date, and can undo it', async () => {
    const amit = (await live(manager)).find((r) => r.name === 'Amit Rao')
    await as(db, manager, ({ q }) => q('select public.register_checkout($1, $2, $3)', [amit.id, '2026-11-20', 'Deposit returned']))
    expect((await live(manager)).some((r) => r.id === amit.id)).toBe(false)
    const past = await as(db, manager, ({ q }) => q('select name, checked_out_on::text d, checkout_note from public.register_guests where checked_out_on is not null'))
    expect(past).toEqual([{ name: 'Amit Rao', d: '2026-11-20', checkout_note: 'Deposit returned' }])
    await expect(as(db, manager, ({ q }) => q('select public.register_checkout($1)', [amit.id]))).rejects.toThrow(/Already checked out/)
    const ops = await as(db, manager, ({ q }) => q('select op from public.register_history where guest_id = $1 order by id', [amit.id]))
    expect(ops.at(-1).op).toBe('CHECKOUT')
    await as(db, manager, ({ q }) => q('select public.register_return($1)', [amit.id]))
    expect((await live(manager)).some((r) => r.id === amit.id)).toBe(true)
  })

  it('will not check someone out before they checked in', async () => {
    const rahul = (await live(manager)).find((r) => r.name === 'Rahul Sinha')
    await expect(as(db, manager, ({ q }) => q('select public.register_checkout($1, $2)', [rahul.id, '2026-09-01'])))
      .rejects.toThrow(/before the check-in date/)
  })

  it('restores a change from history, including a deleted row with its old id', async () => {
    const neha = (await live(manager)).find((r) => r.name === 'Neha Joshi')
    await as(db, manager, ({ q }) => q("update public.register_guests set rent = 13000 where id = $1", [neha.id]))
    const upd = await as(db, manager, ({ one }) => one("select id from public.register_history where guest_id = $1 and op = 'UPDATE' order by id desc limit 1", [neha.id]))
    await as(db, manager, ({ q }) => q('select public.register_restore($1)', [upd.id]))
    expect((await db.query('select rent from public.register_guests where id = $1', [neha.id])).rows[0].rent).toBe(12000)
    await as(db, manager, ({ q }) => q('delete from public.register_guests where id = $1', [neha.id]))
    const del = await as(db, manager, ({ one }) => one("select id from public.register_history where guest_id = $1 and op = 'DELETE'", [neha.id]))
    await as(db, manager, ({ q }) => q('select public.register_restore($1)', [del.id]))
    expect((await db.query('select name from public.register_guests where id = $1', [neha.id])).rows[0].name).toBe('Neha Joshi')
  })

  it('imports past guests only when asked to', async () => {
    await apply(manager, [{ op: 'add', set: { room_no: '201', name: 'Old Guest', checked_out_on: '2026-08-01' } }], true)
    await apply(manager, [{ op: 'add', set: { room_no: '201', name: 'Sneaky', checked_out_on: '2026-08-01' } }])
    const r = (await db.query("select name, checked_out_on::text d from public.register_guests where room_no = '201' order by id")).rows
    expect(r).toEqual([{ name: 'Old Guest', d: '2026-08-01' }, { name: 'Sneaky', d: null }])
  })

  it('keeps other properties and staff without access out', async () => {
    expect(await live(otherManager)).toEqual([])
    await expect(apply(otherManager, [{ op: 'add', set: { room_no: '101', name: 'X' } }])).rejects.toThrow(/do not manage/)
    // caretaker: read-only, and only while "view customers" is on (no permissions row = off)
    expect(await live(caretaker)).toEqual([])
    await db.query('insert into public.employee_permissions (employee_id, can_view_customers) values ($1, true)', [caretaker])
    expect((await live(caretaker)).length).toBeGreaterThan(0)
    await expect(apply(caretaker, [{ op: 'add', set: { room_no: '101', name: 'X' } }])).rejects.toThrow(/do not manage/)
    const changed = await as(db, caretaker, ({ q }) => q("update public.register_guests set notes = 'x' returning id"))
    expect(changed).toEqual([])
    expect(await as(db, caretaker, ({ q }) => q('select id from public.register_history'))).toEqual([])
    await db.query('update public.employee_permissions set can_view_customers = false where employee_id = $1', [caretaker])
    expect(await live(caretaker)).toEqual([])
  })
})
