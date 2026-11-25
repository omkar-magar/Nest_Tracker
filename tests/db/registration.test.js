// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, freshDb, makeUser } from './pg'

let db, guest, other, manager, outsider, room
const submit = () => as(db, guest, ({ q }) => q('select public.submit_resident_registration($1)', [JSON.stringify({
  property_id: 'P1', full_name: 'Demo Customer', email: 'customer@yolonest.test', phone: '9800000000',
  emergency1_name: 'Parent', emergency1_phone: '9800000001', rules_accepted: true,
})]))
const status = (who = guest) => as(db, who, ({ one }) => one('select public.my_registration() s')).then((r) => r.s)
const approve = (who = manager, patch = {}) => as(db, who, ({ one }) => one('select public.approve_resident_registration($1, $2) id', [guest, JSON.stringify({
  room_no: room, rent: 6000, deposit: 6000, due_date: '2026-12-03', check_in: '2026-11-25', ...patch,
})])).then((r) => r.id)

beforeAll(async () => {
  db = await freshDb()
  guest = await makeUser(db)
  other = await makeUser(db)
  manager = await makeUser(db, 'manager')
  outsider = await makeUser(db, 'manager')
  await db.query("insert into public.property_members(property_id, user_id) values ('P1', $1), ('P2', $2)", [manager, outsider])
  room = (await db.query("select wing || '-' || room_no k from public.rooms where property_id = 'P1' and is_active limit 1")).rows[0].k
})
afterAll(async () => { await db?.close() })

describe('resident registration lifecycle', () => {
  it('submits for approval and restricts approval to the property manager', async () => {
    await submit()
    expect(await status()).toMatchObject({ state: 'pending', stays: [] })
    const alerts = (await db.query("select user_id, link from public.notifications where kind = 'registration' and channel = 'in_app'")).rows
    expect(alerts).toContainEqual({ user_id: manager, link: '/admin/register?wing=P1&tab=new' })
    expect(alerts.some((n) => n.user_id === outsider)).toBe(false)
    await expect(approve(guest)).rejects.toThrow(/manage this property/)
    await expect(approve(outsider)).rejects.toThrow(/manage this property/)
    await expect(approve(manager, { room_no: 'missing' })).rejects.toThrow(/active room/)
    await expect(approve(manager, { rent: '' })).rejects.toThrow(/required/)
    expect(await status(other)).toBeNull()
    const visible = await as(db, outsider, ({ q }) => q('select user_id from public.tenant_profiles where user_id = $1', [guest]))
    expect(visible).toEqual([])
  })
  it('approves atomically, links the register and prevents duplicate approval or active re-registration', async () => {
    await approve()
    expect(await status()).toMatchObject({ state: 'active', stays: [expect.objectContaining({ rent: 6000, due_date: '2026-12-03' })] })
    await expect(approve()).rejects.toThrow(/no longer pending/)
    await expect(submit()).rejects.toThrow(/stay is active/)
  })
  it('checks out, preserves history, and reuses the same login for another registration', async () => {
    const id = (await status()).stays[0].id
    await as(db, manager, ({ q }) => q("select public.register_checkout($1, '2026-11-26')", [id]))
    expect(await status()).toMatchObject({ state: 'ended', stays: [expect.objectContaining({ checked_out_on: '2026-11-26' })] })
    await submit()
    await as(db, manager, ({ q }) => q("update public.register_guests set notes = 'Past stay note' where id = $1", [id]))
    expect((await status()).state).toBe('pending')
    await approve()
    expect((await status()).stays).toHaveLength(2)
  })
  it('keeps customer history when the manager deletes a linked register entry', async () => {
    const id = (await status()).stays[0].id
    await as(db, manager, ({ q }) => q('delete from public.register_guests where id = $1', [id]))
    expect(await status()).toMatchObject({ state: 'ended', stays: [expect.objectContaining({ removed: true }), expect.anything()] })
    await submit()
    expect((await status()).state).toBe('pending')
  })
  it('restores a deleted guest with their account link and due date', async () => {
    const h = (await db.query("select id from public.register_history where op = 'DELETE' order by id desc limit 1")).rows[0].id
    await as(db, manager, ({ q }) => q('select public.register_restore($1)', [h]))
    expect(await status()).toMatchObject({ state: 'active', stays: [expect.objectContaining({ removed: false, due_date: '2026-12-03' }), expect.anything()] })
  })
})
