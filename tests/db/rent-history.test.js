// @vitest-environment node
// Room and bed saves go through the shared rent-history trigger (PGlite).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freshDb } from './pg'

let db
const one = async (sql, params) => (await db.query(sql, params)).rows[0]

beforeAll(async () => { db = await freshDb() }, 120000)
afterAll(async () => { await db?.close() })

describe('rent history trigger', () => {
  it('saves a room with the same rent (room type change) without error', async () => {
    const r = await one("select id, price from public.rooms where property_id = 'P1' limit 1")
    await db.query("update public.rooms set room_type = 'flat', price = price where id = $1", [r.id])
    expect((await one('select room_type from public.rooms where id = $1', [r.id])).room_type).toBe('flat')
    expect((await one('select count(*)::int n from public.rent_changes where room_id = $1', [r.id])).n).toBe(0)
  })
  it('records a room rent change and a bed rent change', async () => {
    const r = await one("select id, price from public.rooms where property_id = 'P1' limit 1")
    await db.query('update public.rooms set price = price + 100 where id = $1', [r.id])
    const b = await one('select id, rent from public.beds where room_id = $1 limit 1', [r.id])
    if (b) await db.query('update public.beds set rent = coalesce(rent, 0) + 50 where id = $1', [b.id])
    const n = (await one('select count(*)::int n from public.rent_changes where room_id = $1', [r.id])).n
    expect(n).toBe(b ? 2 : 1)
  })
})
