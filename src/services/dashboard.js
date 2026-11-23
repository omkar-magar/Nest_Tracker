import { ownerDashboard, rows, rpc } from './manage'
import { EMPTY_SUMMARY, registerSummary } from './register'

// The admin dashboard: KPI cards, income vs expenses, expense breakdown, alerts, occupancy, recent activity and
// upcoming bills. Money maths stays in the database RPCs; this file only picks, groups and sorts what they return.

const pad = (n) => String(n).padStart(2, '0')
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const atNoon = (s) => new Date(`${s}T12:00:00`)
export const daysBetween = (from, to) => Math.round((atNoon(to) - atNoon(from)) / 86400000)

// first and last day of this month (offset 0) or an earlier one (offset -1 = last month)
export function monthRange(offset = 0, today = new Date()) {
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const last = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0)
  return { from: ymd(first), to: ymd(last) }
}

// % change from prev to cur; null when there is nothing to compare with
export const pctChange = (cur, prev) => (prev ? Math.round(((cur - prev) / Math.abs(prev)) * 100) : null)

// Expense groups in a fixed order, so a group keeps its colour whatever the amounts are
export const EXPENSE_GROUPS = [
  ['utilities', 'Utilities & water'], ['salaries', 'Staff & salaries'], ['maintenance', 'Repairs & maintenance'],
  ['food', 'Food & kitchen'], ['other', 'Others'],
]
export function expenseBreakdown(list) {
  const approved = list.filter((x) => x.status === 'approved')
  const total = approved.reduce((s, x) => s + Number(x.amount), 0)
  const groups = EXPENSE_GROUPS.map(([grp, name], i) => {
    const amount = approved.filter((x) => (x.grp ?? 'other') === grp).reduce((s, x) => s + Number(x.amount), 0)
    return { grp, name, slot: i + 1, amount, pct: total ? Math.round((amount / total) * 100) : 0 }
  })
  return { total, groups }
}

// next date a recurring expense falls due (day_of_month is 1..28, so every month has it)
export function nextDue(day, today = new Date()) {
  const t = ymd(today)
  const thisMonth = ymd(new Date(today.getFullYear(), today.getMonth(), day))
  return thisMonth >= t ? thisMonth : ymd(new Date(today.getFullYear(), today.getMonth() + 1, day))
}

export function upcomingBills(recurring, payslips, today = new Date()) {
  const t = ymd(today)
  const bills = recurring.map((r) => {
    const due = nextDue(r.day_of_month, today)
    return { id: r.id, name: r.expense_categories?.name ?? 'Bill', grp: r.expense_categories?.grp ?? 'other', vendor: r.vendor,
      amount: Number(r.amount), due, days: daysBetween(t, due) }
  })
  // salaries worked out but not paid yet
  const unpaid = payslips.reduce((s, p) => s + Number(p.net || 0), 0)
  if (payslips.length) bills.push({ id: 'payroll', name: 'Staff salary', grp: 'salaries', vendor: `${payslips.length} payslip${payslips.length > 1 ? 's' : ''}`, amount: unpaid, due: null, days: null })
  return bills.sort((a, b) => (a.days ?? -1) - (b.days ?? -1))
}

// guest register events from register_summary: added, checked out, back again, rent marked paid
const REGISTER_EVENT = {
  INSERT: (r) => ({ kind: 'checkin', text: `${r.name} added to Room ${r.room}` }),
  RETURN: (r) => ({ kind: 'checkin', text: `${r.name} is back in Room ${r.room}` }),
  CHECKOUT: (r) => ({ kind: 'vacant', text: `${r.name} checked out of Room ${r.room}` }),
  PAID: (r) => ({ kind: 'payment', text: `${r.name} (Room ${r.room}) rent marked paid${r.rent ? ` · ₹${Number(r.rent).toLocaleString('en-IN')}` : ''}` }),
}

// newest first, at most `n`; each: { kind, text, at }
export function recentActivities({ payments, checkins, checkouts, complaints, register = [] }, n = 5) {
  const room = (r) => (r ? ` · Room ${r}` : '')
  const list = [
    ...register.filter((r) => REGISTER_EVENT[r.op]).map((r) => ({ ...REGISTER_EVENT[r.op](r), at: r.at })),
    ...payments.map((p) => ({ kind: 'payment', at: p.completed_at, text: `${p.profiles?.full_name ?? 'A tenant'} paid ₹${Number(p.amount).toLocaleString('en-IN')}` })),
    ...checkins.map((b) => ({ kind: 'checkin', at: b.check_in, text: `${b.profiles?.full_name ?? 'A tenant'} checked in${b.rooms?.room_no ? ` to Room ${b.rooms.room_no}` : ''}` })),
    ...checkouts.map((b) => ({ kind: 'vacant', at: b.actual_checkout, text: `${b.rooms?.room_no ? `Room ${b.rooms.room_no}` : 'A bed'} became vacant (${b.profiles?.full_name ?? 'tenant'} left)` })),
    ...complaints.map((c) => ({ kind: 'complaint', at: c.created_at, text: `${c.profiles?.full_name ?? 'Staff'} raised: ${c.title}${room(c.rooms?.room_no)}` })),
  ].filter((a) => a.at)
  return list.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, n)
}

// "2 hours ago"; plain dates (no time) read as days
export function ago(at, now = new Date()) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(at)
  if (dateOnly) {
    const d = daysBetween(at, ymd(now))
    return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`
  }
  const mins = Math.max(0, Math.round((now - new Date(at)) / 60000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`
  const d = Math.round(h / 24)
  return d === 1 ? '1 day ago' : `${d} days ago`
}

// distinct tenants with unpaid bills, and those already past the due date
export function rentDue(outstanding) {
  const tenants = new Set(outstanding.map((o) => o.customer_id))
  const late = new Set(outstanding.filter((o) => o.days_overdue > 0).map((o) => o.customer_id))
  return { tenants: tenants.size, overdueTenants: late.size }
}

// Monthly trend (report_trends: app payments and expenses) with the rent marked paid in the guest register
// added to each month's revenue; `register_rent` keeps that part. Months only the register has are added too.
export function withRegisterRent(trend, months) {
  const key = (m) => String(m).slice(0, 7)
  const reg = Object.fromEntries(months.map((x) => [key(x.month), Number(x.amount) || 0]))
  const byMonth = new Map(trend.map((t) => [key(t.month), { ...t }]))
  for (const x of months) if (!byMonth.has(key(x.month))) byMonth.set(key(x.month), { month: x.month, revenue: 0, expenses: 0 })
  return [...byMonth.keys()].sort().map((k) => {
    const t = byMonth.get(k); const r = reg[k] ?? 0
    return { ...t, revenue: Number(t.revenue ?? 0) + r, register_rent: r }
  })
}

const inProperty =(pid, col = 'property_id') => (q) => (pid ? q.eq(col, pid) : q)

// period: 0 = this month, -1 = last month. Pending rent, beds and alerts are always "now".
export async function loadAdminDashboard(pid, period = 0) {
  const { from, to } = monthRange(period)
  const today = ymd(new Date())
  const [d, reg, regPaid, trend, expenses, outstanding, recurring, payslips, payments, checkins, checkouts, complaints] = await Promise.all([
    ownerDashboard(pid),
    registerSummary(pid),
    rpc('register_rent_paid', { p_property: pid || null, p_months: 6 }),
    rpc('report_trends', { p_property: pid || null, p_months: 6 }),
    rpc('report_expenses', { p_from: from, p_to: to, p_property: pid || null }),
    rpc('report_outstanding', { p_property: pid || null }),
    rows('recurring_expenses', 'id, amount, vendor, day_of_month, property_id, expense_categories(name, grp)',
      (q) => inProperty(pid)(q.eq('active', true)).limit(50)),
    rows('payslips', 'id, net, month, property_id', (q) => inProperty(pid)(q.eq('status', 'draft')).limit(200)),
    // payments has two links to profiles (customer_id, recorded_by), so the embed must name the foreign key
    rows('payments', 'id, amount, completed_at, profiles!payments_customer_id_fkey(full_name), bills!inner(bookings!inner(property_id))',
      (q) => inProperty(pid, 'bills.bookings.property_id')(q.eq('status', 'succeeded').order('completed_at', { ascending: false }).limit(5))),
    rows('bookings', 'id, check_in, rooms(room_no), profiles!bookings_customer_id_fkey(full_name)',
      (q) => inProperty(pid)(q.in('status', ['active', 'completed']).lte('check_in', today).order('check_in', { ascending: false }).limit(5))),
    rows('bookings', 'id, actual_checkout, rooms(room_no), profiles!bookings_customer_id_fkey(full_name)',
      (q) => inProperty(pid)(q.not('actual_checkout', 'is', null).order('actual_checkout', { ascending: false }).limit(5))),
    rows('complaints', 'id, title, created_at, rooms(room_no), profiles!complaints_customer_id_fkey(full_name)',
      (q) => inProperty(pid)(q.order('created_at', { ascending: false }).limit(5))),
  ])
  return {
    d, reg: reg ?? EMPTY_SUMMARY, trend: withRegisterRent(trend ?? [], regPaid?.months ?? []),
    regPaidByWing: Object.fromEntries((regPaid?.properties ?? []).map((p) => [p.id, Number(p.amount)])), breakdown: expenseBreakdown(expenses ?? []), rent: rentDue(outstanding ?? []),
    bills: upcomingBills(recurring ?? [], payslips ?? []),
    activities: recentActivities({ payments: payments ?? [], checkins: checkins ?? [], checkouts: checkouts ?? [], complaints: complaints ?? [], register: reg?.recent ?? [] }),
  }
}
