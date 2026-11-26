// @vitest-environment node
// Coupons: managers and the owner make codes (₹ or % off), guests apply them on the registration payment (PGlite).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, freshDb, makeUser } from './pg'

let db, owner, manager, outsider, guest, other, room, room2, lead
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const create = (who, p) => as(db, who, ({ one: o }) => o('select public.create_coupon($1) c', [JSON.stringify(p)])).then((x) => x.c)
const apply = (who, code) => as(db, who, ({ one: o }) => o('select public.apply_registration_coupon($1) r', [code])).then((x) => x.r)
const reg = (who) => as(db, who, ({ one: o }) => o('select public.my_registration() r')).then((x) => x.r)
const submit = (who, r, phone = '9800000000') => as(db, who, ({ q }) => q('select public.submit_resident_registration($1)', [JSON.stringify({
  property_id: 'P1', full_name: 'G', phone, emergency1_name: 'P', emergency1_phone: '9800000001', rules_accepted: true,
  stay_type: 'pg', room_no: r, move_in_date: today, due_day: 5 })]))

beforeAll(async () => {
  db = await freshDb()
  owner = await makeUser(db, 'admin', 'Owner')
  manager = await makeUser(db, 'manager', 'Priya')
  outsider = await makeUser(db, 'manager', 'Rahul')
  guest = await makeUser(db, 'customer', 'Asha')   // phone 9800000000 (from makeUser)
  other = await makeUser(db, 'customer', 'Neha')
  await db.query("insert into public.property_members(property_id, user_id) values ('P1', $1), ('P2', $2)", [manager, outsider])
  const rooms = (await db.query("select wing || '-' || room_no k from public.rooms where property_id = 'P1' and is_active and room_type <> 'flat' order by room_no limit 2")).rows
  room = rooms[0].k; room2 = rooms[1].k
  lead = (await one("insert into public.enquiries (property_id, name, phone, budget) values ('P1', 'Lead', '9800000000', 7000) returning id")).id
  await submit(guest, room)
  await submit(other, room2, '9811112222')
}, 120000)
afterAll(async () => { await db?.close() })

describe('making coupons', () => {
  it('is for managers (their wings) and the owner', async () => {
    await expect(create(guest, { kind: 'flat', value: 500 })).rejects.toThrow(/managers and the owner/)
    await expect(create(outsider, { kind: 'flat', value: 500, property_id: 'P1' })).rejects.toThrow(/manage this property/)
    await expect(create(manager, { kind: 'flat', value: 500 })).rejects.toThrow(/Choose the wing/)
    await expect(create(manager, { kind: 'percent', value: 120, property_id: 'P1' })).rejects.toThrow(/Enter the discount/)
    expect(await create(manager, { code: 'welcome500', kind: 'flat', value: 500, property_id: 'P1' })).toBe('WELCOME500')
    await expect(create(owner, { code: 'WELCOME500', kind: 'flat', value: 1 })).rejects.toThrow(/already exists/)
    expect(await create(owner, { kind: 'percent', value: 10 })).toMatch(/^YN[0-9A-F]{6}$/)
  })
  it('ties a coupon for an enquiry to its mobile and marks the enquiry approached', async () => {
    const code = await create(manager, { code: 'LEAD10', kind: 'percent', value: 10, property_id: 'P1', enquiry_id: lead })
    expect(await one('select phone, enquiry_id from public.offers where code = $1', [code])).toEqual({ phone: '9800000000', enquiry_id: lead })
    const e = await one('select coupon_code, status, approached_at is not null approached from public.enquiries where id = $1', [lead])
    expect(e).toEqual({ coupon_code: 'LEAD10', status: 'contacted', approached: true })
  })
  it('shows a manager their wing and own coupons, and the owner every coupon', async () => {
    const mine = await as(db, manager, ({ one: o }) => o('select public.coupons_list() l')).then((x) => x.l)
    expect(mine.map((c) => c.code).sort()).toEqual(['LEAD10', 'WELCOME500'])
    expect(mine.find((c) => c.code === 'LEAD10')).toMatchObject({ created_by_name: 'Priya', enquiry_name: 'Lead' })
    expect((await as(db, owner, ({ one: o }) => o('select public.coupons_list() l')).then((x) => x.l))).toHaveLength(3)
    expect(await as(db, outsider, ({ one: o }) => o('select public.coupons_list() l')).then((x) => x.l)).toEqual([])
    expect(await as(db, guest, ({ one: o }) => o('select public.coupons_list() l')).then((x) => x.l)).toEqual([])
  })
})

describe('applying a coupon', () => {
  it('checks the code, its mobile and its wing', async () => {
    await expect(apply(guest, 'NOPE')).rejects.toThrow(/not valid/)
    await expect(apply(other, 'LEAD10')).rejects.toThrow(/another mobile/)
    await as(db, outsider, ({ q }) => q("select public.create_coupon('{\"code\":\"BWING\",\"kind\":\"flat\",\"value\":100,\"property_id\":\"P2\"}')"))
    await expect(apply(guest, 'bwing')).rejects.toThrow(/another wing/)
    await db.query("update public.offers set valid_to = current_date - 3 where code = 'BWING'")
  })
  it('takes the discount off what is left to pay, online and at approval', async () => {
    expect(await apply(guest, ' lead10 ')).toMatchObject({ code: 'LEAD10', discount: 1400, to_pay: 12600 })
    expect(await reg(guest)).toMatchObject({ coupon_code: 'LEAD10', discount: 1400, to_pay: 12600 })
    expect(await apply(guest, 'WELCOME500')).toMatchObject({ discount: 500, to_pay: 13500 })
    const order = await as(db, guest, ({ one: o }) => o('select public.start_my_registration_payment() r')).then((x) => x.r)
    expect(order.amount).toBe(13500)
    await as(db, guest, ({ q }) => q("select public.demo_complete_my_registration_payment($1, 'success')", [order.id]))
    expect(await reg(guest)).toMatchObject({ payment_status: 'paid', amount_paid: 13500, to_pay: 0 })
    await expect(apply(guest, 'LEAD10')).rejects.toThrow(/before paying/)
    await as(db, manager, ({ q }) => q('select public.approve_resident_registration($1, $2)', [guest, JSON.stringify({
      room_no: room, rent: 7000, deposit: 7000, due_date: '2099-02-05', check_in: today })]))
    expect(await one("select used_count from public.offers where code = 'WELCOME500'")).toEqual({ used_count: 1 })
    expect(await one('select carry_forward from public.register_guests where customer_id = $1', [guest])).toEqual({ carry_forward: 0 })
  })
  it('stops a coupon once its uses run out', async () => {
    await db.query("update public.offers set max_uses = 1 where code = 'WELCOME500'")
    await expect(apply(other, 'WELCOME500')).rejects.toThrow(/fully used/)
  })
  it('lets the owner or wing manager switch a coupon off', async () => {
    await expect(as(db, outsider, ({ q }) => q("select public.set_coupon_active('LEAD10', false)"))).rejects.toThrow(/Not allowed/)
    await as(db, owner, ({ q }) => q("select public.set_coupon_active('LEAD10', false)"))
    expect(await one("select is_active from public.offers where code = 'LEAD10'")).toEqual({ is_active: false })
  })
})

describe('enquiry approached', () => {
  it('records when an enquiry first leaves new', async () => {
    const id = (await one("insert into public.enquiries (property_id, name, phone) values ('P1', 'Call me', '9822222222') returning id")).id
    await as(db, manager, ({ q }) => q("select public.log_lead_activity($1, 'call', 'answered', '', '', null)", [id]))
    expect(await one('select status, approached_at is not null a from public.enquiries where id = $1', [id])).toEqual({ status: 'contacted', a: true })
  })
})

describe('coming back for a new registration', () => {
  it('starts without the coupon used on the previous registration', async () => {
    // guest was approved above with WELCOME500 (now fully used); they check out and register again
    await db.query("update public.register_guests set checked_out_on = check_in where customer_id = $1", [guest])
    const free = (await one("select public.registration_rooms('P1', 'pg') -> 0 ->> 'room_no' k")).k
    await submit(guest, free)
    expect(await reg(guest)).toMatchObject({ state: 'pending', coupon_code: null, discount: 0, to_pay: 14000 })
  })
  it('keeps the coupon when the same waiting registration is sent again', async () => {
    const code = await create(owner, { kind: 'flat', value: 300, property_id: 'P1' })
    await apply(other, code)
    await submit(other, room2, '9811112222')
    expect(await reg(other)).toMatchObject({ coupon_code: code, discount: 300 })
  })
})
