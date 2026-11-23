import { rows as query, rpc } from './manage'
import { withRegisterRent } from './dashboard'
import { guestKey, guestsByRoom, loadStayingGuests, registerSummary } from './register'

// Reports that also count the guest register, where most current guests and their rent are kept. The report RPCs
// cover app bookings and bills only; these helpers add the register's figures the same way the dashboard does.

const monthKey = (m) => String(m).slice(0, 7)
// months from `from` up to this month, inclusive (what register_rent_paid needs to reach back that far)
export function monthsSince(from, today = new Date()) {
  const [y, mo] = String(from).split('-').map(Number)
  return Math.min(36, Math.max(1, (today.getFullYear() - y) * 12 + (today.getMonth() + 1 - mo) + 1))
}

// P&L rows (one per month per wing plus an 'ALL' row per month) with register rent added to rent, income and
// profit. regByWing: { P1: [{ month, amount }] }. Months only the register has get rows too.
export function withRegisterPL(rows = [], regByWing = {}, from = '0000-01', to = '9999-12') {
  const inRange = (m) => monthKey(m) >= monthKey(from) && monthKey(m) <= monthKey(to)
  const zero = { rent: 0, charges: 0, late_fees: 0, deposits_kept: 0, other_income: 0, total_income: 0, utilities: 0, salaries: 0,
    maintenance: 0, food: 0, other_expense: 0, total_expense: 0, profit: 0 }
  const wings = new Map()
  for (const r of rows.filter((x) => x.property_id !== 'ALL')) wings.set(`${monthKey(r.month)}|${r.property_id}`, { ...r, register_rent: 0 })
  for (const [pid, months] of Object.entries(regByWing)) {
    for (const x of months ?? []) {
      const amount = Number(x.amount) || 0
      if (!amount || !inRange(x.month)) continue
      const k = `${monthKey(x.month)}|${pid}`
      const r = wings.get(k) ?? { ...zero, month: `${monthKey(x.month)}-01`, property_id: pid, register_rent: 0 }
      wings.set(k, { ...r, register_rent: r.register_rent + amount, rent: Number(r.rent) + amount,
        total_income: Number(r.total_income) + amount, profit: Number(r.profit) + amount })
    }
  }
  const list = [...wings.values()]
  const totals = new Map()
  for (const r of list) {
    const k = monthKey(r.month)
    const t = totals.get(k) ?? { ...zero, month: r.month, property_id: 'ALL', register_rent: 0 }
    for (const f of [...Object.keys(zero), 'register_rent']) t[f] = Number(t[f]) + Number(r[f] ?? 0)
    totals.set(k, t)
  }
  return [...list, ...totals.values()].sort((a, b) => monthKey(a.month).localeCompare(monthKey(b.month))
    || (a.property_id === 'ALL') - (b.property_id === 'ALL') || String(a.property_id).localeCompare(String(b.property_id)))
}

// 12-month trends with register rent in revenue and profit
export const withRegisterTrends = (trend = [], months = []) =>
  withRegisterRent(trend, months).map((t) => ({ ...t, profit: Number(t.revenue) - Number(t.expenses ?? 0) }))

// occupancy rows (by room_id) with the number of register guests in each room
export function withRegisterOccupancy(rows = [], rooms = [], guests = []) {
  const by = guestsByRoom(guests)
  const room = Object.fromEntries(rooms.map((r) => [r.id, r]))
  return rows.map((r) => ({ ...r, register_guests: room[r.room_id] ? (by[guestKey(room[r.room_id])] ?? []).length : 0 }))
}

// Room-wise rent for this month: app bills (report_rent_collection rows, deposits left out) plus register guests.
// Register rent counts as collected when marked paid and as due when pending or part paid (amount paid unknown).
export function roomRent(rooms = [], bills = [], guests = []) {
  const by = guestsByRoom(guests)
  return rooms.map((r) => {
    const mine = bills.filter((b) => b.room_id === r.id && b.kind !== 'deposit')
    const reg = by[guestKey(r)] ?? []
    const regRent = (pred) => reg.filter(pred).reduce((s, g) => s + (Number(g.rent) || 0), 0)
    const beds = (r.beds ?? []).filter((b) => b.is_active)
    return {
      id: r.id, room: `${r.property_id} · ${r.wing ? `${r.wing}-` : ''}${r.room_no}`, beds: beds.length,
      rent_per_bed: beds.map((b) => b.rent ?? r.price).join(' / '),
      tenants: [...new Set([...mine.map((b) => b.tenant), ...reg.map((g) => g.name)])].join(', '),
      expected: mine.reduce((s, b) => s + Number(b.billed), 0) + regRent(() => true),
      collected: mine.reduce((s, b) => s + Number(b.collected), 0) + regRent((g) => g.rent_status === 'paid'),
      due: mine.reduce((s, b) => s + Number(b.outstanding), 0) + regRent((g) => g.rent_status === 'pending' || g.rent_status === 'partially_paid'),
      unknown: reg.filter((g) => !['paid', 'pending', 'partially_paid'].includes(g.rent_status)).length,
    }
  })
}

// one row per wing, plus the grand total when more than one wing is shown
export function registerReportRows(summary) {
  const per = (summary?.properties ?? []).map((p) => ({ ...p, wing: p.name ?? p.id }))
  if (per.length > 1) per.push({ ...summary.totals, id: 'ALL', wing: 'All wings (total)' })
  return per
}

// ---------------------------------------------------------------- loaders (the Reports page calls these)
export async function loadPL(args, wings) {
  const months = monthsSince(args.p_from)
  const [rows, ...reg] = await Promise.all([
    rpc('report_profit_loss', args),
    ...wings.map((pid) => rpc('register_rent_paid', { p_property: pid, p_months: months })),
  ])
  return withRegisterPL(rows ?? [], Object.fromEntries(wings.map((pid, i) => [pid, reg[i]?.months ?? []])), args.p_from, args.p_to)
}
export async function loadTrends(args) {
  const [rows, reg] = await Promise.all([rpc('report_trends', args), rpc('register_rent_paid', { p_property: args.p_property, p_months: args.p_months })])
  return withRegisterTrends(rows ?? [], reg?.months ?? [])
}
export async function loadOccupancy(args) {
  const [rows, rooms, guests] = await Promise.all([
    rpc('report_occupancy', args),
    query('rooms', 'id, property_id, wing, room_no', (q) => (args.p_property ? q.eq('property_id', args.p_property) : q)),
    loadStayingGuests(args.p_property),
  ])
  return withRegisterOccupancy(rows ?? [], rooms, guests ?? [])
}
export const loadRegisterReport = (args) => registerSummary(args.p_property).then(registerReportRows)
