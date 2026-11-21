// @vitest-environment node
// PRD 2-4 against real Postgres (PGlite): reservations, check-in, invoices, part payments, charges,
// electricity, late fees, reminders, transfer and check-out settlement.
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asService, freshDb, makeUser } from './pg'

let db, owner, manager, otherManager, tenant, tenant2

const emergency = { emergency1_name: 'Asha', emergency1_relation: 'Mother', emergency1_phone: '9811111111' }
const bedsOf = async (room) => (await db.query('select id, code from public.beds where room_id = $1 order by label', [room])).rows
const monthStart = (offset = 0) => {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset)
  return d.toISOString().slice(0, 10)
}

beforeAll(async () => {
  db = await freshDb()
  owner = await makeUser(db, 'admin', 'Owner')
  manager = await makeUser(db, 'manager', 'Manager')
  otherManager = await makeUser(db, 'manager', 'Other')
  tenant = await makeUser(db, 'customer', 'Ravi')
  tenant2 = await makeUser(db, 'customer', 'Neha')
  await db.query("insert into public.properties (id, name) values ('P3', 'Second PG')")
  await as(db, owner, async ({ q }) => {
    await q("select public.admin_assign_member('P1', $1, true)", [manager])
    await q("select public.admin_assign_member('P3', $1, true)", [otherManager])
  })
  for (const t of [tenant, tenant2]) {
    await as(db, t, ({ q }) => q('select public.save_my_tenant_profile($1)', [emergency]))
  }
}, 60000)

describe('property and beds', () => {
  it('gives every bed a readable unique id', async () => {
    const beds = await bedsOf('pg-101')
    expect(beds.map((b) => b.code)).toEqual(['P1-A-F1-R101-B1', 'P1-A-F1-R101-B2'])
  })

  it('bulk-creates rooms with beds for a manager of that property only', async () => {
    const n = await as(db, manager, ({ one }) =>
      one("select public.bulk_create_rooms('P1', 6, 601, 3, 2, 'monthly-pg', 'double', 'AC', 7000) n"))
    expect(n.n).toBe(3)
    expect((await bedsOf('p1-a-602')).length).toBe(2)
    await expect(as(db, otherManager, ({ q }) =>
      q("select public.bulk_create_rooms('P1', 7, 701, 1, 1, 'monthly-pg', 'single', 'AC', 7000)"))).rejects.toThrow(/do not manage/)
  })

  it('lets both wings use the same room numbers, with distinct bed codes', async () => {
    // B wing is property P2; the wing argument can't override the property's wing
    await as(db, owner, ({ q }) =>
      q("select public.bulk_create_rooms('P2', 6, 601, 1, 2, 'monthly-pg', 'double', 'AC', 7000, 0, 'month', 'A')"))
    const room = await db.query("select property_id, wing, room_no from public.rooms where id = 'p2-b-601'")
    expect(room.rows[0]).toEqual({ property_id: 'P2', wing: 'B', room_no: '601' })
    expect((await bedsOf('p2-b-601')).map((b) => b.code)).toEqual(['P2-B-F6-R601-B1', 'P2-B-F6-R601-B2'])
    await expect(as(db, owner, ({ q }) =>
      q("select public.bulk_create_rooms('P2', 6, 601, 1, 1, 'monthly-pg', 'single', 'AC', 7000)"))).rejects.toThrow(/already exists/)
    // moving a room to the other wing's property rebuilds its bed codes
    await db.query("update public.rooms set property_id = 'P2' where id = 'pg-102'")
    expect((await bedsOf('pg-102'))[0].code).toBe('P2-B-F1-R102-B1')
    await db.query("update public.rooms set property_id = 'P1' where id = 'pg-102'")
    expect((await bedsOf('pg-102'))[0].code).toBe('P1-A-F1-R102-B1')
  })

  it('reserves a bed, blocks others, and shows it as reserved', async () => {
    const [b1] = await bedsOf('p1-a-603')
    await as(db, manager, ({ q }) =>
      q("select public.reserve_bed($1, 'Walk-in Ravi', '9800000001', 2000, current_date + 3, $2)", [b1.id, tenant]))
    const st = await db.query('select public.bed_state(b) s from public.beds b where id = $1', [b1.id])
    expect(st.rows[0].s).toBe('reserved')
    await expect(as(db, manager, ({ q }) =>
      q("select public.reserve_bed($1, 'Someone', null, 0, current_date + 3)", [b1.id]))).rejects.toThrow(/not vacant/)
  })

  it('hides other properties\' stays from a manager', async () => {
    const rows = await as(db, otherManager, ({ q }) => q('select * from public.tenant_profiles'))
    expect(rows).toEqual([])
  })
})

describe('check-in and monthly invoices', () => {
  let booking, bill
  it('refuses check-in without an emergency contact', async () => {
    const lone = await makeUser(db, 'customer', 'NoContact')
    const [b] = await bedsOf('p1-a-601')
    await expect(as(db, manager, ({ q }) =>
      q('select public.check_in_tenant($1)', [{ customer_id: lone, bed_ids: [b.id] }]))).rejects.toThrow(/emergency contact/)
  })

  it('checks in, converts the reservation, takes the deposit and bills the first period', async () => {
    const [b1] = await bedsOf('p1-a-603')
    const row = await as(db, manager, ({ one }) => one('select public.check_in_tenant($1) id', [{
      customer_id: tenant, bed_ids: [b1.id], check_in: monthStart(), rent: 7000, deposit: 7000,
      deposit_paid: true, deposit_mode: 'cash', notice_period_days: 30,
    }]))
    booking = row.id
    const bed = await db.query('select is_occupied, is_reserved from public.beds where id = $1', [b1.id])
    expect(bed.rows[0]).toEqual({ is_occupied: true, is_reserved: false })
    const dep = await db.query('select status, received_amount from public.security_deposits where booking_id = $1', [booking])
    expect(dep.rows[0]).toEqual({ status: 'held', received_amount: 7000 })
    const bills = (await db.query("select * from public.bills where booking_id = $1 and kind = 'rent' order by period_start", [booking])).rows
    expect(bills[0].amount).toBe(7000)            // a full cycle starting on the due day is not pro-rated
    expect(bills[0].period_start.toISOString().slice(0, 10)).toBe(monthStart())
    bill = bills[0]
    const tp = await db.query('select approval_status from public.tenant_profiles where user_id = $1', [tenant])
    expect(tp.rows[0].approval_status).toBe('approved')
  })

  it('pro-rates a mid-month check-in', async () => {
    const [b] = await bedsOf('p1-a-602')
    const d = new Date(monthStart()); d.setUTCDate(16)
    const start = d.toISOString().slice(0, 10)
    const row = await as(db, manager, ({ one }) => one('select public.check_in_tenant($1) id', [{
      customer_id: tenant2, bed_ids: [b.id], check_in: start, rent: 6000, deposit: 0,
    }]))
    const first = (await db.query("select l.* from public.bill_lines l join public.bills b on b.id = l.bill_id where b.booking_id = $1 and l.kind = 'rent' order by b.period_start limit 1", [row.id])).rows[0]
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    const days = end - 16 + 1
    expect(first.amount).toBe(Math.round(6000 * days / end))
    expect(first.description).toMatch(/pro-rata/)
  })

  it('takes part payments and labels the invoice', async () => {
    await as(db, manager, ({ q }) => q("select public.record_manual_payment($1, 3000, 'upi', 'UTR123')", [bill.id]))
    let b = (await db.query('select amount_paid, status, public.bill_state(bills) st from public.bills where id = $1', [bill.id])).rows[0]
    expect(b.amount_paid).toBe(3000)
    expect(b.status).toBe('unpaid')
    expect(['partially_paid', 'overdue']).toContain(b.st)
    await expect(as(db, manager, ({ q }) => q("select public.record_manual_payment($1, 100, 'cheque', '')", [bill.id])))
      .rejects.toThrow(/reference/)
    // overpay by 500: the bill closes and the extra becomes credit
    await as(db, manager, ({ q }) => q("select public.record_manual_payment($1, 4500, 'cash')", [bill.id]))
    b = (await db.query('select amount_paid, status from public.bills where id = $1', [bill.id])).rows[0]
    expect(b).toEqual({ amount_paid: 7000, status: 'paid' })
    const bal = await db.query('select public.credit_balance($1) c', [tenant])
    expect(bal.rows[0].c).toBe(500)
    const rc = await db.query("select receipt_no from public.payments where bill_id = $1 and status = 'succeeded'", [bill.id])
    expect(rc.rows.every((r) => /^RCPT-/.test(r.receipt_no))).toBe(true)
  })

  it('needs a reason for discounts and reopens a paid invoice when a charge is added', async () => {
    await expect(as(db, manager, ({ q }) => q("select public.add_bill_line($1, 'discount', 'Loyalty', 200, '')", [bill.id])))
      .rejects.toThrow(/reason/)
    await as(db, manager, ({ q }) => q("select public.add_bill_line($1, 'laundry', 'Laundry', 300)", [bill.id]))
    const b = (await db.query('select amount, status from public.bills where id = $1', [bill.id])).rows[0]
    expect(b).toEqual({ amount: 7300, status: 'unpaid' })
  })

  it('splits sub-meter electricity across the room\'s occupants', async () => {
    const t3 = await makeUser(db, 'customer', 'Third')
    await as(db, t3, ({ q }) => q('select public.save_my_tenant_profile($1)', [emergency]))
    const [, b2] = await bedsOf('p1-a-603')
    await as(db, manager, ({ q }) => q('select public.check_in_tenant($1)', [{ customer_id: t3, bed_ids: [b2.id], check_in: monthStart(), rent: 7000, deposit: 0 }]))
    const shares = await as(db, manager, ({ one }) =>
      one("select public.add_electricity('p1-a-603', current_date, 'meter', null, 100, 201, 8) s"))
    expect(shares.s.map((x) => x.amount)).toEqual([404, 404])   // 101 units x 8 = 808
    const lines = await db.query("select count(*)::int n from public.bill_lines where kind = 'electricity'")
    expect(lines.rows[0].n).toBe(2)
    await expect(as(db, manager, ({ q }) => q("select public.add_electricity('p1-a-603', current_date - 40, 'meter', null, 300, 200, 8)")))
      .rejects.toThrow(/lower/)
  })

  it('adds an automatic late fee after the grace period', async () => {
    await db.query("update public.bills set due_date = current_date - 10 where id = $1", [bill.id])
    await asService(db, ({ q }) => q('select public.apply_late_fees()'))
    const fee = await db.query("select amount from public.bill_lines where bill_id = $1 and kind = 'late_fee'", [bill.id])
    expect(fee.rows[0].amount).toBe(250)       // Rs 50 x (10 - 5 grace) days
    await asService(db, ({ q }) => q('select public.apply_late_fees()'))
    const again = await db.query("select count(*)::int n from public.bill_lines where bill_id = $1 and kind = 'late_fee'", [bill.id])
    expect(again.rows[0].n).toBe(1)            // re-running updates, never duplicates
  })

  it('queues reminders on every configured channel, once per day', async () => {
    await db.query('update public.bills set due_date = current_date - 2 where id = $1', [bill.id])   // 'after: [2]' in the schedule
    await asService(db, ({ q }) => q('select public.queue_rent_reminders()'))
    await asService(db, ({ q }) => q('select public.queue_rent_reminders()'))
    const n = await db.query("select channel from public.notifications where kind = 'rent_reminder' and entity_id = $1", [bill.id])
    expect(n.rows.map((r) => r.channel).sort()).toEqual(['email', 'in_app', 'push', 'sms', 'whatsapp'])
  })

  it('lets the tenant pay part of a bill online (demo gateway) but not more than owed', async () => {
    const owed = (await db.query('select amount - amount_paid o from public.bills where id = $1', [bill.id])).rows[0].o
    await expect(as(db, tenant, ({ q }) => q("select public.payment_create_order($1, 'demo', $2)", [bill.id, owed + 1])))
      .rejects.toThrow(/between/)
    const p = await as(db, tenant, ({ one }) => one("select public.payment_create_order($1, 'demo', 100) id", [bill.id]))
    await as(db, tenant, ({ q }) => q("select public.demo_complete_payment($1, 'success')", [p.id]))
    const after = (await db.query('select amount - amount_paid o from public.bills where id = $1', [bill.id])).rows[0].o
    expect(after).toBe(owed - 100)
  })

  it('transfers to another bed with rent history kept', async () => {
    const [nb] = await bedsOf('p1-a-601')
    await as(db, manager, ({ q }) => q("select public.transfer_stay($1, $2, current_date, 7500, 'Wants window bed')", [booking, [nb.id]]))
    const t = await db.query('select old_rate, new_rate from public.stay_transfers where booking_id = $1', [booking])
    expect(t.rows[0]).toEqual({ old_rate: 7000, new_rate: 7500 })
    const rc = await db.query('select count(*)::int n from public.rent_changes where booking_id = $1', [booking])
    expect(rc.rows[0].n).toBe(1)
  })

  it('settles check-out against the deposit and frees the bed', async () => {
    const q1 = await as(db, manager, ({ one }) => one("select public.checkout_quote($1, current_date, $2) q",
      [booking, [{ kind: 'damage', description: 'Broken chair', amount: 800 }]]))
    expect(q1.q.notice_shortfall_days).toBe(30)
    expect(q1.q.deposit_held).toBe(7000)
    const res = await as(db, manager, ({ one }) => one("select public.check_out_tenant($1, current_date, $2, 'upi', 'RF1') r",
      [booking, [{ kind: 'damage', description: 'Broken chair', amount: 800 }]]))
    const r = res.r
    expect(r.refund + 0).toBeGreaterThanOrEqual(0)
    const bk = await db.query('select status, actual_checkout from public.bookings where id = $1', [booking])
    expect(bk.rows[0].status).toBe('completed')
    const occ = await db.query('select count(*)::int n from public.booking_beds where booking_id = $1 and active', [booking])
    expect(occ.rows[0].n).toBe(0)
    const dep = (await db.query('select status, deductions from public.security_deposits where booking_id = $1', [booking])).rows[0]
    expect(['adjusted', 'partially_refunded']).toContain(dep.status)
    expect(dep.deductions.length).toBeGreaterThan(0)
    // money in = money out: deposit 7000 covered dues; whatever was not used is refunded or still payable
    expect(r.refund === 0 || r.payable === 0).toBe(true)
  })
})
