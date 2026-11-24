// @vitest-environment node
// PRD 5-10 against real Postgres (PGlite): expenses, complaints, enquiries / sales, employees and payroll,
// reports, dashboard and the scheduled job runner.
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asService, freshDb, makeUser } from './pg'

let db, owner, manager, sales1, sales2, staffUser, tenant, staffId, otherManager
const emergency = { emergency1_name: 'Asha', emergency1_relation: 'Mother', emergency1_phone: '9811111111', rules_accepted: true }
const one = async (sql, p) => (await db.query(sql, p)).rows[0]

beforeAll(async () => {
  db = await freshDb()
  owner = await makeUser(db, 'admin', 'Owner')
  manager = await makeUser(db, 'manager', 'Manager')
  otherManager = await makeUser(db, 'manager', 'Other')
  sales1 = await makeUser(db, 'sales', 'Sam')
  sales2 = await makeUser(db, 'sales', 'Tara')
  staffUser = await makeUser(db, 'employee', 'Raju')
  tenant = await makeUser(db, 'customer', 'Ravi')
  await db.query("insert into public.properties (id, name, lat, lng) values ('P3', 'Second PG', 18.59, 73.74)")
  await db.query('update public.properties set lat = 18.5912, lng = 73.7389 where id = $1', ['P1'])
  await as(db, owner, async ({ q }) => {
    for (const u of [manager, sales1, sales2, staffUser]) await q("select public.admin_assign_member('P1', $1, true)", [u])
    await q("select public.admin_assign_member('P3', $1, true)", [otherManager])
  })
  await as(db, tenant, ({ q }) => q('select public.save_my_tenant_profile($1)', [emergency]))
  const bed = await one("select id from public.beds where room_id = 'pg-101' order by label limit 1")
  await as(db, manager, ({ q }) => q('select public.check_in_tenant($1)', [{ customer_id: tenant, bed_ids: [bed.id], deposit: 0 }]))
}, 120000)

describe('expenses (PRD 5)', () => {
  it('sends a manager\'s large expense to the owner for approval', async () => {
    const e = await as(db, manager, ({ one: o }) => o(
      "insert into public.expenses (property_id, category_id, amount, vendor) values ('P1', 'repairs', 9000, 'Shree Electricals') returning id, status"))
    expect(e.status).toBe('pending')
    const small = await as(db, manager, ({ one: o }) => o(
      "insert into public.expenses (property_id, category_id, amount) values ('P1', 'groceries', 1200) returning status"))
    expect(small.status).toBe('approved')
    await expect(as(db, manager, ({ q }) => q('select public.approve_expense($1, true)', [e.id]))).rejects.toThrow(/Owner only/)
    await as(db, owner, ({ q }) => q('select public.approve_expense($1, true)', [e.id]))
    expect((await one('select status from public.expenses where id = $1', [e.id])).status).toBe('approved')
  })

  it('creates recurring expenses once a month', async () => {
    await as(db, manager, ({ q }) => q("insert into public.recurring_expenses (property_id, category_id, amount, day_of_month) values ('P1', 'internet', 1500, 1)"))
    await asService(db, ({ q }) => q('select public.generate_recurring_expenses()'))
    await asService(db, ({ q }) => q('select public.generate_recurring_expenses()'))
    expect((await one("select count(*)::int n from public.expenses where source = 'recurring'")).n).toBe(1)
  })

  it('keeps managers out of other properties\' expenses', async () => {
    const rows = await as(db, otherManager, ({ q }) => q('select * from public.expenses'))
    expect(rows).toEqual([])
  })
})

describe('complaints (PRD 6)', () => {
  let cid
  it('lets a tenant raise a complaint for their own room and alerts the office', async () => {
    const r = await as(db, tenant, ({ one: o }) => o('select public.raise_complaint($1) id',
      [{ category: 'plumbing', title: 'Tap leaking', description: 'Bathroom tap', priority: 'urgent', preferred_time: 'After 6 pm' }]))
    cid = r.id
    const c = await one('select room_id, priority, status, due_at > now() ok from public.complaints where id = $1', [cid])
    expect(c).toEqual({ room_id: 'pg-101', priority: 'medium', status: 'new', ok: true })  // tenants cannot set urgent
    expect((await one("select count(*)::int n from public.notifications where kind = 'complaint' and channel = 'in_app' and user_id = $1", [manager])).n).toBe(1)
  })

  it('follows the status flow, notifies on each change, and books the repair cost as an expense', async () => {
    await as(db, manager, ({ q }) => q('select public.update_complaint($1, $2)', [cid, { assigned_to: staffUser, priority: 'high' }]))
    expect((await one('select status from public.complaints where id = $1', [cid])).status).toBe('assigned')
    await expect(as(db, tenant, ({ q }) => q('select public.update_complaint($1, $2)', [cid, { status: 'resolved' }]))).rejects.toThrow()
    await as(db, staffUser, ({ q }) => q('select public.update_complaint($1, $2)', [cid, { status: 'in_progress', note: 'On it' }]))
    await as(db, staffUser, ({ q }) => q('select public.update_complaint($1, $2)',
      [cid, { status: 'resolved', resolution: 'Replaced washer', fixed_by: 'Raju', cost: 350 }]))
    const exp = await one("select amount, category_id from public.expenses where source = 'complaint' and source_id = $1", [cid])
    expect(exp).toEqual({ amount: 350, category_id: 'repairs' })
    await as(db, tenant, ({ q }) => q('select public.update_complaint($1, $2)', [cid, { status: 'reopen', note: 'Still leaking' }]))
    const c = await one('select status, reopen_count from public.complaints where id = $1', [cid])
    expect(c).toEqual({ status: 'assigned', reopen_count: 1 })
    await expect(as(db, staffUser, ({ q }) => q('select public.update_complaint($1, $2)', [cid, { status: 'closed' }]))).rejects.toThrow(/Cannot move/)
    await as(db, staffUser, ({ q }) => q('select public.update_complaint($1, $2)', [cid, { status: 'resolved' }]))
    await as(db, tenant, ({ q }) => q('select public.update_complaint($1, $2)', [cid, { status: 'closed', rating: 4, feedback: 'Fixed' }]))
    expect((await one('select status, rating from public.complaints where id = $1', [cid]))).toEqual({ status: 'closed', rating: 4 })
    const tenantNotes = await one("select count(*)::int n from public.notifications where user_id = $1 and kind = 'complaint'", [tenant])
    expect(tenantNotes.n).toBeGreaterThanOrEqual(4)
    const events = await one('select count(*)::int n from public.complaint_events where complaint_id = $1', [cid])
    expect(events.n).toBeGreaterThanOrEqual(6)
  })

  it('escalates overdue tickets once and runs preventive schedules', async () => {
    const r = await as(db, manager, ({ one: o }) => o('select public.raise_complaint($1) id',
      [{ property_id: 'P1', category: 'wifi', title: 'Wi-Fi down on floor 2', priority: 'urgent' }]))
    await db.query("update public.complaints set due_at = now() - interval '1 hour' where id = $1", [r.id])
    await asService(db, ({ q }) => q('select public.escalate_overdue_complaints()'))
    await asService(db, ({ q }) => q('select public.escalate_overdue_complaints()'))
    expect((await one("select count(*)::int n from public.complaint_events where complaint_id = $1 and note like 'Escalated%'", [r.id])).n).toBe(1)
    await as(db, manager, ({ q }) => q("insert into public.maintenance_schedules (property_id, title, interval_days, next_due) values ('P1', 'Water tank cleaning', 90, current_date)"))
    await asService(db, ({ q }) => q('select public.run_maintenance_schedules()'))
    const pm = await one("select category, is_common_area from public.complaints where title = 'Water tank cleaning'")
    expect(pm).toEqual({ category: 'preventive', is_common_area: true })
    expect((await one("select next_due - current_date d from public.maintenance_schedules")).d).toBe(90)
  })
})

describe('enquiries and sales (PRD 8-9)', () => {
  let lead
  it('captures a website enquiry, scores it and assigns it round-robin', async () => {
    const r = await as(db, null, ({ one: o }) => o('select public.submit_enquiry($1) id',
      [{ name: 'Kiran', phone: '+91 98765 43210', move_in: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), room_type: 'Double sharing' }]))
    lead = r.id
    const e = await one('select phone, temperature, assigned_to, source from public.enquiries where id = $1', [lead])
    expect(e.phone).toBe('9876543210')
    expect(e.temperature).toBe('hot')
    expect([sales1, sales2]).toContain(e.assigned_to)
    const r2 = await as(db, null, ({ one: o }) => o('select public.submit_enquiry($1) id', [{ name: 'Meera', phone: '9123456780' }]))
    const e2 = await one('select assigned_to from public.enquiries where id = $1', [r2.id])
    expect(e2.assigned_to).not.toBe(e.assigned_to)       // the other executive gets the next lead
    expect((await one('select count(*)::int n from public.enquiry_submissions')).n).toBe(2)
  })

  it('folds a repeat enquiry from the same mobile into the open lead and flags manual duplicates', async () => {
    const again = await as(db, null, ({ one: o }) => o('select public.submit_enquiry($1) id', [{ name: 'Kiran K', phone: '9876543210', message: 'Any AC rooms?' }]))
    expect(again.id).toBe(lead)
    const dup = await as(db, sales1, ({ one: o }) => o(
      "insert into public.enquiries (property_id, name, phone, source) values ('P1', 'Kiran', '9876543210', 'walk_in') returning duplicate_of"))
    expect(dup.duplicate_of).toBe(lead)
  })

  it('needs a reason to mark a lead lost', async () => {
    const r = await as(db, null, ({ one: o }) => o('select public.submit_enquiry($1) id', [{ name: 'Lost Lead', phone: '9000000001' }]))
    await expect(as(db, owner, ({ q }) => q("update public.enquiries set status = 'lost' where id = $1", [r.id]))).rejects.toThrow(/why/)
    await as(db, owner, ({ q }) => q("update public.enquiries set status = 'lost', lost_reason = 'price' where id = $1", [r.id]))
  })

  it('logs calls, schedules follow-ups and visits with a confirmation to the lead', async () => {
    const who = (await one('select assigned_to from public.enquiries where id = $1', [lead])).assigned_to
    await as(db, who, ({ q }) => q("select public.log_lead_activity($1, 'call', 'answered', 'Wants AC', 'Send photos', now() + interval '1 day')", [lead]))
    expect((await one('select status, next_follow_up_at is not null f from public.enquiries where id = $1', [lead]))).toEqual({ status: 'contacted', f: true })
    const v = await as(db, who, ({ one: o }) => o("select public.schedule_visit($1, now() + interval '5 hours') id", [lead]))
    expect((await one("select channel from public.notifications where kind = 'visit' and entity_id = $1 order by channel", [v.id])).channel).toBe('sms')
    await asService(db, ({ q }) => q('select public.run_sales_reminders()'))
    expect((await one('select reminder_sent_at is not null s from public.site_visits where id = $1', [v.id])).s).toBe(true)
    await as(db, who, ({ q }) => q("select public.set_visit_status($1, 'visited')", [v.id]))
    expect((await one('select status from public.enquiries where id = $1', [lead])).status).toBe('visited')
  })

  it('resident form: first save needs the rules accepted, then keeps the form fields and the sign-off', async () => {
    const rita = await makeUser(db, 'customer', 'Rita')
    const form = { ...emergency, room_type_pref: 'shared_room', move_in_date: '2026-12-01', stay_duration: '6 months', id_proof_type: 'aadhaar', id_last4: '1234', occupation: 'business' }
    await expect(as(db, rita, ({ q }) => q('select public.save_my_tenant_profile($1)', [{ ...form, rules_accepted: false }]))).rejects.toThrow(/Accept the rules/)
    await as(db, rita, ({ q }) => q('select public.save_my_tenant_profile($1)', [{ ...form, rules_signature: 'Rita K' }]))
    const t = await one('select room_type_pref, stay_duration, id_proof_type, id_last4, occupation, rules_signature, rules_accepted_at from public.tenant_profiles where user_id = $1', [rita])
    expect(t).toMatchObject({ room_type_pref: 'shared_room', stay_duration: '6 months', id_proof_type: 'aadhaar', id_last4: '1234', occupation: 'business', rules_signature: 'Rita K' })
    expect(t.rules_accepted_at).toBeTruthy()
    // later edits do not ask again
    await as(db, rita, ({ q }) => q('select public.save_my_tenant_profile($1)', [{ ...emergency, rules_accepted: undefined, stay_duration: '1 year' }]))
    expect((await one('select stay_duration from public.tenant_profiles where user_id = $1', [rita])).stay_duration).toBe('1 year')
  })

  it('new registration: pending, alerts owner and managers, any manager can approve it', async () => {
    const neha = await makeUser(db, 'customer', 'Neha')
    await as(db, neha, ({ q }) => q('select public.save_my_tenant_profile($1)', [emergency]))
    expect((await one('select approval_status from public.tenant_profiles where user_id = $1', [neha])).approval_status).toBe('pending')
    for (const u of [owner, manager, otherManager]) {
      const n = await one("select link from public.notifications where kind = 'registration' and user_id = $1 and entity_id = $2 and channel = 'in_app'", [u, neha])
      expect(n.link).toBe('/admin/registrations')
    }
    // a manager of another wing sees the unassigned registration and approves it
    const seen = await as(db, otherManager, ({ q }) => q('select user_id from public.tenant_profiles where user_id = $1', [neha]))
    expect(seen.rows ?? seen).toHaveLength(1)
    await as(db, otherManager, ({ q }) => q("select public.set_tenant_approval($1, 'approved', '')", [neha]))
    expect((await one('select approval_status from public.tenant_profiles where user_id = $1', [neha])).approval_status).toBe('approved')
  })

  it('converts a lead on check-in and pays out broker commission and referral reward', async () => {
    const broker = await as(db, manager, ({ one: o }) => o(
      "insert into public.brokers (name, commission_type, commission_value) values ('Pune Homes', 'percent', 50) returning id"))
    const r = await as(db, null, ({ one: o }) => o('select public.submit_enquiry($1) id', [{ name: 'Ajay', phone: '9555555555' }]))
    await as(db, owner, ({ q }) => q('update public.enquiries set broker_id = $2, referrer_customer_id = $3 where id = $1', [r.id, broker.id, tenant]))
    // referral is created when the referrer is known at insert; here it is set later, so add it the way the UI does
    await db.query("insert into public.referrals (referrer_customer_id, enquiry_id, reward_type, reward_amount) values ($1, $2, 'discount', 1000)", [tenant, r.id])
    const ajay = await makeUser(db, 'customer', 'Ajay')
    await as(db, ajay, ({ q }) => q('select public.save_my_tenant_profile($1)', [emergency]))
    await as(db, owner, ({ q }) => q("insert into public.offers (code, description, kind, value) values ('WELCOME10', '10% off first month', 'percent', 10)"))
    const bed = await one("select id from public.beds where room_id = 'pg-102' order by label limit 1")
    const bk = await as(db, manager, ({ one: o }) => o('select public.check_in_tenant($1) id',
      [{ customer_id: ajay, bed_ids: [bed.id], rent: 6000, deposit: 0, enquiry_id: r.id, offer_code: 'welcome10' }]))
    expect((await one('select status, converted_customer_id from public.enquiries where id = $1', [r.id]))).toEqual({ status: 'booked', converted_customer_id: ajay })
    expect((await one('select amount, status from public.broker_commissions where booking_id = $1', [bk.id]))).toEqual({ amount: 3000, status: 'payable' })
    expect((await one('select status from public.referrals where enquiry_id = $1', [r.id])).status).toBe('applied')
    const disc = await one("select l.amount from public.bill_lines l join public.bills b on b.id = l.bill_id where b.booking_id = $1 and l.kind = 'discount'", [bk.id])
    expect(disc.amount).toBeLessThan(0)
    expect((await one("select used_count from public.offers where code = 'WELCOME10'")).used_count).toBe(1)
  })

  it('imports CSV rows, sends bulk messages that skip opted-out leads, and honours unsubscribe', async () => {
    const res = await as(db, sales1, ({ one: o }) => o('select public.import_enquiries($1) r', [[
      { name: 'Imp One', phone: '9400000001', source: 'justdial' }, { name: 'Bad', phone: '12' }, { name: 'Imp Two', phone: '9400000002' }]]))
    expect(res.r.imported).toBe(2)
    expect(res.r.failed).toBe(1)
    const ids = (await db.query("select id, unsub_token from public.enquiries where name like 'Imp%' order by name")).rows
    await as(db, null, ({ q }) => q('select public.unsubscribe($1)', [ids[0].unsub_token]))
    const r = await as(db, owner, ({ one: o }) => o("select public.send_bulk_message($1, array['sms'], '', 'Hi {{name}}, beds free!') r", [ids.map((x) => x.id)]))
    expect(r.r).toEqual({ sent: 1, skipped_opted_out_or_hidden: 1 })
  })

  it('reports the funnel and source performance with cost per lead', async () => {
    const camp = await as(db, owner, ({ one: o }) => o(
      "insert into public.campaigns (name, channel, code, property_id) values ('Insta Nov', 'instagram', 'INSTA-NOV', 'P1') returning id"))
    await as(db, owner, ({ q }) => q("select public.add_campaign_spend($1, 3000, current_date, 'Meta')", [camp.id]))
    await as(db, null, ({ q }) => q('select public.submit_enquiry($1)', [{ name: 'Via QR', phone: '9333333333', campaign_code: 'insta-nov' }]))
    const f = await as(db, owner, ({ one: o }) => o('select public.report_lead_funnel(current_date - 1, current_date + 1) r'))
    expect(f.r.enquiries).toBeGreaterThan(3)
    expect(f.r.booked).toBe(1)
    const src = await as(db, owner, ({ q }) => q('select * from public.report_lead_sources(current_date - 1, current_date + 1)'))
    const insta = src.find((s) => s.dimension === 'campaign' && s.name === 'Insta Nov')
    expect(insta).toMatchObject({ leads: 1, spend: 3000 })
    expect(Number(insta.cost_per_lead)).toBe(3000)
    const ex = await as(db, owner, ({ q }) => q('select * from public.report_executives(current_date - 1, current_date + 1)'))
    expect(ex.length).toBeGreaterThan(0)
  })
})

describe('employees and payroll (PRD 10)', () => {
  it('records staff, attendance (manager and GPS self check-in), leave and payroll with advance recovery', async () => {
    const s = await as(db, manager, ({ one: o }) => o(`insert into public.staff_members (user_id, property_id, full_name, designation, basic_pay, allowances,
      overtime_rate, pf_applicable, esi_applicable, joining_date) values ($1, 'P1', 'Raju', 'housekeeping', 12000, 3000, 100, true, true,
      date_trunc('month', current_date)) returning id`, [staffUser]))
    staffId = s.id
    expect((await one('select count(*)::int n from public.salary_revisions where staff_id = $1', [staffId])).n).toBe(1)
    // self check-in: too far away is refused, at the gate is fine
    await expect(as(db, staffUser, ({ q }) => q("select public.staff_check_in(18.60, 73.76, 'x/selfie.jpg')"))).rejects.toThrow(/m from/)
    const ok = await as(db, staffUser, ({ one: o }) => o("select public.staff_check_in(18.5913, 73.7390, $1) r", [`${staffId}/selfie.jpg`]))
    expect(ok.r.distance_m).toBeLessThan(50)
    // leave within balance is approved and lands in attendance
    const l = await as(db, staffUser, ({ one: o }) => o("select public.request_leave(null, 'sick', current_date - 3, current_date - 2, 'Fever') id"))
    await as(db, manager, ({ q }) => q('select public.decide_leave($1, true)', [l.id]))
    expect((await one("select count(*)::int n from public.attendance where staff_id = $1 and status = 'leave'", [staffId])).n).toBe(2)
    await expect(as(db, staffUser, ({ q }) => q("select public.request_leave(null, 'sick', current_date + 1, current_date + 10, 'Long')"))).rejects.toThrow(/left/)
    await as(db, manager, ({ q }) => q("insert into public.salary_advances (staff_id, amount, instalment) values ($1, 5000, 2000)", [staffId]))
    // a full month of attendance so the salary is large enough to recover the instalment
    await db.query(`insert into public.attendance (staff_id, work_date, status) select $1, d::date, 'present'
      from generate_series(date_trunc('month', current_date), current_date, interval '1 day') d on conflict do nothing`, [staffId])
    // payroll refuses to pay while days are unmarked, then pays and books the expense
    const first = new Date(); first.setUTCDate(1)
    const m = first.toISOString().slice(0, 10)
    await as(db, manager, ({ q }) => q("select public.generate_payroll($1, 'P1')", [m]))
    const slip = await one('select * from public.payslips where staff_id = $1', [staffId])
    expect(slip.advance_recovery).toBe(2000)
    expect(slip.pf).toBeGreaterThan(0)
    if (Number(slip.unmarked_days) > 0) {
      await expect(as(db, manager, ({ q }) => q("select public.pay_payslip($1, 'upi', 'UTR9')", [slip.id]))).rejects.toThrow(/unmarked/)
      await db.query(`insert into public.attendance (staff_id, work_date, status) select $1, d::date, 'present'
        from generate_series(date_trunc('month', current_date), current_date, interval '1 day') d on conflict do nothing`, [staffId])
      await as(db, manager, ({ q }) => q("select public.generate_payroll($1, 'P1')", [m]))
    }
    await as(db, manager, ({ q }) => q("select public.pay_payslip($1, 'upi', 'UTR9')", [slip.id]))
    const paid = await one('select status, net, gross, pf, esi from public.payslips where id = $1', [slip.id])
    expect(paid.status).toBe('paid')
    expect(paid.net).toBe(paid.gross - paid.pf - paid.esi - 2000)
    expect((await one('select recovered from public.salary_advances where staff_id = $1', [staffId])).recovered).toBe(2000)
    expect((await one("select amount from public.expenses where source = 'salary' and source_id = $1", [slip.id])).amount).toBe(paid.net + paid.pf + paid.esi)
    // staff see their own paid payslip, not others' bank details
    const mine = await as(db, staffUser, ({ q }) => q('select id from public.payslips'))
    expect(mine.length).toBe(1)
  })

  it('generates role checklists and needs photo proof where required', async () => {
    await as(db, manager, ({ q }) => q("insert into public.task_templates (property_id, designation, title, requires_photo) values ('P1', 'housekeeping', 'Bathroom cleaning', true)"))
    await db.query("delete from public.attendance where staff_id = $1 and work_date = current_date", [staffId])
    await asService(db, ({ q }) => q('select public.generate_daily_tasks()'))
    const t = await one('select id from public.staff_tasks where staff_id = $1', [staffId])
    await expect(as(db, staffUser, ({ q }) => q('select public.complete_task($1)', [t.id]))).rejects.toThrow(/photo/)
    await as(db, staffUser, ({ q }) => q('select public.complete_task($1, $2)', [t.id, `${staffId}/t.jpg`]))
    expect((await one('select done_at is not null d from public.staff_tasks where id = $1', [t.id])).d).toBe(true)
  })
})

describe('reports, dashboard and jobs (PRD 7)', () => {
  it('builds the owner dashboard with occupancy and money', async () => {
    const d = await as(db, owner, ({ one: o }) => o('select public.owner_dashboard() d'))
    expect(d.d.beds.occupied).toBe(2)
    expect(Number(d.d.beds.occupancy_pct)).toBeGreaterThan(0)
    expect(d.d.properties.map((p) => p.id)).toEqual(['P1', 'P2', 'P3'])
    const m = await as(db, manager, ({ one: o }) => o('select public.owner_dashboard() d'))
    expect(m.d.properties.map((p) => p.id)).toEqual(['P1'])
    await expect(as(db, tenant, ({ q }) => q('select public.owner_dashboard()'))).rejects.toThrow(/owner and managers/)
  })

  it('runs every report with filters', async () => {
    const from = '2026-01-01'; const to = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10)
    const reports = [
      ["select * from public.report_occupancy($1, $2, 'P1', 1)", [from, to]],
      ['select * from public.report_rent_collection($1, $2)', [from, to]],
      ["select * from public.report_outstanding('P1')", []],
      ['select * from public.report_expenses($1, $2)', [from, to]],
      ['select * from public.report_profit_loss($1, $2)', [from, to]],
      ['select * from public.report_checkins($1, $2)', [from, to]],
      ['select * from public.report_deposits()', []],
      ['select * from public.report_deposits_held()', []],
      ['select * from public.report_complaints($1, $2)', [from, to]],
      ['select * from public.report_trends()', []],
      ['select public.report_forecast()', []],
      ['select * from public.report_attendance($1, $2)', [from, to]],
      ['select * from public.report_salaries($1, $2)', [from, to]],
      ['select * from public.report_advances()', []],
      ['select * from public.report_leave(2026)', []],
      ['select * from public.report_staff_performance($1, $2)', [from, to]],
      ['select * from public.report_staff_cost($1, $2)', [from, to]],
    ]
    for (const [sql, p] of reports) {
      const rows = await as(db, owner, ({ q }) => q(sql, p))
      expect(Array.isArray(rows), sql).toBe(true)
    }
    const occ = await as(db, owner, ({ q }) => q("select * from public.report_occupancy($1, $2, 'P1', 1)", [from, to]))
    expect(occ.every((r) => r.floor === 1)).toBe(true)
    const pl = await as(db, owner, ({ q }) => q('select * from public.report_profit_loss($1, $2)', [from, to]))
    const all = pl.filter((r) => r.property_id === 'ALL')
    expect(all.length).toBeGreaterThan(0)
    expect(Number(all.at(-1).profit)).toBe(Number(all.at(-1).total_income) - Number(all.at(-1).total_expense))
    const ageing = await as(db, owner, ({ q }) => q("select bucket from public.report_outstanding('P1')"))
    expect(ageing.every((r) => ['0-7', '8-15', '16-30', '30+'].includes(r.bucket))).toBe(true)
  })

  it('runs the scheduled jobs, throttles repeats, and releases expired reservations', async () => {
    const bed = await one("select id from public.beds where room_id = 'dpg-201' order by label limit 1")
    const r = await as(db, manager, ({ one: o }) => o("select public.reserve_bed($1, 'Ghost', null, 500, current_date) id", [bed.id]))
    await db.query('update public.reservations set expires_on = current_date - 1 where id = $1', [r.id])
    const res = await as(db, owner, ({ one: o }) => o('select public.run_scheduled_jobs(true) r'))
    expect(res.r.reservations_released).toBe(1)
    expect((await one('select is_reserved from public.beds where id = $1', [bed.id])).is_reserved).toBe(false)
    const again = await as(db, manager, ({ one: o }) => o('select public.run_scheduled_jobs() r'))
    expect(again.r.skipped).toBe(true)
    await expect(as(db, tenant, ({ q }) => q('select public.run_scheduled_jobs()'))).rejects.toThrow(/Not allowed/)
  })
})
