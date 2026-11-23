import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Load, H3, useScope } from '../../components/manage/kit'
import DataTable from '../../components/manage/DataTable'
import { BarChart } from '../../components/manage/Charts'
import Icon from '../../components/manage/Icon'
import { Notice, inputCls } from '../../components/ui'
import { ago, loadAdminDashboard, pctChange } from '../../services/dashboard'
import { departures, withRegister } from '../../services/register'
import { formatDate, rupees } from '../../services/format'

// PRD 7.1: this month's money, income vs expenses, where the money went, what needs attention, occupancy,
// recent activity and bills coming up; then the wing-by-wing table and upcoming stays.
const card = 'rounded-2xl border border-navy/10 bg-white p-4 shadow-sm'
const monthName = (m) => new Date(m).toLocaleDateString('en-IN', { month: 'short' })

function PanelHead({ icon, title, to, link = 'View all', badge }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 font-semibold">
        <Icon name={icon} className="h-5 w-5 text-chart-1" />{title}
        {badge > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-red-700 px-1 text-xs font-bold text-white">{badge}</span>}
      </h3>
      {to && (
        <Link to={to} className="flex items-center gap-1 rounded-full bg-chart-1/10 px-3 py-1 text-xs font-semibold text-navy hover:bg-chart-1/20 focus-visible:outline-2 focus-visible:outline-navy">
          {link}<Icon name="arrow" className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  )
}

// tiny trend line, decorative (the numbers are in the Income vs expenses chart)
function Sparkline({ values }) {
  if (values.length < 2) return null
  const W = 96; const H = 36; const max = Math.max(...values); const min = Math.min(...values); const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 3 - ((v - min) / span) * (H - 6)])
  const line = pts.map((p) => p.join(',')).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-24 shrink-0" aria-hidden="true">
      <polygon points={`0,${H} ${line} ${W},${H}`} fill="currentColor" opacity="0.12" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

const TONES = {
  1: { box: 'bg-chart-1/10 border-chart-1/20', icon: 'bg-chart-1', line: 'text-chart-1' },
  2: { box: 'bg-chart-2/10 border-chart-2/20', icon: 'bg-chart-2', line: 'text-chart-2' },
  3: { box: 'bg-chart-3/10 border-chart-3/20', icon: 'bg-chart-3', line: 'text-chart-3' },
  5: { box: 'bg-chart-5/10 border-chart-5/20', icon: 'bg-chart-5', line: 'text-chart-5' },
}

function Kpi({ tone, icon, label, value, change, upIsGood = true, hint, spark = [], periodLabel }) {
  const t = TONES[tone]
  const good = change == null ? null : (change >= 0) === upIsGood
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${t.box}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-white ${t.icon}`}><Icon name={icon} className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-700">{label}</p>
          <p className="text-2xl font-bold text-navy">{value}</p>
          {change != null
            ? <p className={`text-xs font-semibold ${good ? 'text-green-800' : 'text-red-700'}`}>{change >= 0 ? '↑' : '↓'} {Math.abs(change)}% <span className="font-normal text-slate-600">vs last month</span></p>
            : <p className="text-xs text-slate-600">{hint ?? periodLabel}</p>}
        </div>
        <span className={t.line}><Sparkline values={spark} /></span>
      </div>
    </div>
  )
}

// expense groups as a ring, 2px gaps between segments; hovering a segment or legend row shows it in the middle
function ExpenseDonut({ breakdown }) {
  const [hover, setHover] = useState(null)
  const parts = breakdown.groups.filter((g) => g.amount > 0)
  const R = 52; const C = 2 * Math.PI * R; const gap = parts.length > 1 ? 2 : 0
  let offset = 0
  const shown = hover == null ? null : parts.find((p) => p.grp === hover)
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 140 140" className="h-40 w-40 -rotate-90" aria-hidden="true">
          <circle cx="70" cy="70" r={R} fill="none" stroke="currentColor" strokeWidth="20" className="text-navy/5" />
          {parts.map((p) => {
            const len = (p.amount / breakdown.total) * C
            const seg = (
              <circle key={p.grp} cx="70" cy="70" r={R} fill="none" stroke={`var(--color-chart-${p.slot})`} strokeWidth={hover === p.grp ? 24 : 20}
                strokeDasharray={`${Math.max(len - gap, 0.5)} ${C}`} strokeDashoffset={-offset}
                onMouseEnter={() => setHover(p.grp)} onMouseLeave={() => setHover(null)} />
            )
            offset += len
            return seg
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center" role="status">
          <div>
            <p className="text-lg font-bold">{rupees(shown ? shown.amount : breakdown.total)}</p>
            <p className="text-xs text-slate-600">{shown ? shown.name : 'Total'}</p>
          </div>
        </div>
      </div>
      <ul className="w-full space-y-2 text-sm">
        {breakdown.groups.map((g) => (
          <li key={g.grp} className="flex items-center gap-2" onMouseEnter={() => setHover(g.grp)} onMouseLeave={() => setHover(null)}>
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(--color-chart-${g.slot})` }} />
            <span className="flex-1 text-slate-700">{g.name}</span>
            <span className="text-xs text-slate-600">{rupees(g.amount)}</span>
            <span className="w-9 text-right font-semibold">{g.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Alert({ to, icon, tint, title, line, urgent }) {
  return (
    <li>
      <Link to={to} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-navy ${tint}`}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white"><Icon name={icon} className={`h-5 w-5 ${urgent ? 'text-red-700' : 'text-navy'}`} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className={`block text-xs font-medium ${urgent ? 'text-red-700' : 'text-slate-600'}`}>{line}</span>
        </span>
        <Icon name="chevron" className="h-4 w-4 text-slate-500" />
      </Link>
    </li>
  )
}

function OccupancyRing({ pct }) {
  const R = 56; const C = 2 * Math.PI * R
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90" aria-hidden="true">
        <circle cx="70" cy="70" r={R} fill="none" stroke="currentColor" strokeWidth="14" className="text-chart-3/15" />
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-chart-3)" strokeWidth="14" strokeLinecap="round"
          strokeDasharray={`${(Math.min(pct, 100) / 100) * C} ${C}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><p className="text-2xl font-bold">{Math.round(pct)}%</p><p className="text-xs text-slate-600">Occupancy</p></div>
      </div>
    </div>
  )
}

const ACTIVITY = {
  payment: { icon: 'rupee', cls: 'bg-chart-3/15 text-chart-3', dot: 'bg-chart-3' },
  checkin: { icon: 'doc', cls: 'bg-chart-1/15 text-chart-1', dot: 'bg-chart-1' },
  complaint: { icon: 'wrench', cls: 'bg-chart-2/15 text-gold-deep', dot: 'bg-chart-2' },
  vacant: { icon: 'bed', cls: 'bg-chart-4/15 text-chart-4', dot: 'bg-chart-4' },
}
const BILL_ICON = { utilities: 'bolt', salaries: 'users', maintenance: 'wrench', food: 'food', other: 'receipt' }
const billIcon = (b) => (/water/i.test(b.name) ? 'drop' : /internet|wi-?fi/i.test(b.name) ? 'wifi' : BILL_ICON[b.grp] ?? 'receipt')

function DueChip({ days }) {
  if (days == null) return <span className="rounded-full bg-chart-2/15 px-2.5 py-0.5 text-xs font-semibold text-gold-deep">Not paid yet</span>
  if (days === 0) return <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Due today</span>
  return <span className="rounded-full bg-chart-1/10 px-2.5 py-0.5 text-xs font-semibold text-navy">Due in {days} day{days > 1 ? 's' : ''}</span>
}

// "4 guests in the register (1 part paid)", plus app tenants with unpaid bills when there are any
function pendingHint(r, rent, m) {
  const due = Number(r.rent_pending_guests ?? 0); const part = Number(r.rent_partial_guests ?? 0)
  const parts = [`${due + part} guest${due + part === 1 ? '' : 's'}${part ? ` (${part} part paid)` : ''}`]
  if (rent.tenants) parts.push(`${rent.tenants} app tenant${rent.tenants === 1 ? '' : 's'}`)
  if (m.overdue) parts.push(`${rupees(m.overdue)} overdue`)
  return parts.join(' · ')
}

const ACTIONS = [
  ['/admin/register', 'userPlus', 'Add guest', 'bg-chart-1 text-white hover:bg-chart-1/90'],
  ['/admin/expenses', 'plus', 'Add expense', 'bg-chart-1/10 text-navy hover:bg-chart-1/20'],
  ['/admin/billing', 'card', 'Record payment', 'bg-chart-3/15 text-navy hover:bg-chart-3/25'],
  ['/admin/complaints?new=1', 'wrench', 'Raise maintenance', 'bg-chart-4/15 text-navy hover:bg-chart-4/25'],
  ['/admin/tenants?new=1', 'userPlus', 'Add tenant', 'bg-chart-1/10 text-navy hover:bg-chart-1/20'],
  ['/admin/reports', 'doc', 'View reports', 'bg-chart-2/15 text-navy hover:bg-chart-2/25'],
]

export default function Dashboard() {
  const { property } = useScope()
  const { profile } = useAuth()
  const [period, setPeriod] = useState(0)
  const first = (profile?.full_name ?? '').trim().split(/\s+/)[0]
  const periodLabel = period === 0 ? 'This month' : 'Last month'

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="text-3xl">👋</span>
          <div>
            <h2 className="text-xl font-bold sm:text-2xl">Welcome back{first ? `, ${first}` : ''}!</h2>
            <p className="text-sm text-slate-600">Here's what's happening at your PG today.</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Icon name="calendar" className="h-5 w-5 text-navy" />
          <span className="sr-only">Period</span>
          <select className={`${inputCls} !w-auto !rounded-full !py-1.5`} value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
            <option value={0}>This month</option><option value={-1}>Last month</option>
          </select>
        </label>
      </div>

      <Load loader={() => loadAdminDashboard(property, period)} deps={[property, period]}>
        {({ d, reg, regPaidByWing, trend, breakdown, rent, bills, activities }) => {
          if (!d) return <Notice>No data yet. Add a property and rooms to get started.</Notice>
          const b = d.beds ?? {}; const m = d.money ?? {}; const c = d.complaints ?? {}
          // r: the guest register, where the PG's current guests and their rent status are kept
          const r = reg.totals ?? {}
          const regDue = Number(r.rent_pending_guests ?? 0) + Number(r.rent_partial_guests ?? 0)
          // trend runs oldest -> this month; `period` steps back from the end
          const at = (i) => trend[trend.length - 1 + period + i]
          const cur = at(0); const prev = at(-1)
          const revenue = Number(cur?.revenue ?? m.collected ?? 0)
          const spent = Number(cur?.expenses ?? m.expenses ?? 0)
          const net = revenue - spent
          const upto = trend.slice(0, trend.length + period)
          const week = new Date(); week.setDate(week.getDate() + 7)
          const leaving = (d.upcoming_checkouts ?? []).filter((x) => new Date(x.date) <= week).length + Number(r.leaving_week ?? 0)
          const utilities = bills.filter((x) => x.grp === 'utilities' && x.days != null && x.days <= 7).length
          const rentAlert = regDue + rent.overdueTenants
          const alerts = [rentAlert, leaving, utilities, c.open ?? 0]

          // this month: app payments + rent marked paid in the register
          const wingRevenue = (w) => Number(w.revenue ?? 0) + (regPaidByWing[w.id] ?? 0)
          const regRent = Number(cur?.register_rent ?? 0)
          // share of the register's monthly rent marked paid; the app's own figure when the wing has no register rent
          const collection = (w) => (Number(w.reg?.rent_roll) > 0 ? Math.round((Number(w.reg.rent_paid ?? 0) / Number(w.reg.rent_roll)) * 100) : w.collection_efficiency)
          const compare = (
            <>
              <H3>{property ? 'Compare wings' : 'Wing by wing'}</H3>
              {!property && <p className="mb-3 rounded-2xl border border-navy/10 bg-cream px-4 py-3 text-sm">Grand total: the table shows each wing on its own, and the figures above add all wings together. Pick a wing at the top to see only that wing.</p>}
              <DataTable title="Wing by wing" search={false} rows={withRegister(d.properties, reg)} columns={[
                { key: 'name', label: 'Wing', value: (r) => r.name },
                { key: 'guests', label: 'Guests', render: (r) => r.reg.guests ?? 0, value: (r) => Number(r.reg.guests ?? 0) },
                { key: 'rooms', label: 'Rooms occupied', render: (r) => `${r.reg.rooms_occupied ?? 0}/${r.reg.rooms_total ?? 0} (${r.reg.occupancy_pct ?? 0}%)`, value: (r) => Number(r.reg.occupancy_pct ?? 0) },
                { key: 'mix', label: 'PG · rented · empty', render: (r) => `${r.reg.pg_rooms ?? 0} · ${r.reg.rented_rooms ?? 0} · ${r.reg.empty_rooms ?? 0}`, value: (r) => Number(r.reg.empty_rooms ?? 0) },
                { key: 'rent_roll', label: 'Monthly rent', render: (r) => rupees(r.reg.rent_roll), value: (r) => Number(r.reg.rent_roll ?? 0) },
                { key: 'revenue', label: 'Revenue', render: (r) => rupees(wingRevenue(r)), value: (r) => wingRevenue(r) },
                { key: 'expenses', label: 'Expenses', render: (r) => rupees(r.expenses), value: (r) => Number(r.expenses ?? 0) },
                { key: 'profit', label: 'Profit', render: (r) => rupees(wingRevenue(r) - Number(r.expenses ?? 0)), value: (r) => wingRevenue(r) - Number(r.expenses ?? 0) },
                { key: 'pending', label: 'Pending rent', render: (r) => rupees(Number(r.pending ?? 0) + Number(r.reg.rent_pending ?? 0)), value: (r) => Number(r.pending ?? 0) + Number(r.reg.rent_pending ?? 0) },
                { key: 'complaints_open', label: 'Open complaints', render: (r) => `${r.complaints_open}${r.complaints_overdue ? ` (${r.complaints_overdue} overdue)` : ''}`, value: (r) => r.complaints_open },
                { key: 'collection_efficiency', label: 'Collection', render: (r) => (collection(r) == null ? '—' : `${collection(r)}%`), value: (r) => Number(collection(r) ?? 0) },
              ]} />
            </>
          )

          return (
            <>
              <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi tone={1} icon="rupee" label="Total revenue" value={rupees(revenue)} change={pctChange(revenue, Number(prev?.revenue ?? 0))}
                  spark={upto.map((t) => Number(t.revenue))} periodLabel={periodLabel}
                  hint={regRent ? `${periodLabel} · ${rupees(regRent)} marked paid in register` : undefined} />
                <Kpi tone={5} icon="receipt" label="Total expenses" value={rupees(spent)} upIsGood={false} change={pctChange(spent, Number(prev?.expenses ?? 0))}
                  spark={upto.map((t) => Number(t.expenses))} periodLabel={periodLabel} />
                <Kpi tone={3} icon="trend" label="Net income" value={rupees(net)} change={pctChange(net, prev ? Number(prev.revenue) - Number(prev.expenses) : 0)}
                  spark={upto.map((t) => Number(t.revenue) - Number(t.expenses))} periodLabel={periodLabel} />
                <Kpi tone={2} icon="clock" label="Pending rent" value={rupees(Number(m.pending ?? 0) + Number(r.rent_pending ?? 0))}
                  hint={pendingHint(r, rent, m)} />
              </section>

              <div className="mt-4 grid gap-4 lg:grid-cols-12">
                <div className="lg:col-span-5">
                  {trend.length > 0 ? (
                    <BarChart title="Income vs expenses" height={240}
                      action={<Link to="/admin/reports" className="flex items-center gap-1 rounded-full bg-chart-1/10 px-3 py-1 text-xs font-semibold hover:bg-chart-1/20 focus-visible:outline-2 focus-visible:outline-navy">View report<Icon name="arrow" className="h-3.5 w-3.5" /></Link>}
                      data={trend.map((t) => ({ label: monthName(t.month), income: Number(t.revenue), expense: Number(t.expenses) }))}
                      series={[{ key: 'income', label: 'Income' }, { key: 'expense', label: 'Expenses' }]} />
                  ) : <div className={card}><p className="text-sm text-slate-600">No income or expenses recorded yet.</p></div>}
                </div>

                <section className={`${card} lg:col-span-4`} aria-label="Expense breakdown">
                  <PanelHead icon="pie" title="Expense breakdown" to="/admin/expenses" link="View details" />
                  {breakdown.total > 0 ? <ExpenseDonut breakdown={breakdown} />
                    : <p className="text-sm text-slate-600">No approved expenses for {periodLabel.toLowerCase()}.</p>}
                </section>

                <section className={`${card} lg:col-span-3`} aria-label="Quick alerts">
                  <PanelHead icon="bell" title="Quick alerts" badge={alerts.filter(Boolean).length} />
                  <ul className="space-y-2">
                    <Alert to={regDue || !rent.overdueTenants ? '/admin/register' : '/admin/billing'} icon="alert" tint="border-red-200 bg-red-50" title="Rent pending" urgent={rentAlert > 0}
                      line={`${rentAlert} guest${rentAlert === 1 ? '' : 's'}${rent.overdueTenants ? ` · ${rent.overdueTenants} overdue in billing` : ''}`} />
                    <Alert to="/admin/register" icon="calendar" tint="border-chart-2/25 bg-chart-2/10" title="Upcoming check-outs"
                      line={`${leaving} guest${leaving === 1 ? '' : 's'} in 7 days`} />
                    <Alert to="/admin/expenses" icon="doc" tint="border-chart-1/20 bg-chart-1/10" title="Upcoming utility bills"
                      line={`${utilities} bill${utilities === 1 ? '' : 's'} in 7 days`} />
                    <Alert to="/admin/complaints" icon="wrench" tint="border-chart-4/25 bg-chart-4/10" title="Pending maintenance" urgent={(c.overdue ?? 0) > 0}
                      line={`${c.open ?? 0} request${c.open === 1 ? '' : 's'}${c.overdue ? ` · ${c.overdue} overdue` : ''}`} />
                  </ul>
                </section>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <section className={card} aria-label="Occupancy overview">
                  <PanelHead icon="bed" title="Occupancy overview" to="/admin/register" link="Guest register" />
                  <div className="flex flex-wrap items-center gap-5">
                    <OccupancyRing pct={Number(r.occupancy_pct ?? 0)} />
                    <dl className="space-y-3">
                      {[['users', 'Guests staying', r.guests], ['bed', 'Rooms occupied', `${r.rooms_occupied ?? 0}/${r.rooms_total ?? 0}`], ['bed', 'Empty rooms', r.empty_rooms]].map(([icon, k, v]) => (
                        <div key={k} className="flex items-center gap-3">
                          <span className="grid h-9 w-9 place-items-center rounded-xl bg-chart-1/10 text-chart-1"><Icon name={icon} /></span>
                          <div className="flex flex-col-reverse"><dt className="text-xs text-slate-600">{k}</dt><dd className="text-lg font-bold leading-tight">{v ?? 0}</dd></div>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <p className="mt-3 text-xs text-slate-600">
                    {r.pg_rooms ?? 0} PG rooms ({r.pg_people ?? 0} sharing) · {r.rented_rooms ?? 0} rented
                    {(r.checkins_month > 0 || r.checkouts_month > 0) && ` · this month ${r.checkins_month ?? 0} in, ${r.checkouts_month ?? 0} out`}
                  </p>
                  {b.occupied > 0 && (
                    <p className="mt-1 text-xs text-slate-600">
                      <Link to="/admin/beds" className="underline focus-visible:outline-2 focus-visible:outline-navy">Bed board</Link>: {b.occupied} of {b.total} beds booked in the app{b.reserved ? ` · ${b.reserved} reserved` : ''}
                    </p>
                  )}
                </section>

                <section className={card} aria-label="Recent activities">
                  <PanelHead icon="bolt" title="Recent activities" to="/admin/register" />
                  {activities.length === 0 ? <p className="text-sm text-slate-600">Nothing yet.</p> : (
                    <ol className="relative space-y-3 border-l-2 border-navy/10 pl-5">
                      {activities.map((a, i) => {
                        const s = ACTIVITY[a.kind]
                        return (
                          <li key={i} className="relative flex items-start gap-3">
                            <span aria-hidden="true" className={`absolute -left-[1.6rem] top-3 h-2.5 w-2.5 rounded-full ring-2 ring-white ${s.dot}`} />
                            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${s.cls}`}><Icon name={s.icon} className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{a.text}</p>
                              <p className="text-xs text-slate-600">{ago(a.at)}</p>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </section>

                <section className={card} aria-label="Upcoming bills and payments">
                  <PanelHead icon="calendar" title="Upcoming bills & payments" to="/admin/expenses" />
                  {bills.length === 0 ? <p className="text-sm text-slate-600">No recurring bills set up. Add them under Expenses → Recurring.</p> : (
                    <ul className="divide-y divide-navy/5">
                      {bills.slice(0, 5).map((x) => (
                        <li key={x.id} className="flex items-center gap-3 py-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-chart-1/10 text-chart-1"><Icon name={billIcon(x)} className="h-4 w-4" /></span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{x.name}</p>
                            {x.vendor && <p className="truncate text-xs text-slate-600">{x.vendor}</p>}
                          </div>
                          <DueChip days={x.days} />
                          <span className="w-20 text-right text-sm font-bold">{rupees(x.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <nav aria-label="Quick actions" className="mt-5 flex flex-wrap gap-3">
                {ACTIONS.map(([to, icon, text, cls]) => (
                  <Link key={to} to={to} className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${cls}`}>
                    <Icon name={icon} className="h-4 w-4" />{text}
                  </Link>
                ))}
              </nav>

              {compare}

              <div className="mt-2 grid gap-6 lg:grid-cols-2">
                <div>
                  <H3>Upcoming check-ins and reservations</H3>
                  <DataTable title="Upcoming check-ins" search={false} rows={d.upcoming_checkins ?? []} empty="None scheduled" columns={[
                    { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
                    { key: 'name', label: 'Name' }, { key: 'bed', label: 'Bed / room' },
                    { key: 'kind', label: 'Type', render: (r) => (r.kind === 'reservation' ? `Reserved · ${rupees(r.advance)} advance` : 'Booking') },
                  ]} />
                </div>
                <div>
                  <H3>Upcoming check-outs (next 45 days)</H3>
                  <DataTable title="Upcoming check-outs" search={false} rows={departures(d.upcoming_checkouts, reg.leaving)} empty="Nobody is leaving soon" columns={[
                    { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
                    { key: 'name', label: 'Guest', value: (r) => r.name,
                      render: (r) => (r.customer_id ? <Link className="underline" to={`/admin/tenants/${r.customer_id}`}>{r.name}</Link> : r.name) },
                    { key: 'room', label: 'Room' },
                    { key: 'notice_date', label: 'Notice given', render: (r) => (r.source === 'register' ? 'Guest register' : formatDate(r.notice_date)) },
                  ]} />
                </div>
              </div>
            </>
          )
        }}
      </Load>
    </div>
  )
}
