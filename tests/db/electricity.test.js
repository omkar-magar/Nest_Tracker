// @vitest-environment node
// Electricity consumer IDs: seeded for A wing, hidden from visitors and residents' direct reads, readable by
// the wing's staff, editable by owner / managers, and each resident gets only their own flat's ID.
import { beforeAll, describe, expect, it } from 'vitest'
import { as, freshDb, makeUser } from './pg'

let db, owner, mgr, booked, registered, nobody
const emergency = { emergency1_name: 'Asha', emergency1_relation: 'Mother', emergency1_phone: '9811111111', rules_accepted: true }
const mine = async (u) => (await as(db, u, ({ one }) => one('select public.my_electricity_connection() e'))).e

beforeAll(async () => {
  db = await freshDb()
  owner = await makeUser(db, 'admin', 'Owner')
  mgr = await makeUser(db, 'manager', 'Anil')
  booked = await makeUser(db, 'customer', 'Ravi')
  registered = await makeUser(db, 'customer', 'Sita')
  nobody = await makeUser(db, 'customer', 'Nobody')
  await as(db, owner, ({ q }) => q("select public.admin_assign_member('P1', $1, true)", [mgr]))
  await as(db, booked, ({ q }) => q('select public.save_my_tenant_profile($1)', [emergency]))
  const bed = (await db.query("select id from public.beds where room_id = 'pg-101' order by label limit 1")).rows[0]
  await as(db, mgr, ({ q }) => q('select public.check_in_tenant($1)', [{ customer_id: booked, bed_ids: [bed.id], deposit: 0 }]))
  await db.query("insert into public.register_guests (property_id, room_no, name, customer_id) values ('P1', 'A-506', 'Sita', $1)", [registered])
}, 120000)

describe('electricity consumer IDs', () => {
  it('seeds all 30 A wing flats', async () => {
    const r = (await db.query("select count(*)::int n, min(consumer_id) lo, max(consumer_id) hi from public.electricity_connections where property_id = 'P1'")).rows[0]
    expect(r).toEqual({ n: 30, lo: '170681865287', hi: '170681865571' })
  })

  it('gives each resident only their own flat, from a booking or a register stay', async () => {
    expect(await mine(booked)).toEqual({ room_label: 'A-101', consumer_id: '170681865287' })
    expect(await mine(registered)).toEqual({ room_label: 'A-506', consumer_id: '170681865571' })
    expect(await mine(nobody)).toBeNull()
  })

  it('hides the table from visitors and residents, shows it to the wing\'s staff', async () => {
    expect(await as(db, null, ({ q }) => q('select * from public.electricity_connections')).catch(() => [])).toEqual([])
    expect(await as(db, booked, ({ q }) => q('select * from public.electricity_connections'))).toEqual([])
    expect((await as(db, mgr, ({ q }) => q('select * from public.electricity_connections'))).length).toBe(30)
  })

  it('lets managers edit their wing but not residents, and checks the format', async () => {
    await as(db, mgr, ({ q }) => q("update public.electricity_connections set note = 'checked' where property_id = 'P1' and room_no = '101'"))
    expect((await db.query("select note from public.electricity_connections where room_no = '101'")).rows[0].note).toBe('checked')
    await expect(as(db, mgr, ({ q }) => q("insert into public.electricity_connections (property_id, room_no, consumer_id) values ('P1', '601', 'abc')"))).rejects.toThrow(/check/)
    await expect(as(db, mgr, ({ q }) => q("insert into public.electricity_connections (property_id, room_no, consumer_id) values ('P1', '601', '170681865287')"))).rejects.toThrow(/unique|duplicate/)
    await expect(as(db, booked, ({ q }) => q("insert into public.electricity_connections (property_id, room_no, consumer_id) values ('P1', '601', '123456789')"))).rejects.toThrow()
  })
})
