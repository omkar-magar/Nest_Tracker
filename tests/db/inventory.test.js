// @vitest-environment node
// Room inventory: A wing stock lists seeded, readable by the wing's staff, editable by owner / managers only;
// the A wing bed map is matched to the bed (or mattress) counts without touching beds in use.
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, freshDb, makeUser } from './pg'

let db, owner, mgr, sales, resident
const bedSync = readFileSync(new URL('../../supabase/migrations/20261126000004_a_wing_beds_from_inventory.sql', import.meta.url), 'utf8')
const labels = async (room) => (await db.query('select string_agg(label, \'\' order by label) l from public.beds where room_id = $1', [room])).rows[0].l

beforeAll(async () => {
  db = await freshDb()
  owner = await makeUser(db, 'admin', 'Owner')
  mgr = await makeUser(db, 'manager', 'Anil')
  sales = await makeUser(db, 'sales', 'Sam')
  resident = await makeUser(db, 'customer', 'Ravi')
  await as(db, owner, ({ q }) => q("select public.admin_assign_member('P1', $1, true)", [mgr]))
  await as(db, owner, ({ q }) => q("select public.admin_assign_member('P1', $1, true)", [sales]))
}, 120000)

describe('room inventory', () => {
  it('seeds the five A wing floors with the stock-list totals', async () => {
    const r = (await db.query(`select count(distinct room_no)::int rooms, item, sum(qty)::int n from public.room_inventory
                               where property_id = 'P1' group by item order by item`)).rows
    // chairs: the 2nd floor sheet prints a total of 4 but its rooms add up to 5; the room counts are kept
    expect(Object.fromEntries(r.map((x) => [x.item, x.n]))).toEqual({ bed: 68, chair: 12, cupboard: 74, mattress: 73, table: 43 })
    expect(r[0].rooms).toBe(30)
  })

  it('lets the wing\'s staff read it and hides it from residents', async () => {
    expect((await as(db, sales, ({ q }) => q('select * from public.room_inventory'))).length).toBe(150)
    expect(await as(db, resident, ({ q }) => q('select * from public.room_inventory'))).toEqual([])
  })

  it('lets managers edit counts, stamps who did it, and refuses sales and bad values', async () => {
    await as(db, mgr, ({ q }) => q(`insert into public.room_inventory (property_id, room_no, item, qty) values ('P1', '101', 'chair', 2)
                                   on conflict (property_id, room_no, item) do update set qty = excluded.qty`))
    const row = (await db.query("select qty, updated_by from public.room_inventory where room_no = '101' and item = 'chair'")).rows[0]
    expect(row).toEqual({ qty: 2, updated_by: mgr })
    await expect(as(db, sales, ({ q }) => q("update public.room_inventory set qty = 9 where room_no = '101' and item = 'chair' returning qty")))
      .resolves.toEqual([])
    await expect(as(db, mgr, ({ q }) => q("insert into public.room_inventory (property_id, room_no, item, qty) values ('P1', '102', 'fan', -1)"))).rejects.toThrow(/check/)
  })
})

describe('A wing beds from the inventory', () => {
  it('sets beds to the bed count, else the mattresses, else one, and keeps beds in use', async () => {
    await db.query("update public.beds set is_occupied = true where room_id = 'pg-101' and label = 'B'")
    await db.exec(bedSync)
    expect(await labels('pg-102')).toBe('ABCDE')   // 5 beds on the list
    expect(await labels('dpg-201')).toBe('ABCD')   // 4 beds
    expect(await labels('pg-101')).toBe('AB')      // none listed -> 1, but B is occupied so it stays
    await db.query("update public.beds set is_occupied = false where room_id = 'pg-101'")
    await db.exec(bedSync)
    expect(await labels('pg-101')).toBe('A')
    expect(await labels('flat-301')).toBe('AB')    // B wing untouched
  })
})
