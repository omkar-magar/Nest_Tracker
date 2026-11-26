import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import useAsync from '../../hooks/useAsync'
import DataTable from '../../components/manage/DataTable'
import { ActionMsg, FileButton, FormFields, Modal, Small, StatusBadge, Tabs, useAction, useScope } from '../../components/manage/kit'
import { Button, ErrorBox, Notice, TableSkeleton, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { ENQUIRY_STATUSES, LEAD_SOURCES, LOST_REASONS, label } from '../../services/pg'
import { exportCSV, parseCSV } from '../../services/exporters'
import { formatDate, formatDateTime, rupees } from '../../services/format'
import { useAuth } from '../../context/AuthContext'
import Coupons from '../../components/manage/Coupons'
import CouponForm from '../../components/manage/CouponForm'
import { couponValue, couponWhatsapp } from '../../services/coupons'

const RAW_COLUMNS = ['received_at', 'name', 'phone', 'email', 'property_id', 'room_type', 'budget', 'move_in', 'source', 'message', 'status', 'lost_reason', 'temperature']

// Not approached = still new, nothing sent yet. Approached = called, messaged or sent a coupon (moves on its own).
export const isApproached = (e) => e.status !== 'new' || Boolean(e.approached_at) || Boolean(e.coupon_code)
const SORTS = [
  ['newest', 'Newest first', (a, b) => b.received_at.localeCompare(a.received_at)],
  ['oldest', 'Oldest first', (a, b) => a.received_at.localeCompare(b.received_at)],
  ['budget_high', 'Budget: high to low', (a, b) => (b.budget ?? -1) - (a.budget ?? -1)],
  ['budget_low', 'Budget: low to high', (a, b) => (a.budget ?? Infinity) - (b.budget ?? Infinity)],
]

export default function Enquiries() {
  const { property } = useScope()
  const { role } = useAuth()
  const data = useAsync(() => Promise.all([m.loadEnquiries(), m.loadStaffLogins(), m.loadMyFollowUps()]), [])
  const [view, setView] = useState('new')
  const [f, setF] = useState({ status: '', source: '', assigned: '', from: '', to: '', min: '', max: '', sort: 'newest' })
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [coupon, setCoupon] = useState(null)
  const navigate = useNavigate()
  const canCoupon = ['admin', 'manager'].includes(role)

  const rows = useMemo(() => (data.data?.[0] ?? []).filter((e) => (!property || e.property_id === property)
    && (!f.status || e.status === f.status) && (!f.source || e.source === f.source) && (!f.assigned || e.assigned_to === f.assigned)
    && (!f.from || e.received_at >= f.from) && (!f.to || e.received_at.slice(0, 10) <= f.to)
    && (f.min === '' || (e.budget ?? -1) >= Number(f.min)) && (f.max === '' || (e.budget != null && e.budget <= Number(f.max))))
    .sort(SORTS.find(([k]) => k === f.sort)[2]), [data.data, property, f])

  if (data.loading) return <TableSkeleton />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const [, staff, followUps] = data.data
  const execs = staff.filter((s) => ['sales', 'manager', 'admin'].includes(s.role))
  const name = (id) => staff.find((s) => s.id === id)?.full_name ?? ''
  const today = new Date(); today.setHours(23, 59, 59)
  const dueFollowUps = followUps.filter((x) => new Date(x.due_at) <= today)
  const fresh = rows.filter((e) => !isApproached(e))
  const approached = rows.filter(isApproached)

  const filters = (
    <>
      <select aria-label="Sort by" className={`${inputCls} !w-auto`} value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}>
        {SORTS.map(([k, text]) => <option key={k} value={k}>{text}</option>)}
      </select>
      <label className="text-xs">Budget from <input type="number" min="0" inputMode="numeric" aria-label="Budget from" className={`${inputCls} !w-24`} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></label>
      <label className="text-xs">to <input type="number" min="0" inputMode="numeric" aria-label="Budget to" className={`${inputCls} !w-24`} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></label>
      {view !== 'new' && (
        <select aria-label="Status" className={`${inputCls} !w-auto`} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">All statuses</option>{ENQUIRY_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      )}
      <select aria-label="Source" className={`${inputCls} !w-auto`} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
        <option value="">All sources</option>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
      </select>
      <select aria-label="Assigned to" className={`${inputCls} !w-auto`} value={f.assigned} onChange={(e) => setF({ ...f, assigned: e.target.value })}>
        <option value="">Anyone</option>{execs.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
      </select>
      <label className="text-xs">From <input type="date" className={`${inputCls} !w-auto`} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
      <label className="text-xs">To <input type="date" className={`${inputCls} !w-auto`} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
    </>
  )

  // quick actions on a row; they must not open the enquiry
  const stop = (fn) => (ev) => { ev.stopPropagation(); fn() }
  const actions = {
    key: 'actions', label: '', noExport: true, render: (e) => (
      <span className="flex flex-wrap gap-1">
        {/* dialling counts as approaching the enquiry, like opening WhatsApp */}
        <Small href={`tel:+91${e.phone.slice(-10)}`} onClick={(ev) => {
          ev.stopPropagation()
          m.logLeadActivity(e.id, 'call', '', 'Dialled from the enquiry list').then(data.reload).catch(() => {})
        }}>Call</Small>
        {canCoupon && <Small onClick={stop(() => setCoupon({ enquiry: e }))}>Send coupon</Small>}
      </span>
    ),
  }
  const columns = [
    { key: 'received_at', label: 'Received', render: (e) => formatDateTime(e.received_at), value: (e) => e.received_at },
    { key: 'name', label: 'Name', render: (e) => <span className="font-medium">{e.name}{e.duplicate_of && <span className="ml-1 text-xs text-gold-deep">duplicate</span>}</span>, value: (e) => e.name },
    { key: 'phone', label: 'Mobile' }, { key: 'room_type', label: 'Looking for' },
    { key: 'budget', label: 'Budget', render: (e) => (e.budget != null ? rupees(e.budget) : '—'), value: (e) => e.budget ?? '' },
    { key: 'move_in', label: 'Move-in', render: (e) => formatDate(e.move_in), value: (e) => e.move_in },
    { key: 'source', label: 'Source', value: (e) => label(e.source) },
    { key: 'temperature', label: 'Lead', render: (e) => <StatusBadge value={e.temperature} />, value: (e) => e.temperature },
    { key: 'status', label: 'Status', render: (e) => <>{<StatusBadge value={e.status} />}{e.coupon_code && <span className="ml-1 font-mono text-xs">{e.coupon_code}</span>}</>, value: (e) => e.status },
    ...(view === 'approached' ? [{ key: 'approached_at', label: 'Approached', render: (e) => formatDateTime(e.approached_at), value: (e) => e.approached_at ?? '' }] : []),
    { key: 'assigned_to', label: 'Assigned', value: (e) => name(e.assigned_to) },
    { key: 'next_follow_up_at', label: 'Next follow-up', render: (e) => formatDateTime(e.next_follow_up_at), value: (e) => e.next_follow_up_at },
    actions,
  ]
  const table = (list, title, empty) => (
    <DataTable key={view} title={title} rows={list} filters={filters} empty={empty} onRowClick={(e) => navigate(`/admin/enquiries/${e.id}`)} columns={columns} />
  )

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setAdding(true)}>Add enquiry</Button>
        <Button variant="outline" onClick={() => setImporting(true)}>Import CSV</Button>
        <Button variant="outline" onClick={() => exportCSV('Enquiries raw data', rows, RAW_COLUMNS.map((k) => ({ key: k, label: k })))}>Export raw CSV</Button>
      </div>
      {dueFollowUps.length > 0 && (
        <section className="mb-6 rounded-2xl border border-gold/40 bg-sun/10 p-4" aria-label="Today's follow-ups">
          <h3 className="font-bold">Today's follow-ups ({dueFollowUps.length})</h3>
          <ul className="mt-2 divide-y divide-navy/5 text-sm">
            {dueFollowUps.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span><Link className="font-medium underline" to={`/admin/enquiries/${x.enquiries.id}`}>{x.enquiries.name}</Link> · {x.note || 'Follow up'}</span>
                <span className={new Date(x.due_at) < new Date() ? 'font-semibold text-red-700' : 'text-slate-600'}>{new Date(x.due_at) < new Date() ? 'Overdue · ' : ''}{formatDateTime(x.due_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Tabs tab={view} onTab={setView} label="View" tabs={[
        ['new', `Not approached (${fresh.length})`], ['approached', `Approached (${approached.length})`], ['list', 'All'], ['board', 'Board'],
        ...(canCoupon ? [['coupons', 'Coupons']] : []),
      ]} />
      {view === 'new' && <p className="mb-3 text-sm text-slate-600">New enquiries nobody has called, messaged or sent a coupon yet. They move to Approached on their own.</p>}
      {view === 'coupons' ? <Coupons />
        : view === 'new' ? table(fresh, 'Enquiries not approached', 'Every enquiry has been approached')
          : view === 'approached' ? table(approached, 'Enquiries approached', 'No enquiries approached yet')
            : view === 'list' ? table(rows, 'Enquiries', 'Nothing here yet')
              : <Board rows={rows} onChanged={data.reload} filters={filters} />}
      {coupon?.enquiry && <CouponForm enquiry={coupon.enquiry} onClose={() => setCoupon(null)} onDone={(c) => { setCoupon({ made: c, for: coupon.enquiry }); data.reload() }} />}
      {coupon?.made && (
        <Modal title="Coupon made" onClose={() => setCoupon(null)}>
          <p className="text-sm">Coupon <strong className="font-mono">{coupon.made.code}</strong> ({couponValue(coupon.made)}) is ready for {coupon.for.name}. The enquiry is now under Approached.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button href={couponWhatsapp(coupon.made, { name: coupon.for.name })} target="_blank" rel="noopener"
              onClick={() => m.logLeadActivity(coupon.for.id, 'whatsapp', 'sent', `Sent coupon ${coupon.made.code}`).catch(() => {})}>Send on WhatsApp</Button>
            <Button variant="outline" onClick={() => setCoupon(null)}>Done</Button>
          </div>
        </Modal>
      )}
      {adding && <AddEnquiry onClose={() => setAdding(false)} onDone={(id) => navigate(`/admin/enquiries/${id}`)} />}
      {importing && <ImportCsv onClose={() => setImporting(false)} onDone={() => { setImporting(false); data.reload() }} />}
    </div>
  )
}

// [Should] Kanban: drag a card to another column (or use its menu on keyboards / phones)
function Board({ rows, onChanged, filters }) {
  const [drag, setDrag] = useState(null)
  const [lost, setLost] = useState(null)
  const a = useAction()
  const move = async (e, status) => {
    if (e.status === status) return
    if (status === 'lost') { setLost(e); return }
    if (await a.run(() => m.updateEnquiry(e.id, { status }))) onChanged()
  }
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">{filters}</div>
      <ActionMsg action={a} />
      <div className="flex gap-3 overflow-x-auto pb-3">
        {ENQUIRY_STATUSES.map((s) => (
          <section key={s} aria-label={label(s)} className="w-60 shrink-0 rounded-2xl bg-white/70 p-2 ring-1 ring-navy/10"
            onDragOver={(ev) => ev.preventDefault()} onDrop={() => { if (drag) move(drag, s); setDrag(null) }}>
            <h3 className="px-1 pb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{label(s)} ({rows.filter((e) => e.status === s).length})</h3>
            <ul className="space-y-2">
              {rows.filter((e) => e.status === s).slice(0, 100).map((e) => (
                <li key={e.id} draggable onDragStart={() => setDrag(e)} className="cursor-grab rounded-xl border border-navy/10 bg-white p-2 text-sm shadow-sm">
                  <Link to={`/admin/enquiries/${e.id}`} className="font-medium hover:underline">{e.name}</Link>
                  <p className="text-xs text-slate-500">{e.phone} · {label(e.source)}</p>
                  <div className="mt-1 flex items-center justify-between gap-1"><StatusBadge value={e.temperature} />
                    <select aria-label={`Move ${e.name}`} className="rounded border border-navy/20 text-xs" value={e.status} onChange={(ev) => move(e, ev.target.value)}>
                      {ENQUIRY_STATUSES.map((x) => <option key={x} value={x}>{label(x)}</option>)}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {lost && <LostModal e={lost} onClose={() => setLost(null)} onDone={() => { setLost(null); onChanged() }} />}
    </div>
  )
}

export function LostModal({ e, onClose, onDone }) {
  const [v, setV] = useState({ lost_reason: 'price', lost_note: '' })
  const a = useAction()
  return (
    <Modal title={`Mark ${e.name} as lost`} onClose={onClose}>
      <FormFields value={v} onChange={setV} fields={[
        { key: 'lost_reason', label: 'Reason', type: 'select', required: true, options: LOST_REASONS }, { key: 'lost_note', label: 'Details', type: 'textarea' },
      ]} />
      <ActionMsg action={a} />
      <Button className="mt-3" variant="danger" disabled={a.busy} onClick={async () => (await a.run(() => m.updateEnquiry(e.id, { status: 'lost', ...v }))) && onDone()}>Mark lost</Button>
    </Modal>
  )
}

export const ENQUIRY_FIELDS = (properties, brokers = [], campaigns = [], tenants = []) => [
  { key: 'name', label: 'Name', required: true }, { key: 'phone', label: 'Mobile', type: 'tel', required: true },
  { key: 'email', label: 'Email', type: 'email', keepEmpty: true },
  { key: 'property_id', label: 'Preferred property', type: 'select', options: properties.map((p) => [p.id, p.name]) },
  { key: 'room_type', label: 'Room type wanted', keepEmpty: true }, { key: 'budget', label: 'Budget (₹/month)', type: 'number', min: 0 },
  { key: 'move_in', label: 'Move-in date', type: 'date' },
  { key: 'source', label: 'Source', type: 'select', required: true, options: LEAD_SOURCES },
  { key: 'campaign_id', label: 'Campaign', type: 'select', options: campaigns.map((c) => [c.id, c.name]) },
  { key: 'broker_id', label: 'Broker / partner', type: 'select', options: brokers.map((b) => [b.id, b.name]) },
  { key: 'referrer_customer_id', label: 'Referred by tenant', type: 'select', options: tenants.map((t) => [t.id, t.full_name]), hidden: () => !tenants.length },
  { key: 'message', label: 'Message / notes', type: 'textarea', keepEmpty: true },
]

function AddEnquiry({ onClose, onDone }) {
  const { property, properties } = useScope()
  const lists = useAsync(() => Promise.all([m.rows('brokers', '*'), m.rows('campaigns', '*', (q) => q.eq('active', true)), m.loadTenants().catch(() => [])]), [])
  const [v, setV] = useState({ name: '', phone: '', source: 'walk_in', property_id: property || properties[0]?.id })
  const [dupe, setDupe] = useState(null)
  const a = useAction()
  const check = async (phone) => {
    const digits = phone.replace(/\D/g, '').slice(-10)
    if (digits.length < 10) return setDupe(null)
    const found = await m.rows('enquiries', 'id, name, status', (q) => q.eq('phone', digits).limit(1)).catch(() => [])
    setDupe(found[0] ?? null)
  }
  const fields = ENQUIRY_FIELDS(properties, lists.data?.[0], lists.data?.[1], (lists.data?.[2] ?? []).filter((t) => t.bookings.some((b) => b.status === 'active')))
  const save = async () => {
    const row = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x != null))
    if (row.budget) row.budget = Number(row.budget)
    const r = await a.run(() => m.insertRow('enquiries', row))
    if (r) onDone(r.id)
  }
  return (
    <Modal title="Add enquiry (walk-in, call…)" onClose={onClose} wide>
      <FormFields value={v} onChange={(x) => { setV(x); if (x.phone !== v.phone) check(x.phone) }} fields={fields} />
      {dupe && <div className="mt-3"><Notice tone="warn">This mobile already enquired: <Link className="underline" to={`/admin/enquiries/${dupe.id}`}>{dupe.name}</Link> ({label(dupe.status)}). Saving creates a linked duplicate.</Notice></div>}
      <ActionMsg action={a} />
      <Button className="mt-3" disabled={a.busy} onClick={save}>Save</Button>
    </Modal>
  )
}

function ImportCsv({ onClose, onDone }) {
  const [rows, setRows] = useState([])
  const [result, setResult] = useState(null)
  const a = useAction()
  const read = (file) => a.run(async () => setRows(parseCSV(await file.text())))
  return (
    <Modal title="Import enquiries from CSV" onClose={onClose} wide>
      <p className="text-sm text-slate-600">Columns (header row): name, phone, email, property_id, room_type, budget, move_in (YYYY-MM-DD), source, message, status, lost_reason, received_at. Same mobile numbers are flagged as duplicates.</p>
      <div className="mt-3"><FileButton label="Choose CSV file" accept=".csv,text/csv" onFile={read} /></div>
      {rows.length > 0 && <p className="mt-3 text-sm">{rows.length} row(s) ready. First: {rows[0].name} · {rows[0].phone}</p>}
      {result && (
        <Notice tone={result.failed ? 'warn' : 'ok'}>
          Imported {result.imported} ({result.duplicates} duplicate mobiles). Failed {result.failed}.
          {result.errors?.slice(0, 10).map((e) => <span key={e.row} className="block">Row {e.row}: {e.error}</span>)}
        </Notice>
      )}
      <ActionMsg action={a} />
      <div className="mt-3 flex gap-2">
        {!result && <Button disabled={!rows.length || a.busy} onClick={async () => { const r = await a.run(() => m.importEnquiries(rows)); if (r) setResult(r) }}>Import</Button>}
        {result && <Button onClick={onDone}>Done</Button>}
      </div>
    </Modal>
  )
}

