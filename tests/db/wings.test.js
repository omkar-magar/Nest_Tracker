// @vitest-environment node
// A wing / B wing as two properties (supabase/migrations/20261121160000_split_wings.sql) against PGlite.
import { beforeAll, describe, expect, it } from 'vitest'
import { as, freshDb, makeUser } from './pg'

let db, owner, managerA, managerB

beforeAll(async () => {
  db = await freshDb()
  owner = await makeUser(db, 'admin', 'Owner')
  managerA = await makeUser(db, 'manager', 'Manager A')
  managerB = await makeUser(db, 'manager', 'Manager B')
  await as(db, owner, async ({ q }) => {
    for (const m of [managerA, managerB]) for (const p of ['P1', 'P2']) await q('select public.admin_assign_member($1, $2, true)', [p, m])
  })
}, 120000)

describe('wings as properties', () => {
  it('puts A wing rooms in P1 and B wing rooms in P2', async () => {
    const props = (await db.query('select id, wing, name from public.properties order by id')).rows
    expect(props).toEqual([{ id: 'P1', wing: 'A', name: 'YOLO Nest A wing' }, { id: 'P2', wing: 'B', name: 'YOLO Nest B wing' }])
    const rooms = (await db.query("select property_id, wing, count(*)::int n from public.rooms group by 1, 2 order by 1")).rows
    expect(rooms).toEqual([{ property_id: 'P1', wing: 'A', n: 3 }, { property_id: 'P2', wing: 'B', n: 3 }])
    const code = (await db.query("select b.code from public.beds b where b.room_id = 'flat-301' limit 1")).rows[0].code
    expect(code).toMatch(/^P2-B-F3-R301-B\d+$/)
  })

  it('gives a room the wing of its property', async () => {
    await as(db, owner, ({ q }) => q("update public.rooms set wing = 'A' where id = 'lodge-401'"))
    expect((await db.query("select wing from public.rooms where id = 'lodge-401'")).rows[0].wing).toBe('B')
  })

  it('lets both managers see both wings', async () => {
    for (const m of [managerA, managerB]) {
      const ids = await as(db, m, ({ q }) => q('select public.my_property_ids() id order by 1'))
      expect(ids.map((r) => r.id)).toEqual(['P1', 'P2'])
    }
  })

  it('lets the owner set the wing a login opens on, one per login', async () => {
    await as(db, owner, async ({ q }) => {
      await q("select public.admin_set_default_property($1, 'P1')", [managerA])
      await q("select public.admin_set_default_property($1, 'P2')", [managerB])
      await q("select public.admin_set_default_property($1, 'P2')", [managerA])
    })
    const rows = await as(db, managerA, ({ q }) => q('select property_id from public.property_members where user_id = $1 and is_default', [managerA]))
    expect(rows).toEqual([{ property_id: 'P2' }])
    await expect(as(db, managerA, ({ q }) => q("select public.admin_set_default_property($1, 'P1')", [managerA]))).rejects.toThrow(/Owner only/)
  })

  it('refuses a default wing that is not assigned', async () => {
    const other = await makeUser(db, 'manager', 'Unassigned')
    await expect(as(db, owner, ({ q }) => q("select public.admin_set_default_property($1, 'P1')", [other]))).rejects.toThrow(/Assign the property/)
  })
})
