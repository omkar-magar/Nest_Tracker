import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import useAsync from '../../hooks/useAsync'
import DataTable from '../../components/manage/DataTable'
import { ActionMsg, FileButton, FormFields, Modal, StatusBadge, Tabs, useAction, useScope } from '../../components/manage/kit'
import { Button, ErrorBox, Notice, TableSkeleton, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { ENQUIRY_STATUSES, LEAD_SOURCES, LOST_REASONS, label } from '../../services/pg'
import { exportCSV, parseCSV } from '../../services/exporters'
import { formatDate, formatDateTime } from '../../services/format'
import { useAuth } from '../../context/AuthContext'
import Coupons from '../../components/manage/Coupons'

const RAW_COLUMNS = ['received_at', 'name', 'phone', 'email', 'property_id', 'room_type', 'budget', 'move_in', 'source', 'message', 'status', 'lost_reason', 'temperature']

export default function Enquiries() {
  const { property } = useScope()
  const { role } = useAuth()
  const data = useAsync(() => Promise.all([m.loadEnquiries(), m.loadStaffLogins(), m.loadMyFollowUps()]), [])
  const [view, setView] = useState('list')
  const [f, setF] = useState({ status: '', source: '', assigned: '', from: '', to: '' })
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const navigate = useNavigate()

  const rows = useMemo(() => (data.data?.[0] ?? []).filter((e) => (!property || e.property_id === property)
    && (!f.status || e.status === f.status) && (!f.source || e.source === f.source) && (!f.assigned || e.assigned_to === f.assigned)
    && (!f.from || e.received_at >= f.from) && (!f.to || e.received_at.slice(0, 10) <= f.to)), [data.data, property, f])

  if (data.loading) return <TableSkeleton />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const [, staff, followUps] = data.data
  const execs = staff.filter((s) => ['sales', 'manager', 'admin'].includes(s.role))
  const name = (id) => staff.find((s) => s.id === id)?.full_name ?? ''
  const today = new Date(); today.setHours(23, 59, 59)
  const dueFollowUps = followUps.filter((x) => new Date(x.due_at) <= today)

  const filters = (
    <>
      <select aria-label="Status" className={`${inputCls} !w-auto`} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
        <option value="">All statuses</option>{ENQUIRY_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
      </select>
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
      <Tabs tab={view} onTab={setView} tabs={[['list', 'List'], ['board', 'Board'], ...(['admin', 'manager'].includes(role) ? [['coupons', 'Coupons']] : [])]} label="View" />
      {view === 'coupons' ? <Coupons /> : view === 'list' ? (
        <DataTable title="Enquiries" rows={rows} filters={filters} onRowClick={(e) => navigate(`/admin/enquiries/${e.id}`)} columns={[
          { key: 'received_at', label: 'Received', render: (e) => formatDate(e.received_at), value: (e) => e.received_at },
          { key: 'name', label: 'Name', render: (e) => <span className="font-medium">{e.name}{e.duplicate_of && <span className="ml-1 text-xs text-gold-deep">duplicate</span>}</span>, value: (e) => e.name },
          { key: 'phone', label: 'Mobile' }, { key: 'room_type', label: 'Looking for' },
          { key: 'move_in', label: 'Move-in', render: (e) => formatDate(e.move_in), value: (e) => e.move_in },
          { key: 'source', label: 'Source', value: (e) => label(e.source) },
          { key: 'temperature', label: 'Lead', render: (e) => <StatusBadge value={e.temperature} />, value: (e) => e.temperature },
          { key: 'status', label: 'Status', render: (e) => <StatusBadge value={e.status} />, value: (e) => e.status },
          { key: 'assigned_to', label: 'Assigned', value: (e) => name(e.assigned_to) },
          { key: 'next_follow_up_at', label: 'Next follow-up', render: (e) => formatDateTime(e.next_follow_up_at), value: (e) => e.next_follow_up_at },
        ]} />
      ) : <Board rows={rows} onChanged={data.reload} filters={filters} />}
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

