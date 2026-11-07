import { useCallback, useEffect, useState } from 'react'
import useAsync from '../../hooks/useAsync'
import Shell from '../../components/dashboard/Shell'
import RoomsBoard from '../../components/dashboard/RoomsBoard'
import ContactButtons from '../../components/dashboard/ContactButtons'
import { Badge, Button, Card, Empty, ErrorBox, Field, Notice, Stat, Table, TableSkeleton, inputCls } from '../../components/ui'
import { daysOverdue, isOverdue } from '../../services/billing'
import { formatDate, formatDateTime, rupees } from '../../services/format'
import { loadCatalog } from '../../services/catalog'
import * as api from '../../services/api'

// Runs a loader and renders loading / error / content. Keeps each panel short.
function Panel({ loader, deps = [], children }) {
  const state = useAsync(loader, deps)
  if (state.loading) return <TableSkeleton />
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />
  return children(state.data, state.reload)
}

const useAction = () => {
  const [error, setError] = useState('')
  const run = async (fn, after) => {
    setError('')
    try { await fn(); after?.() } catch (e) { setError(e.message) }
  }
  return [error, run]
}

// ---------------------------------------------------------------- overview
function Overview() {
  return (
    <Panel loader={api.adminStats}>
      {(s) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Rooms" value={s.rooms} />
            <Stat label="Beds" value={s.beds} />
            <Stat label="Available beds" value={s.beds_available} />
            <Stat label="Occupied beds" value={s.beds_occupied} hint={s.beds_maintenance ? `${s.beds_maintenance} under maintenance` : undefined} />
            <Stat label="Current customers" value={s.customers_current} hint={`${s.customers_total} registered`} />
            <Stat label="Employees" value={s.employees} />
            <Stat label="Active bookings" value={s.bookings_active} hint={`${s.bookings_pending} awaiting payment · ${s.bookings_total} total`} />
            <Stat label="Overdue" value={rupees(s.overdue_amount)} tone={s.overdue_count ? 'red' : undefined} hint={`${s.overdue_count} bill(s)`} />
          </div>
          <Notice>
            Real payments received: <strong>{rupees(s.received)}</strong>. Simulated (demo) payments: <strong>{rupees(s.received_demo)}</strong>, kept separate and not counted as revenue.
          </Notice>
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------- customers
function CustomerRow({ c }) {
  const [open, setOpen] = useState(false)
  const [error, run] = useAction()
  const outstanding = c.bills.filter((b) => b.status === 'unpaid').reduce((s, b) => s + b.amount, 0)
  const live = c.bookings.find((b) => ['active', 'pending'].includes(b.status))
  return (
    <>
      <tr>
        <td className="px-4 py-3 font-medium">{c.full_name || '—'}</td>
        <td className="px-4 py-3">{live ? `Room ${live.rooms.room_no}` : '—'}</td>
        <td className="px-4 py-3">{live ? <Badge tone={live.status === 'active' ? 'green' : 'amber'}>{live.status}</Badge> : <Badge>none</Badge>}</td>
        <td className="px-4 py-3">{rupees(outstanding)}</td>
        <td className="px-4 py-3"><ContactButtons phone={c.phone} /></td>
        <td className="px-4 py-3 text-right"><button className="text-sm font-medium underline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Details'}</button></td>
      </tr>
      {open && (
        <tr className="bg-cream/60">
          <td colSpan={6} className="px-4 py-4 text-sm">
            <p>Joined {formatDate(c.created_at)} · {c.is_active ? 'Account active' : 'Account disabled'}</p>
            <h4 className="mt-3 font-semibold">Bookings</h4>
            {c.bookings.length ? c.bookings.map((b) => (
              <p key={b.id} className="flex flex-wrap items-center gap-2">
                Room {b.rooms.room_no} · {formatDate(b.check_in)}{b.check_out && ` to ${formatDate(b.check_out)}`} <Badge>{b.status}</Badge>
                {b.status === 'active' && <button className="text-red-700 underline" onClick={() => window.confirm('End this stay and free the beds?') && run(() => api.endBooking(b.id))}>End stay</button>}
              </p>
            )) : <p className="text-slate-500">None</p>}
            <h4 className="mt-3 font-semibold">Bills</h4>
            {c.bills.length ? c.bills.map((b) => (
              <p key={b.id}>{b.description}: {rupees(b.amount)}, due {formatDate(b.due_date)} <Badge tone={b.status === 'paid' ? 'green' : isOverdue(b) ? 'red' : 'gray'}>{isOverdue(b) ? 'overdue' : b.status}</Badge></p>
            )) : <p className="text-slate-500">None</p>}
            <h4 className="mt-3 font-semibold">Documents</h4>
            {c.customer_documents.length ? c.customer_documents.map((d) => (
              <p key={d.id}>{d.doc_type.replace('_', ' ')}: <button className="underline" onClick={() => run(async () => window.open(await api.documentUrl(d.file_path), '_blank', 'noopener'))}>{d.file_name}</button></p>
            )) : <p className="text-slate-500">No documents</p>}
            {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
          </td>
        </tr>
      )}
    </>
  )
}

// One page of customers at a time (api.CUSTOMERS_PAGE); "Load more" appends the next page.
function Customers() {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const loadPage = useCallback(async (n) => {
    setLoading(true)
    setError(null)
    try {
      const rows = await api.adminCustomers(n)
      setPages((p) => [...p.slice(0, n), rows])
      setDone(rows.length < api.CUSTOMERS_PAGE)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPage(0) }, [loadPage])

  const rows = pages.flat()
  if (!rows.length) {
    if (loading) return <TableSkeleton label="Loading customers" />
    if (error) return <ErrorBox error={error} onRetry={() => loadPage(0)} />
    return <Empty title="No customers yet" />
  }
  return (
    <div className="space-y-4">
      <Table head={['Name', 'Room', 'Booking', 'Outstanding', 'Contact', '']}>
        {rows.map((c) => <CustomerRow key={c.id} c={c} />)}
      </Table>
      <ErrorBox error={error} onRetry={() => loadPage(pages.length)} />
      {!done && (
        <div className="text-center">
          <Button variant="outline" disabled={loading} onClick={() => loadPage(pages.length)}>{loading ? 'Loading…' : 'Load more'}</Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- rooms
function RoomEditor({ room, onSaved }) {
  const [price, setPrice] = useState(room.price)
  const [deposit, setDeposit] = useState(room.deposit)
  const [error, run] = useAction()
  const dirty = price !== room.price || deposit !== room.deposit
  return (
    <tr>
      <td className="px-4 py-3 font-medium">Room {room.no}</td>
      <td className="px-4 py-3">{room.type} · F{room.floor} · {room.totalBeds} beds</td>
      <td className="px-4 py-3"><input aria-label={`Price for room ${room.no}`} className={`${inputCls} w-28`} type="number" min="1" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></td>
      <td className="px-4 py-3"><input aria-label={`Deposit for room ${room.no}`} className={`${inputCls} w-28`} type="number" min="0" value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} /></td>
      <td className="px-4 py-3">
        <Button variant="outline" className="!py-1" disabled={!dirty} onClick={() => run(() => api.updateRoom(room.id, { price, deposit, is_demo_price: false }), onSaved)}>Save</Button>
        {error && <span role="alert" className="ml-2 text-xs text-red-700">{error}</span>}
      </td>
    </tr>
  )
}

function Rooms() {
  return (
    <div className="space-y-8">
      <RoomsBoard canManage />
      <div>
        <h2 className="mb-1 text-lg font-bold">Prices</h2>
        <p className="mb-3 text-sm text-slate-600">Saving a price marks it as a real (not demo) price. Existing bookings keep the price they were made at.</p>
        <Panel loader={loadCatalog}>
          {(d, reload) => (
            <Table head={['Room', 'Details', 'Price (₹)', 'Deposit (₹)', '']}>
              {d.rooms.map((r) => <RoomEditor key={`${r.id}-${r.price}-${r.deposit}`} room={r} onSaved={reload} />)}
            </Table>
          )}
        </Panel>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- payments and dues
function Payments() {
  return (
    <div className="space-y-8">
      <Panel loader={api.adminStats}>
        {(s) => (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Received (real)" value={rupees(s.received)} />
            <Stat label="Received (demo)" value={rupees(s.received_demo)} />
            <Stat label="Pending" value={rupees(s.pending_amount)} />
            <Stat label="Overdue" value={rupees(s.overdue_amount)} tone={s.overdue_amount ? 'red' : undefined} />
          </div>
        )}
      </Panel>
      <Panel loader={api.adminPayments}>
        {(rows) => rows.length === 0 ? <Empty title="No payments yet" /> : (
          <Table head={['Date', 'Customer', 'For', 'Amount', 'Method', 'Result']}>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3">{formatDateTime(p.created_at)}</td>
                <td className="px-4 py-3">{p.profiles?.full_name}</td>
                <td className="px-4 py-3">{p.bills?.description}</td>
                <td className="px-4 py-3">{rupees(p.amount)}</td>
                <td className="px-4 py-3">{p.is_simulated ? <Badge tone="amber">Demo</Badge> : p.provider}</td>
                <td className="px-4 py-3"><Badge tone={p.status === 'succeeded' ? 'green' : p.status === 'failed' ? 'red' : 'gray'}>{p.status}</Badge></td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  )
}

function Dues() {
  const [error, run] = useAction()
  return (
    <Panel loader={api.adminBills}>
      {(bills, reload) => {
        const unpaid = bills.filter((b) => b.status === 'unpaid')
        const overdue = unpaid.filter(isOverdue)
        const upcoming = unpaid.filter((b) => !isOverdue(b))
        const rows = (list, late) => list.map((b) => (
          <tr key={b.id}>
            <td className="px-4 py-3 font-medium">{b.profiles?.full_name}</td>
            <td className="px-4 py-3">Room {b.bookings?.rooms?.room_no}</td>
            <td className="px-4 py-3">{b.description}</td>
            <td className="px-4 py-3">{rupees(b.amount)}</td>
            <td className="px-4 py-3">{formatDate(b.due_date)}{late && <Badge tone="red"> {daysOverdue(b)}d late</Badge>}</td>
            <td className="px-4 py-3"><ContactButtons phone={b.profiles?.phone} message={`Hi ${b.profiles?.full_name}, this is YOLO Nest. Your payment of ${rupees(b.amount)} (${b.description}) was due on ${formatDate(b.due_date)}.`} /></td>
            <td className="px-4 py-3"><Button variant="outline" className="!py-1" onClick={() => window.confirm('Record this bill as paid in cash/transfer?') && run(() => api.recordCashPayment(b.id), reload)}>Mark paid</Button></td>
          </tr>
        ))
        const head = ['Customer', 'Room', 'Bill', 'Amount', 'Due', 'Contact', '']
        return (
          <div className="space-y-8">
            {error && <p role="alert" className="text-red-700">{error}</p>}
            <div>
              <h2 className="mb-3 text-lg font-bold text-red-700">Overdue ({overdue.length})</h2>
              {overdue.length ? <Table head={head}>{rows(overdue, true)}</Table> : <Empty title="Nothing overdue" />}
            </div>
            <div>
              <h2 className="mb-3 text-lg font-bold">Upcoming ({upcoming.length})</h2>
              {upcoming.length ? <Table head={head}>{rows(upcoming, false)}</Table> : <Empty title="No upcoming bills" />}
            </div>
          </div>
        )
      }}
    </Panel>
  )
}

// ---------------------------------------------------------------- employees
const PERMS = [
  ['can_view_customers', 'See customers and dues'],
  ['can_view_contacts', 'See phone numbers / WhatsApp'],
  ['can_view_payments', 'See bill amounts'],
  ['can_manage_beds', 'Mark beds under maintenance'],
]

function EmployeeRow({ e, onChanged }) {
  const [error, run] = useAction()
  const perms = e.employee_permissions ?? {}
  const toggle = (key) => run(() => api.setEmployeePermissions(e.id, { ...Object.fromEntries(PERMS.map(([k]) => [k, Boolean(perms[k])])), [key]: !perms[key] }), onChanged)
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{e.full_name}</h3>
          <p className="text-sm text-slate-600">{e.phone || 'No phone'} · joined {formatDate(e.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={e.is_active ? 'green' : 'red'}>{e.is_active ? 'Active' : 'Disabled'}</Badge>
          <Button variant="outline" className="!py-1" onClick={() => run(() => api.setUserActive(e.id, !e.is_active), onChanged)}>{e.is_active ? 'Disable' : 'Enable'}</Button>
        </div>
      </div>
      <fieldset className="mt-3 grid gap-1 sm:grid-cols-2">
        <legend className="sr-only">Permissions for {e.full_name}</legend>
        {PERMS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(perms[key])} onChange={() => toggle(key)} className="h-4 w-4 accent-[#1c1f4a]" /> {label}
          </label>
        ))}
      </fieldset>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  )
}

function NewEmployee({ onCreated }) {
  const [f, setF] = useState({ full_name: '', phone: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ ok: false, text: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg({ ok: false, text: '' })
    try {
      await api.createEmployee(f)
      setF({ full_name: '', phone: '', email: '', password: '' })
      setMsg({ ok: true, text: 'Employee created. Share their email and password with them.' })
      onCreated()
    } catch (x) { setMsg({ ok: false, text: x.message }) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-navy/10 bg-white p-5 sm:grid-cols-2">
      <h3 className="font-semibold sm:col-span-2">Add an employee</h3>
      <Field label="Full name"><input className={inputCls} required value={f.full_name} onChange={set('full_name')} /></Field>
      <Field label="Mobile"><input className={inputCls} inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
      <Field label="Email"><input className={inputCls} type="email" required value={f.email} onChange={set('email')} /></Field>
      <Field label="Temporary password (8+)"><input className={inputCls} type="text" required minLength={8} value={f.password} onChange={set('password')} /></Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create employee'}</Button>
        <span role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>{msg.text}</span>
      </div>
    </form>
  )
}

function Employees() {
  return (
    <Panel loader={api.adminEmployees}>
      {(rows, reload) => (
        <div className="space-y-4">
          <NewEmployee onCreated={reload} />
          {rows.length === 0 ? <Empty title="No employees yet" /> : rows.map((e) => <EmployeeRow key={e.id} e={e} onChanged={reload} />)}
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------- reviews and activity
function Reviews() {
  const [error, run] = useAction()
  return (
    <Panel loader={api.adminReviews}>
      {(rows, reload) => rows.length === 0 ? <Empty title="No reviews submitted yet">Customers with a stay can submit reviews from their dashboard.</Empty> : (
        <div className="space-y-3">
          {error && <p role="alert" className="text-red-700">{error}</p>}
          {rows.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{r.author_name} · {'★'.repeat(r.rating)}</p>
                <Badge tone={r.status === 'published' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>{r.status}</Badge>
              </div>
              <p className="mt-2 text-sm text-slate-700">{r.body}</p>
              <div className="mt-3 flex gap-2">
                {r.status !== 'published' && <Button className="!py-1" onClick={() => run(() => api.setReviewStatus(r.id, 'published'), reload)}>Publish</Button>}
                {r.status !== 'rejected' && <Button variant="outline" className="!py-1" onClick={() => run(() => api.setReviewStatus(r.id, 'rejected'), reload)}>Reject</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Panel>
  )
}

function Activity() {
  return (
    <Panel loader={api.adminActivity}>
      {(rows) => rows.length === 0 ? <Empty title="No activity yet" /> : (
        <Table head={['When', 'Who', 'Action', 'Details']}>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="px-4 py-3">{formatDateTime(a.created_at)}</td>
              <td className="px-4 py-3">{a.profiles?.full_name || 'System'}</td>
              <td className="px-4 py-3">{a.action}</td>
              <td className="px-4 py-3 text-xs text-slate-600">{a.entity} {Object.keys(a.details || {}).length ? JSON.stringify(a.details) : ''}</td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  )
}

const TABS = [
  ['overview', 'Overview', Overview], ['customers', 'Customers', Customers], ['rooms', 'Rooms', Rooms],
  ['payments', 'Payments', Payments], ['dues', 'Dues', Dues], ['employees', 'Employees', Employees],
  ['reviews', 'Reviews', Reviews], ['activity', 'Activity', Activity],
]

export default function AdminDashboard() {
  const [tab, setTab] = useState('overview')
  const Current = TABS.find(([k]) => k === tab)[2]
  return (
    <Shell title="Admin dashboard" tabs={TABS.map(([k, l]) => [k, l])} tab={tab} onTab={setTab}>
      <Current key={tab} />
    </Shell>
  )
}
