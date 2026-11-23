import { useState } from 'react'
import useAsync from '../../hooks/useAsync'
import Shell from '../../components/dashboard/Shell'
import RoomsBoard from '../../components/dashboard/RoomsBoard'
import DuesTable from '../../components/dashboard/DuesTable'
import DataTable from '../../components/manage/DataTable'
import NotificationBell from '../../components/NotificationBell'
import GuestRegister from '../../components/register/GuestRegister'
import { STATUS_TEXT, departures, registerSummary } from '../../services/register'
import { ActionMsg, H3, Load, Small, StatusBadge, useAction } from '../../components/manage/kit'
import { Button, Empty, ErrorBox, Notice, Spinner, Stat } from '../../components/ui'
import { staffOverview } from '../../services/api'
import * as m from '../../services/manage'
import { addDays, complaintCategory, label, ymd } from '../../services/pg'
import { formatDate, formatDateTime, rupees } from '../../services/format'
import { MyLeave, MyPayslips, Notices, Today } from './StaffSelf'

// The property manager's day: beds, dues, arrivals and departures, the team on shift and open complaints.
// Anything deeper (check-in forms, billing, payroll) opens in the full console at /admin.
const OPEN = ['new', 'assigned', 'in_progress']
const within = (days) => (r) => r.date && String(r.date).slice(0, 10) <= addDays(ymd(), days)

function Overview() {
  return (
    <Load loader={() => Promise.all([m.ownerDashboard(null), registerSummary(null)])}>
      {([d, reg]) => {
        if (!d) return <Notice>No data yet. Ask the owner to add your property and rooms.</Notice>
        const b = d.beds ?? {}; const money = d.money ?? {}; const c = d.complaints ?? {}
        const r = reg?.totals ?? {}
        const due = Number(r.rent_pending_guests ?? 0) + Number(r.rent_partial_guests ?? 0)
        const wing = Object.fromEntries((reg?.properties ?? []).map((p) => [p.id, p.name]))
        return (
          <div>
            <div className="flex flex-wrap gap-2">
              <Button to="/admin/checkin" variant="sun">Check in a tenant</Button>
              <Button to="/admin/register" variant="outline">Guest register</Button>
              <Button to="/admin/billing" variant="outline">Record a payment</Button>
              <Button to="/admin/tenants" variant="outline">Tenants</Button>
              <Button to="/admin" variant="outline">Full console</Button>
            </div>
            <H3>Guests and rooms</H3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Guests staying" value={r.guests ?? 0} hint={`${r.checkins_month ?? 0} in, ${r.checkouts_month ?? 0} out this month`} />
              <Stat label="Rooms occupied" value={`${r.rooms_occupied ?? 0}/${r.rooms_total ?? 0}`} hint={`${r.occupancy_pct ?? 0}% of rooms`} />
              <Stat label="PG · rented" value={`${r.pg_rooms ?? 0} · ${r.rented_rooms ?? 0}`} hint={`${r.pg_people ?? 0} people sharing`} />
              <Stat label="Empty rooms" value={r.empty_rooms ?? 0} />
            </div>
            {b.occupied > 0 && <p className="mt-2 text-xs text-slate-600">Bed board: {b.occupied} of {b.total} beds booked in the app{b.reserved ? `, ${b.reserved} reserved` : ''}.</p>}
            <H3>Rent</H3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Monthly rent" value={rupees(r.rent_roll)} hint={`${rupees(r.rent_paid)} marked paid`} />
              <Stat label="Rent pending" value={rupees(Number(r.rent_pending ?? 0) + Number(money.pending ?? 0))}
                hint={`${due} guest${due === 1 ? '' : 's'}${r.rent_not_updated ? ` · ${r.rent_not_updated} not updated` : ''}`} tone={due ? 'red' : undefined} />
              <Stat label="Deposits held" value={rupees(r.deposit_held)} hint={r.deposit_pending_guests ? `${r.deposit_pending_guests} deposit${r.deposit_pending_guests === 1 ? '' : 's'} pending` : undefined} />
              <Stat label="Open complaints" value={c.open ?? 0} hint={c.overdue ? `${c.overdue} overdue` : undefined} tone={c.overdue ? 'red' : undefined} />
            </div>
            {(money.collected > 0 || money.overdue > 0) && (
              <p className="mt-2 text-xs text-slate-600">App billing this month: {rupees(money.collected)} collected{money.overdue ? `, ${rupees(money.overdue)} overdue` : ''}.</p>
            )}
            <H3>Rent pending</H3>
            <DataTable title="Rent pending" search={false} rows={reg?.rent_pending ?? []} empty="Everyone's rent is paid or not due" columns={[
              { key: 'room', label: 'Room' },
              { key: 'name', label: 'Guest' },
              ...(Object.keys(wing).length > 1 ? [{ key: 'property_id', label: 'Wing', value: (x) => wing[x.property_id] ?? x.property_id }] : []),
              { key: 'rent', label: 'Rent', render: (x) => rupees(x.rent), value: (x) => Number(x.rent ?? 0) },
              { key: 'rent_status', label: 'Status', value: (x) => STATUS_TEXT[x.rent_status] ?? x.rent_status },
            ]} />
            <div className="mt-2 grid gap-6 lg:grid-cols-2">
              <div>
                <H3>Arriving in the next 7 days</H3>
                <DataTable title="Arrivals" search={false} rows={(d.upcoming_checkins ?? []).filter(within(7))} empty="No arrivals this week" columns={[
                  { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
                  { key: 'name', label: 'Name' }, { key: 'bed', label: 'Bed / room' },
                ]} />
              </div>
              <div>
                <H3>Leaving in the next 7 days</H3>
                <DataTable title="Departures" search={false} rows={departures(d.upcoming_checkouts, reg?.leaving).filter(within(7))} empty="Nobody is leaving this week" columns={[
                  { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
                  { key: 'name', label: 'Guest' }, { key: 'room', label: 'Room' },
                ]} />
              </div>
            </div>
          </div>
        )
      }}
    </Load>
  )
}

function Team() {
  const a = useAction()
  return (
    <Load loader={() => m.loadTeamToday(ymd())}>
      {([staff, att, leave], reload) => {
        const byStaff = Object.fromEntries(att.map((r) => [r.staff_id, r]))
        const name = Object.fromEntries(staff.map((s) => [s.id, s.full_name]))
        const status = (s) => {
          const r = byStaff[s.id]
          if (!r) return 'Not marked yet'
          if (r.check_in_at) return `In at ${formatDateTime(r.check_in_at)}${r.check_out_at ? `, out at ${formatDateTime(r.check_out_at)}` : ''}`
          return label(r.status)
        }
        return (
          <div className="space-y-6">
            <section>
              <H3 action={<Button to="/admin/staff" variant="outline">Attendance and roster</Button>}>Team today · {formatDate(new Date())}</H3>
              {staff.length === 0 ? <Empty title="No staff linked to your property yet" /> : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {staff.map((s) => (
                    <li key={s.id} className="rounded-2xl border border-navy/10 bg-white p-4 text-sm">
                      <p className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                        {s.full_name}<StatusBadge value={s.designation} />
                      </p>
                      <p className="mt-1 text-slate-600">{status(s)}</p>
                      {s.phone && <a className="mt-1 inline-block underline focus-visible:outline-2 focus-visible:outline-navy" href={`tel:${s.phone}`}>Call {s.phone}</a>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <H3>Leave waiting for you</H3>
              {leave.length === 0 ? <Empty title="No pending leave requests" /> : (
                <ul className="divide-y divide-navy/5 text-sm">
                  {leave.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span><span className="font-medium">{name[l.staff_id] ?? 'Staff'}</span> · {label(l.leave_type)} · {formatDate(l.from_date)} – {formatDate(l.to_date)} ({l.days} d){l.reason && ` · ${l.reason}`}</span>
                      <span className="flex gap-1">
                        <Small disabled={a.busy} onClick={async () => (await a.run(() => m.decideLeave(l.id, true), 'Approved')) && reload()}>Approve</Small>
                        <Small disabled={a.busy} onClick={async () => (await a.run(() => m.decideLeave(l.id, false), 'Rejected')) && reload()}>Reject</Small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2"><ActionMsg action={a} /></div>
            </section>
          </div>
        )
      }}
    </Load>
  )
}

function OpenComplaints() {
  return (
    <Load loader={() => m.loadComplaints()}>
      {(list) => {
        const open = list.filter((c) => OPEN.includes(c.status))
        return (
          <div>
            <H3 action={<Button to="/admin/complaints" variant="outline">Assign and manage</Button>}>Open complaints ({open.length})</H3>
            <DataTable title="Open complaints" rows={open} empty="No open complaints" columns={[
              { key: 'ticket_no', label: 'Ticket', render: (c) => `#${c.ticket_no}` },
              { key: 'title', label: 'Issue', value: (c) => `${c.title} ${complaintCategory(c.category)}`, render: (c) => <>{c.title}<span className="block text-xs text-slate-500">{complaintCategory(c.category)}</span></> },
              { key: 'where', label: 'Where', value: (c) => (c.is_common_area ? 'Common area' : `Room ${c.rooms?.room_no ?? ''}`) },
              { key: 'priority', label: 'Priority', render: (c) => <StatusBadge value={c.priority} /> },
              { key: 'status', label: 'Status', render: (c) => <StatusBadge value={c.status} /> },
              { key: 'due_at', label: 'Due', render: (c) => formatDateTime(c.due_at), value: (c) => c.due_at },
            ]} />
          </div>
        )
      }}
    </Load>
  )
}

function Customers() {
  const { data, error, loading, reload } = useAsync(staffOverview, [])
  if (loading) return <Spinner label="Loading customers" />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return <DuesTable rows={data} />
}

const TABS = [['register', 'Guest register'], ['today', 'Today'],['team', 'Team'], ['complaints', 'Complaints'], ['rooms', 'Rooms and beds'], ['customers', 'Customers and dues'],
  ['me', 'My attendance'], ['leave', 'My leave'], ['payslips', 'Payslips'], ['notices', 'Notices']]

export default function ManagerDashboard() {
  // the guest register is the first thing a manager sees (a ?changes= link from the AI guide lands there too)
  const [tab, setTab] = useState('register')
  return (
    <Shell title="Manager" tabs={TABS} tab={tab} onTab={setTab} actions={<NotificationBell />}>
      {tab === 'today' && <Overview />}
      {tab === 'register' && <GuestRegister />}
      {tab === 'team' && <Team />}
      {tab === 'complaints' && <OpenComplaints />}
      {tab === 'rooms' && <RoomsBoard canManage />}
      {tab === 'customers' && <Customers />}
      {tab === 'me' && <Today />}
      {tab === 'leave' && <MyLeave />}
      {tab === 'payslips' && <MyPayslips />}
      {tab === 'notices' && <Notices />}
    </Shell>
  )
}
