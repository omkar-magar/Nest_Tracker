import { Link } from 'react-router-dom'
import { Load, H3, useScope } from '../../components/manage/kit'
import DataTable from '../../components/manage/DataTable'
import { BarChart } from '../../components/manage/Charts'
import { Notice, Stat } from '../../components/ui'
import { ownerDashboard, rpc } from '../../services/manage'
import { formatDate, rupees } from '../../services/format'

// PRD 7.1: beds and occupancy, this month's money, check-ins / check-outs, property comparison, trend.
export default function Dashboard() {
  const { property } = useScope()
  return (
    <Load loader={() => Promise.all([ownerDashboard(property), rpc('report_trends', { p_property: property || null, p_months: 12 })])} deps={[property]}>
      {([d, trend]) => {
        if (!d) return <Notice>No data yet. Add a property and rooms to get started.</Notice>
        const b = d.beds ?? {}; const m = d.money ?? {}; const c = d.complaints ?? {}
        return (
          <div>
            <H3>Beds</H3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="Total beds" value={b.total ?? 0} />
              <Stat label="Occupied" value={b.occupied ?? 0} />
              <Stat label="Vacant" value={b.vacant ?? 0} />
              <Stat label="Reserved" value={b.reserved ?? 0} hint={b.maintenance ? `${b.maintenance} under maintenance` : undefined} />
              <Stat label="Occupancy" value={`${b.occupancy_pct ?? 0}%`} />
            </div>

            <H3>This month</H3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <Stat label="Rent billed" value={rupees(m.billed)} />
              <Stat label="Collected" value={rupees(m.collected)} hint={m.collection_efficiency != null ? `${m.collection_efficiency}% of this month's bills` : undefined} />
              <Stat label="Pending rent" value={rupees(m.pending)} />
              <Stat label="Overdue" value={rupees(m.overdue)} tone={m.overdue ? 'red' : undefined} />
              <Stat label="Expenses" value={rupees(m.expenses)} />
              <Stat label="Net operating profit" value={rupees(m.net_profit)} tone={m.net_profit < 0 ? 'red' : undefined} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Check-ins this month" value={d.checkins_month ?? 0} />
              <Stat label="Check-outs this month" value={d.checkouts_month ?? 0} />
              <Stat label="Open complaints" value={c.open ?? 0} hint={c.overdue ? `${c.overdue} overdue` : undefined} tone={c.overdue ? 'red' : undefined} />
              <Stat label="Resolved this month" value={c.resolved_this_month ?? 0} />
            </div>

            {trend?.length > 0 && (
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <BarChart title="Income vs expenses, last 12 months" data={trend.map((t) => ({ label: new Date(t.month).toLocaleDateString('en-IN', { month: 'short' }), income: Number(t.revenue), expense: Number(t.expenses) }))}
                  series={[{ key: 'income', label: 'Income collected' }, { key: 'expense', label: 'Expenses' }]} />
                <BarChart title="Occupancy %, last 12 months" money={false} data={trend.map((t) => ({ label: new Date(t.month).toLocaleDateString('en-IN', { month: 'short' }), occ: Number(t.occupancy_pct || 0) }))}
                  series={[{ key: 'occ', label: 'Occupancy %' }]} />
              </div>
            )}

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
                <DataTable title="Upcoming check-outs" search={false} rows={d.upcoming_checkouts ?? []} empty="Nobody is leaving soon" columns={[
                  { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
                  { key: 'name', label: 'Tenant', render: (r) => <Link className="underline" to={`/admin/tenants/${r.customer_id}`}>{r.name}</Link>, value: (r) => r.name },
                  { key: 'room', label: 'Room' },
                  { key: 'notice_date', label: 'Notice given', render: (r) => formatDate(r.notice_date) },
                ]} />
              </div>
            </div>

            <H3>Property comparison</H3>
            <DataTable title="Property comparison" search={false} rows={d.properties ?? []} columns={[
              { key: 'name', label: 'Property', value: (r) => `${r.id} · ${r.name}` },
              { key: 'occupancy_pct', label: 'Occupancy', render: (r) => `${r.occupancy_pct}% (${r.occupied}/${r.beds})`, value: (r) => Number(r.occupancy_pct) },
              { key: 'revenue', label: 'Revenue', render: (r) => rupees(r.revenue), value: (r) => Number(r.revenue) },
              { key: 'expenses', label: 'Expenses', render: (r) => rupees(r.expenses), value: (r) => Number(r.expenses) },
              { key: 'profit', label: 'Profit', render: (r) => rupees(r.profit), value: (r) => Number(r.profit) },
              { key: 'pending', label: 'Pending rent', render: (r) => rupees(r.pending), value: (r) => Number(r.pending) },
              { key: 'complaints_open', label: 'Open complaints', render: (r) => `${r.complaints_open}${r.complaints_overdue ? ` (${r.complaints_overdue} overdue)` : ''}`, value: (r) => r.complaints_open },
              { key: 'collection_efficiency', label: 'Collection', render: (r) => (r.collection_efficiency == null ? '—' : `${r.collection_efficiency}%`), value: (r) => Number(r.collection_efficiency ?? 0) },
            ]} />
          </div>
        )
      }}
    </Load>
  )
}
