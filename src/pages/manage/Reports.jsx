import { useState } from 'react'
import DataTable from '../../components/manage/DataTable'
import { H3, Load, useScope } from '../../components/manage/kit'
import { BarChart, HBarChart } from '../../components/manage/Charts'
import { Field, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { label, monthStart, ymd } from '../../services/pg'
import { loadOccupancy, loadPL, loadRegisterReport, loadTrends } from '../../services/reports'
import { formatDate, rupees } from '../../services/format'

const money = (k, l) => ({ key: k, label: l, render: (r) => rupees(r[k]), value: (r) => Number(r[k] ?? 0) })
const date = (k, l) => ({ key: k, label: l, render: (r) => formatDate(r[k]), value: (r) => r[k] })
const col = (k, l, fn) => ({ key: k, label: l, ...(fn ? { value: fn } : {}) })
const mon = (r) => new Date(r.month).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })

// filters each report understands: d = dates, f = floor, r = room, t = tenant (property comes from the switcher).
// `load` replaces the plain RPC call where the guest register's figures are added (services/reports.js).
const REPORTS = [
  { key: 'register', name: 'Guest register by wing', fl: '', load: loadRegisterReport, args: (x) => ({ p_property: x.p }),
    note: 'Current guests and rent as kept in the guest register (rooms with 1 guest count as rented, 2 or more as PG).',
    columns: [col('wing', 'Wing'), col('guests', 'Guests'), col('rooms_occupied', 'Rooms occupied'), col('rooms_total', 'Rooms'), col('occupancy_pct', 'Occupancy %'),
      col('pg_rooms', 'PG rooms'), col('pg_people', 'PG guests'), col('rented_rooms', 'Rented rooms'), col('empty_rooms', 'Empty rooms'),
      money('rent_roll', 'Monthly rent'), money('rent_paid', 'Rent paid'), money('rent_pending', 'Rent pending'), col('rent_pending_guests', 'Guests pending'),
      col('rent_partial_guests', 'Part paid'), money('deposit_held', 'Deposits held'), col('checkins_month', 'Check-ins this month'),
      col('checkouts_month', 'Check-outs this month'), col('leaving_week', 'Leaving in 7 days')] },
  { key: 'occupancy', name: 'Occupancy', fl: 'dfr', load: loadOccupancy, args: (x) => ({ p_from: x.from, p_to: x.to, p_property: x.p, p_floor: x.floor, p_room: x.room }),
    note: 'Bed figures count check-ins made in the app; "Guests in register" counts the guest register.',
    columns: [col('property_id', 'Property'), col('floor', 'Floor'), col('room_no', 'Room'), col('beds', 'Beds'), col('register_guests', 'Guests in register'), col('occupied_now', 'Occupied now'), col('vacant_now', 'Vacant'),
      col('reserved_now', 'Reserved'), col('blocked_now', 'Blocked'), col('occupied_bed_nights', 'Bed-nights used'), col('available_bed_nights', 'Bed-nights available'),
      col('occupancy_pct', 'Occupancy %'), col('vacancy_days_per_bed', 'Vacant days per bed')] },
  { key: 'collection', name: 'Rent collection', fl: 'dfrt', rpc: 'report_rent_collection', args: (x) => ({ p_from: x.from, p_to: x.to, p_property: x.p, p_floor: x.floor, p_room: x.room, p_tenant: x.tenant }),
    columns: [col('invoice_no', 'Invoice'), col('property_id', 'Property'), col('room_no', 'Room'), col('tenant', 'Tenant'), col('description', 'For'), date('due_date', 'Due'),
      money('billed', 'Billed'), money('collected', 'Collected'), money('outstanding', 'Outstanding'), col('state', 'Status', (r) => label(r.state))] },
  { key: 'outstanding', name: 'Outstanding dues (ageing)', fl: 'dfrt', rpc: 'report_outstanding', args: (x) => ({ p_property: x.p, p_floor: x.floor, p_room: x.room, p_tenant: x.tenant, p_from: x.from, p_to: x.to }),
    columns: [col('tenant', 'Tenant'), col('phone', 'Mobile'), col('property_id', 'Property'), col('room_no', 'Room'), col('month', 'Month'), col('description', 'For'),
      date('due_date', 'Due'), col('days_overdue', 'Days late'), col('bucket', 'Ageing'), money('outstanding', 'Amount'), col('risk', 'Repeat defaulter', (r) => (r.risk ? 'yes' : ''))] },
  { key: 'expenses', name: 'Expenses', fl: 'd', rpc: 'report_expenses', args: (x) => ({ p_from: x.from, p_to: x.to, p_property: x.p }),
    columns: [date('spent_on', 'Date'), col('property_id', 'Property'), col('category', 'Category'), col('grp', 'Group', (r) => label(r.grp)), money('amount', 'Amount'),
      col('vendor', 'Vendor'), col('payment_mode', 'Mode', (r) => label(r.payment_mode)), col('status', 'Status'), col('source', 'Source'), col('notes', 'Notes')],
    chart: (rows) => <HBarChart title="Expense by category (approved)" data={Object.entries(rows.filter((r) => r.status === 'approved').reduce((s, r) => ({ ...s, [r.category]: (s[r.category] ?? 0) + r.amount }), {})).map(([l, v]) => ({ label: l, value: v }))} /> },
  { key: 'pl', name: 'Profit & loss', fl: 'd', load: loadPL, args: (x) => ({ p_from: x.from, p_to: x.to, p_property: x.p }),
    note: 'Rent includes rent marked paid in the guest register, counted in the month it was marked paid.',
    columns: [{ key: 'month', label: 'Month', value: mon }, col('property_id', 'Property', (r) => (r.property_id === 'ALL' ? 'All (combined)' : r.property_id)),
      money('rent', 'Rent'), money('register_rent', 'of which register'), money('charges', 'Charges'), money('late_fees', 'Late fees'), money('deposits_kept', 'Deposits kept'), money('other_income', 'Other income'),
      money('total_income', 'Total income'), money('utilities', 'Utilities'), money('salaries', 'Salaries'), money('maintenance', 'Maintenance'), money('food', 'Food'),
      money('other_expense', 'Other'), money('total_expense', 'Total expense'), money('profit', 'Profit')],
    chart: (rows) => {
      const all = rows.filter((r) => r.property_id === 'ALL').map((r) => ({ label: mon(r), income: Number(r.total_income), expense: Number(r.total_expense), profit: Number(r.profit) }))
      const last = rows.filter((r) => r.property_id === 'ALL').reduce((s, r) => ({ Utilities: s.Utilities + Number(r.utilities), Salaries: s.Salaries + Number(r.salaries),
        Maintenance: s.Maintenance + Number(r.maintenance), Food: s.Food + Number(r.food), Other: s.Other + Number(r.other_expense) }), { Utilities: 0, Salaries: 0, Maintenance: 0, Food: 0, Other: 0 })
      return (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2"><BarChart title="Income vs expense" data={all} series={[{ key: 'income', label: 'Income' }, { key: 'expense', label: 'Expense' }]} /></div>
          <HBarChart title="Expense by category" data={Object.entries(last).map(([l, v]) => ({ label: l, value: v }))} />
          <div className="lg:col-span-3"><BarChart title="Profit trend" data={all} series={[{ key: 'profit', label: 'Profit' }]} /></div>
        </div>
      )
    } },
  { key: 'checkins', name: 'Check-in / check-out', fl: 'dt', rpc: 'report_checkins', args: (x) => ({ p_from: x.from, p_to: x.to, p_property: x.p, p_tenant: x.tenant }),
    columns: [col('event', 'Event'), date('event_date', 'Date'), col('property_id', 'Property'), col('room_no', 'Room'), col('tenant', 'Tenant'), money('rent', 'Rent'),
      money('deposit', 'Deposit'), col('source', 'Source'), date('notice_date', 'Notice given')] },
  { key: 'deposits', name: 'Security deposits', fl: 't', rpc: 'report_deposits', args: (x) => ({ p_property: x.p, p_tenant: x.tenant }),
    columns: [col('property_id', 'Property'), col('tenant', 'Tenant'), col('room_no', 'Room'), money('amount', 'Agreed'), money('received', 'Received'), date('received_on', 'On'),
      col('status', 'Status', (r) => label(r.status)), money('deducted', 'Deducted'), money('refunded', 'Refunded'), date('refunded_on', 'Refunded on'), money('held', 'Held')] },
  { key: 'complaints', name: 'Complaints', fl: 'dr', rpc: 'report_complaints', args: (x) => ({ p_from: x.from, p_to: x.to, p_property: x.p, p_room: x.room }),
    columns: [col('ticket_no', '#'), col('property_id', 'Property'), col('room_no', 'Room'), col('category', 'Category', (r) => label(r.category)), col('title', 'Issue'),
      col('priority', 'Priority'), col('status', 'Status'), date('created', 'Raised'), col('resolution_hours', 'Hours to resolve'), col('overdue', 'Overdue', (r) => (r.overdue ? 'yes' : '')),
      col('assignee', 'Assigned to'), money('cost', 'Cost'), col('rating', 'Rating')] },
  { key: 'trends', name: '12-month trends', fl: '', load: loadTrends, args: (x) => ({ p_property: x.p, p_months: 12 }),
    note: 'Revenue includes rent marked paid in the guest register. Occupancy % counts beds checked in through the app; current register occupancy is in "Guest register by wing".',
    columns: [{ key: 'month', label: 'Month', value: mon }, col('occupancy_pct', 'Bed occupancy % (app)'), money('revenue', 'Revenue'), money('register_rent', 'of which register'), money('expenses', 'Expenses'), money('profit', 'Profit'),
      col('enquiries', 'Enquiries'), col('bookings', 'Converted'), col('conversion_pct', 'Enquiry → tenant %')],
    chart: (rows) => (
      <div className="grid gap-4 lg:grid-cols-2">
        <BarChart title="Occupancy % by month (seasonality)" money={false} data={rows.map((r) => ({ label: mon(r), v: Number(r.occupancy_pct || 0) }))} series={[{ key: 'v', label: 'Occupancy %' }]} />
        <BarChart title="Revenue by month" data={rows.map((r) => ({ label: mon(r), v: Number(r.revenue) }))} series={[{ key: 'v', label: 'Revenue' }]} />
      </div>
    ) },
  { key: 'attendance', name: 'Staff attendance', fl: 'd', rpc: 'report_attendance', args: (x) => ({ p_from: x.from, p_to: x.to, p_property: x.p }),
    columns: [col('name', 'Employee'), col('designation', 'Role', (r) => label(r.designation)), col('property_id', 'Property'), col('present', 'Present'), col('half_days', 'Half days'),
      col('leave', 'Leave'), col('absent', 'Absent'), col('weekly_off', 'Weekly off'), col('overtime_hours', 'Overtime h'), col('self_check_ins', 'Self check-ins')] },
  { key: 'salaries', name: 'Salaries', fl: 'd', rpc: 'report_salaries', args: (x) => ({ p_from: x.from, p_to: x.to, p_property: x.p }),
    columns: [{ key: 'month', label: 'Month', value: mon }, col('property_id', 'Property'), col('name', 'Employee'), col('payable_days', 'Payable days'), money('gross', 'Gross'),
      money('pf', 'PF'), money('esi', 'ESI'), money('advance_recovery', 'Advance recovered'), money('deductions', 'Other deductions'), money('net', 'Net'), col('status', 'Status'), date('paid_on', 'Paid on')] },
  { key: 'advances', name: 'Advances outstanding', fl: '', rpc: 'report_advances', args: (x) => ({ p_property: x.p }),
    columns: [col('name', 'Employee'), col('property_id', 'Property'), col('kind', 'Type'), date('given_on', 'Given'), money('amount', 'Amount'), money('recovered', 'Recovered'),
      money('outstanding', 'Outstanding'), money('instalment', 'Per salary')] },
  { key: 'leave', name: 'Leave', fl: '', rpc: 'report_leave', args: (x) => ({ p_year: Number(x.to.slice(0, 4)), p_property: x.p }),
    columns: [col('name', 'Employee'), col('property_id', 'Property'), col('paid_taken', 'Paid taken'), col('sick_taken', 'Sick taken'), col('casual_taken', 'Casual taken'),
      col('unpaid_taken', 'Unpaid'), col('paid_left', 'Paid left'), col('sick_left', 'Sick left'), col('casual_left', 'Casual left'), col('pending', 'Pending')] },
  { key: 'performance', name: 'Staff performance', fl: 'd', rpc: 'report_staff_performance', args: (x) => ({ p_from: x.from, p_to: x.to, p_property: x.p }),
    columns: [col('name', 'Employee'), col('designation', 'Role', (r) => label(r.designation)), col('tasks', 'Tasks'), col('tasks_done_on_time', 'Done on time'),
      col('complaints_resolved', 'Complaints resolved'), col('avg_resolution_hours', 'Avg hours'), col('avg_rating', 'Tenant rating'), money('staff_cost', 'Cost'),
      col('cost_pct_of_revenue', 'Cost % of property revenue')] },
  { key: 'staffcost', name: 'Staff cost vs revenue', fl: 'd', rpc: 'report_staff_cost', args: (x) => ({ p_from: x.from, p_to: x.to, p_property: x.p }),
    columns: [col('property_id', 'Property'), money('staff_cost', 'Staff cost'), money('revenue', 'Revenue'), col('cost_pct', 'Cost %')] },
]

export default function Reports() {
  const { property, properties } = useScope()
  // wings in view: register rent is fetched per wing so P&L can split it
  const wings = property ? [property] : properties.map((p) => p.id)
  const [key, setKey] = useState('pl')
  const [x, setX] = useState({ from: `${new Date().getFullYear()}-01-01`, to: ymd(), floor: '', room: '', tenant: '' })
  const rep = REPORTS.find((r) => r.key === key)
  const args = rep.args({ ...x, p: property || null, floor: x.floor === '' ? null : Number(x.floor), room: x.room || null, tenant: x.tenant || null })
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Report">
          <select className={`${inputCls} !w-auto`} value={key} onChange={(e) => setKey(e.target.value)}>
            {REPORTS.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </Field>
        {rep.fl.includes('d') && (
          <>
            <Field label="From"><input type="date" className={`${inputCls} !w-auto`} value={x.from} onChange={(e) => setX({ ...x, from: e.target.value })} /></Field>
            <Field label="To"><input type="date" className={`${inputCls} !w-auto`} value={x.to} onChange={(e) => setX({ ...x, to: e.target.value })} /></Field>
            <button className="pb-2 text-xs underline" onClick={() => setX({ ...x, from: monthStart(), to: ymd() })}>This month</button>
          </>
        )}
        <Load loader={() => Promise.all([m.loadRoomsWithBeds(property), rep.fl.includes('t') ? m.loadTenants(property) : Promise.resolve([])])} deps={[property, rep.fl]}>
          {([rooms, tenants]) => (
            <>
              {rep.fl.includes('f') && (
                <Field label="Floor"><select className={`${inputCls} !w-auto`} value={x.floor} onChange={(e) => setX({ ...x, floor: e.target.value })}>
                  <option value="">All</option>{[...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b).map((f) => <option key={f} value={f}>{f}</option>)}
                </select></Field>
              )}
              {rep.fl.includes('r') && (
                <Field label="Room"><select className={`${inputCls} !w-auto`} value={x.room} onChange={(e) => setX({ ...x, room: e.target.value })}>
                  <option value="">All</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.property_id} · {r.room_no}</option>)}
                </select></Field>
              )}
              {rep.fl.includes('t') && (
                <Field label="Tenant"><select className={`${inputCls} !w-auto`} value={x.tenant} onChange={(e) => setX({ ...x, tenant: e.target.value })}>
                  <option value="">All</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select></Field>
              )}
            </>
          )}
        </Load>
      </div>
      <Load loader={() => (rep.load ? rep.load(args, wings) : m.rpc(rep.rpc, args))} deps={[key, JSON.stringify(args), wings.join()]}>
        {(rows) => (
          <div className="space-y-6">
            {rep.chart && rows.length > 0 && rep.chart(rows)}
            <div>
              <H3>{rep.name}</H3>
              {rep.note && <p className="-mt-1 mb-3 text-sm text-slate-600">{rep.note}</p>}
              <DataTable title={rep.name} rows={rows.map((r, i) => ({ id: i, ...r }))} columns={rep.columns} pageSize={100} />
            </div>
          </div>
        )}
      </Load>
      <p className="mt-6 text-xs text-slate-500">Every report exports to CSV, Excel and PDF with the filters applied. A monthly summary is emailed to the owner on the 1st (needs the email key; see docs/pg-management.md).</p>
    </div>
  )
}
