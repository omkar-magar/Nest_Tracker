import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import CrudPanel from '../../components/manage/CrudPanel'
import DataTable from '../../components/manage/DataTable'
import { ActionMsg, FormFields, H3, Load, Small, StatusBadge, Tabs, useAction, useScope } from '../../components/manage/kit'
import { PaymentModal } from './TenantDetail'
import { Badge, Button, Card, Notice, Stat, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { INVOICE_TONES, invoiceState, label, monthStart, owed } from '../../services/pg'
import { invoicePdf } from '../../services/pdfDocs'
import { formatDate, formatDateTime, rupees, whatsappLink } from '../../services/format'

export default function Billing() {
  const [tab, setTab] = useState('invoices')
  const { role } = useAuth()
  return (
    <div>
      <Tabs tab={tab} onTab={setTab} tabs={[['invoices', 'Invoices'], ['overdue', 'Overdue & outstanding'], ['electricity', 'Electricity'], ['deposits', 'Deposits'], ['outbox', 'Reminders sent']]} />
      {tab === 'invoices' && <Invoices />}
      {tab === 'overdue' && <Overdue />}
      {tab === 'electricity' && <Electricity />}
      {tab === 'deposits' && <Deposits />}
      {tab === 'outbox' && <Outbox />}
      {role === 'admin' && <p className="mt-6 text-sm text-slate-600">Rent cycle, due day, late fee rules, reminder schedule and message templates: <Link className="underline" to="/admin/settings">Settings</Link>.</p>}
    </div>
  )
}

function Invoices() {
  const { property } = useScope()
  const [f, setF] = useState({ from: monthStart(), to: '', status: '' })
  const [paying, setPaying] = useState(null)
  const a = useAction()
  return (
    <Load loader={() => m.loadInvoices(f)} deps={[f.from, f.to, f.status]}>
      {(list, reload) => {
        const rows = list.filter((b) => !property || b.bookings?.property_id === property).map((b) => ({ ...b, state: invoiceState(b) }))
        const sum = (k) => rows.reduce((s, b) => s + k(b), 0)
        return (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Billed" value={rupees(sum((b) => b.amount))} />
              <Stat label="Collected" value={rupees(sum((b) => b.amount_paid))} />
              <Stat label="Outstanding" value={rupees(sum(owed))} />
              <Stat label="Overdue" value={rupees(sum((b) => (b.state === 'overdue' ? owed(b) : 0)))} tone="red" />
            </div>
            <DataTable title="Invoices" rows={rows}
              filters={(
                <>
                  <label className="text-sm">From <input type="date" className={`${inputCls} !w-auto`} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
                  <label className="text-sm">To <input type="date" className={`${inputCls} !w-auto`} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
                  <select aria-label="Status" className={`${inputCls} !w-auto`} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                    <option value="">All</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option>
                  </select>
                  <Button variant="outline" className="!py-1.5" disabled={a.busy} onClick={async () => { const n = await a.run(() => m.generateInvoices()); if (n !== undefined) { a.clear(); reload() } }}>Generate due invoices</Button>
                </>
              )}
              columns={[
                { key: 'invoice_no', label: 'Invoice' },
                { key: 'tenant', label: 'Tenant', render: (b) => <Link className="underline" to={`/admin/tenants/${b.customer_id}`}>{b.profiles?.full_name}</Link>, value: (b) => b.profiles?.full_name },
                { key: 'room', label: 'Room', value: (b) => b.bookings?.rooms?.room_no },
                { key: 'description', label: 'For' },
                { key: 'due_date', label: 'Due', render: (b) => formatDate(b.due_date) },
                { key: 'amount', label: 'Amount', render: (b) => rupees(b.amount), value: (b) => b.amount },
                { key: 'paid', label: 'Paid', render: (b) => rupees(b.amount_paid), value: (b) => b.amount_paid },
                { key: 'state', label: 'Status', render: (b) => <Badge tone={INVOICE_TONES[b.state]}>{label(b.state)}</Badge>, value: (b) => b.state },
                { key: 'x', label: '', noExport: true, noSort: true, render: (b) => (
                  <span className="flex gap-1">
                    {b.status === 'unpaid' && <Small onClick={() => setPaying(b)}>Payment</Small>}
                    <Small onClick={() => invoicePdf({ bill: b, tenant: b.profiles, room: b.bookings?.rooms?.room_no })}>PDF</Small>
                  </span>
                ) },
              ]} />
            <ActionMsg action={a} />
            {paying && <PaymentModal bill={paying} customerId={paying.customer_id} onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload() }} />}
          </>
        )
      }}
    </Load>
  )
}

// PRD 4.5 overdue dashboard + 4.7 outstanding report with ageing, export and one-click reminder
function Overdue() {
  const { property } = useScope()
  const [bucket, setBucket] = useState('')
  const a = useAction()
  return (
    <Load loader={() => m.rpc('report_outstanding', { p_property: property || null })} deps={[property]}>
      {(list) => {
        const buckets = ['0-7', '8-15', '16-30', '30+']
        const overdue = list.filter((r) => r.days_overdue > 0)
        const rows = list.filter((r) => !bucket || (r.days_overdue > 0 && r.bucket === bucket))
        return (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="Overdue tenants" value={new Set(overdue.map((r) => r.customer_id)).size} />
              {buckets.map((b) => <Stat key={b} label={`${b} days late`} value={rupees(overdue.filter((r) => r.bucket === b).reduce((s, r) => s + r.outstanding, 0))} />)}
            </div>
            <DataTable title="Outstanding dues" rows={rows}
              filters={(
                <select aria-label="Ageing" className={`${inputCls} !w-auto`} value={bucket} onChange={(e) => setBucket(e.target.value)}>
                  <option value="">All outstanding</option>{buckets.map((b) => <option key={b} value={b}>Overdue {b} days</option>)}
                </select>
              )}
              columns={[
                { key: 'tenant', label: 'Tenant', render: (r) => <Link className="underline" to={`/admin/tenants/${r.customer_id}`}>{r.tenant}{r.risk && ' ⚠'}</Link>, value: (r) => r.tenant },
                { key: 'property_id', label: 'Property' }, { key: 'room_no', label: 'Room' }, { key: 'month', label: 'Month' },
                { key: 'description', label: 'For' }, { key: 'due_date', label: 'Due', render: (r) => formatDate(r.due_date) },
                { key: 'days_overdue', label: 'Days late' }, { key: 'bucket', label: 'Ageing', value: (r) => (r.days_overdue > 0 ? r.bucket : 'not due') },
                { key: 'outstanding', label: 'Amount', render: (r) => rupees(r.outstanding), value: (r) => r.outstanding },
                { key: 'risk', label: 'Repeat defaulter', value: (r) => (r.risk ? 'yes' : '') },
                { key: 'x', label: '', noExport: true, noSort: true, render: (r) => (
                  <span className="flex gap-1">
                    <Small onClick={() => a.run(() => m.sendReminder(r.bill_id), `Reminder queued for ${r.tenant}`)}>Remind</Small>
                    {r.phone && <Small href={whatsappLink(r.phone, `Hi ${r.tenant}, a gentle reminder that ${rupees(r.outstanding)} for ${r.description} was due on ${formatDate(r.due_date)}. Pay in the app: ${window.location.origin}/account?pay=${r.bill_id}`)} target="_blank" rel="noopener">WhatsApp</Small>}
                  </span>
                ) },
              ]} />
            <div className="mt-2"><ActionMsg action={a} /></div>
          </>
        )
      }}
    </Load>
  )
}

// PRD 4.6 electricity: fixed per tenant, split equally among occupants, or sub-meter readings × unit rate
function Electricity() {
  const { property } = useScope()
  const [v, setV] = useState({ room: '', month: monthStart(), mode: 'meter', amount: '', prev: '', curr: '', rate: '' })
  const [shares, setShares] = useState(null)
  const a = useAction()
  return (
    <>
    <Load loader={() => Promise.all([m.loadRoomsWithBeds(property), m.loadMeterReadings(), m.loadElectricityIds(property)])} deps={[property]}>
      {([rooms, readings, ids], reload) => {
        const occupiedRooms = rooms.filter((r) => r.beds.some((b) => b.is_occupied))
        const last = readings.find((r) => r.room_id === v.room && r.mode === 'meter')
        const room = rooms.find((r) => r.id === v.room)
        const consumerId = room && m.electricityIndex(ids)[`${room.property_id}|${room.room_no}`]
        const submit = async (e) => {
          e.preventDefault()
          const res = await a.run(() => m.addElectricity(v), 'Added to each tenant\'s invoice')
          if (res) { setShares(res); reload() }
        }
        return (
          <div className="grid gap-6 lg:grid-cols-2">
            <form onSubmit={submit}>
              <Card>
                <H3>Add electricity charge</H3>
                <FormFields value={v} onChange={setV} fields={[
                  { key: 'room', label: 'Room', type: 'select', required: true, options: occupiedRooms.map((r) => [r.id, `${r.property_id} · ${r.room_no}`]) },
                  { key: 'month', label: 'Month', type: 'date', required: true },
                  { key: 'mode', label: 'Method', type: 'select', required: true, options: [['meter', 'Sub-meter readings'], ['split', 'Split amount equally'], ['fixed', 'Fixed amount per tenant']] },
                  { key: 'prev', label: `Previous reading${last ? ` (last: ${last.curr_reading})` : ''}`, type: 'number', step: 'any', hidden: (x) => x.mode !== 'meter', required: true },
                  { key: 'curr', label: 'Current reading', type: 'number', step: 'any', hidden: (x) => x.mode !== 'meter', required: true },
                  { key: 'rate', label: 'Rate per unit (₹)', type: 'number', step: 'any', hidden: (x) => x.mode !== 'meter', required: true },
                  { key: 'amount', label: (v.mode === 'fixed' ? 'Amount per tenant (₹)' : 'Total bill for the room (₹)'), type: 'number', min: 1, hidden: (x) => x.mode === 'meter', required: true },
                ]} />
                {room && <p className="mt-2 text-sm">Electricity consumer ID for {room.wing ? `${room.wing}-` : ''}{room.room_no}: <strong>{consumerId || 'not added yet'}</strong></p>}
                {v.mode === 'meter' && v.prev !== '' && v.curr !== '' && v.rate !== '' && (
                  <p className="mt-2 text-sm">{Number(v.curr) - Number(v.prev)} units × ₹{v.rate} = <strong>{rupees(Math.round((Number(v.curr) - Number(v.prev)) * Number(v.rate)))}</strong>, shared by beds occupied</p>
                )}
                <div className="mt-3"><ActionMsg action={a} /></div>
                <Button type="submit" className="mt-3" disabled={a.busy}>Add to invoices</Button>
                {shares && <ul className="mt-3 text-sm">{shares.map((s) => <li key={s.booking_id}>{s.name}: {rupees(s.amount)}</li>)}</ul>}
              </Card>
            </form>
            <div>
              <H3>Recent readings</H3>
              <DataTable title="Electricity" search={false} rows={readings} columns={[
                { key: 'room', label: 'Room', value: (r) => `${r.rooms?.property_id} · ${r.rooms?.room_no}` },
                { key: 'month', label: 'Month', value: (r) => new Date(r.month).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) },
                { key: 'mode', label: 'Method', value: (r) => label(r.mode) },
                { key: 'units', label: 'Units', value: (r) => (r.units ?? '—') }, { key: 'amount', label: 'Total', render: (r) => rupees(r.amount) },
              ]} />
            </div>
          </div>
        )
      }}
    </Load>
    <ConsumerIds />
    </>
  )
}

// Board (MSEDCL) consumer ID per flat; residents see their own on their account page
function ConsumerIds() {
  const { property, properties } = useScope()
  return (
    <div className="mt-8">
      <H3>Electricity consumer IDs</H3>
      <p className="mb-2 text-sm text-slate-600">Residents pay the electricity bill with their flat's consumer ID and see it on their account page.</p>
      <CrudPanel table="electricity_connections" title="Consumer IDs" deps={[property]} addLabel="Add consumer ID"
        query={(q) => (property ? q.eq('property_id', property) : q).order('property_id').order('room_no')}
        defaults={{ property_id: property || properties[0]?.id }}
        columns={[
          { key: 'property_id', label: 'Property' }, { key: 'room_no', label: 'Flat' },
          { key: 'consumer_id', label: 'Consumer ID' }, { key: 'note', label: 'Note' },
        ]}
        fields={[
          { key: 'property_id', label: 'Property (wing)', type: 'select', required: true, options: properties.map((p) => [p.id, p.name]) },
          { key: 'room_no', label: 'Flat number (without wing)', required: true, help: 'e.g. 101' },
          { key: 'consumer_id', label: 'Consumer ID', required: true, help: 'Digits only, as printed on the electricity bill' },
          { key: 'note', label: 'Note', keepEmpty: true },
        ]} />
    </div>
  )
}

// PRD 4.4 deposits per tenant and total held per property
function Deposits() {
  const { property } = useScope()
  return (
    <Load loader={() => Promise.all([m.rpc('report_deposits', { p_property: property || null }), m.rpc('report_deposits_held', { p_property: property || null })])} deps={[property]}>
      {([list, held]) => (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {held.map((h) => <Stat key={h.property_id} label={`Held · ${h.property_id}`} value={rupees(h.held)} hint={`${rupees(h.pending)} not yet received · ${rupees(h.refunded)} refunded`} />)}
          </div>
          <DataTable title="Security deposits" rows={list} columns={[
            { key: 'tenant', label: 'Tenant', render: (r) => <Link className="underline" to={`/admin/tenants/${r.customer_id}`}>{r.tenant}</Link>, value: (r) => r.tenant },
            { key: 'property_id', label: 'Property' }, { key: 'room_no', label: 'Room' },
            { key: 'amount', label: 'Agreed', render: (r) => rupees(r.amount) }, { key: 'received', label: 'Received', render: (r) => rupees(r.received) },
            { key: 'received_on', label: 'On', render: (r) => formatDate(r.received_on) }, { key: 'mode', label: 'Mode', value: (r) => label(r.mode) },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} />, value: (r) => r.status },
            { key: 'deducted', label: 'Deducted', render: (r) => rupees(r.deducted) }, { key: 'refunded', label: 'Refunded', render: (r) => rupees(r.refunded) },
            { key: 'held', label: 'Held now', render: (r) => rupees(r.held) },
          ]} />
        </>
      )}
    </Load>
  )
}

// What the reminder engine queued and whether each channel delivered it
function Outbox() {
  const { role } = useAuth()
  if (role !== 'admin') return <Notice>Only the owner can see the message log.</Notice>
  return (
    <Load loader={() => m.rows('notifications', '*', (q) => q.neq('channel', 'in_app').order('created_at', { ascending: false }).limit(300))}>
      {(list) => (
        <DataTable title="Messages" rows={list} columns={[
          { key: 'created_at', label: 'Queued', render: (n) => formatDateTime(n.created_at) }, { key: 'kind', label: 'Kind', value: (n) => label(n.kind) },
          { key: 'channel', label: 'Channel', value: (n) => label(n.channel) }, { key: 'to', label: 'To', value: (n) => n.to_phone || n.to_email || '' },
          { key: 'body', label: 'Message', className: 'max-w-xs whitespace-pre-line' },
          { key: 'status', label: 'Status', render: (n) => <span><StatusBadge value={n.status} tones={{ sent: 'green', queued: 'amber', skipped: 'gray' }} />{n.error && <span className="block text-xs text-slate-500">{n.error}</span>}</span>, value: (n) => n.status },
        ]} />
      )}
    </Load>
  )
}

