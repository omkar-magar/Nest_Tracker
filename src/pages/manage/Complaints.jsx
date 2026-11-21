import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import CrudPanel from '../../components/manage/CrudPanel'
import DataTable from '../../components/manage/DataTable'
import { ActionMsg, Fact, FileButton, FormFields, Load, Modal, Small, StatusBadge, Tabs, useAction, useScope } from '../../components/manage/kit'
import { Button, Stat, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { COMPLAINT_CATEGORIES, PRIORITIES, complaintCategory, complaintMoves, label } from '../../services/pg'
import { formatDate, formatDateTime, rupees } from '../../services/format'

export default function Complaints() {
  const [tab, setTab] = useState('tickets')
  return (
    <div>
      <Tabs tab={tab} onTab={setTab} tabs={[['tickets', 'Complaints'], ['history', 'Maintenance history'], ['preventive', 'Preventive maintenance'], ['vendors', 'Vendors']]} />
      {tab === 'tickets' && <Tickets />}
      {tab === 'history' && <History />}
      {tab === 'preventive' && <Preventive />}
      {tab === 'vendors' && <Vendors />}
    </div>
  )
}

const hours = (c) => (c.resolved_at ? (new Date(c.resolved_at) - new Date(c.created_at)) / 36e5 : null)
const overdue = (c) => ['new', 'assigned', 'in_progress'].includes(c.status) && c.due_at && new Date(c.due_at) < new Date()

function Tickets() {
  const { property } = useScope()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState('open')
  const [logging, setLogging] = useState(() => params.get('new') === '1') // dashboard's "Raise maintenance"
  return (
    <Load loader={m.loadComplaints}>
      {(all, reload) => {
        const list = all.filter((c) => !property || c.property_id === property)
        const open = list.filter((c) => ['new', 'assigned', 'in_progress'].includes(c.status))
        const resolved = list.filter((c) => c.resolved_at)
        const avg = resolved.length ? (resolved.reduce((s, c) => s + hours(c), 0) / resolved.length).toFixed(1) : '—'
        const rows = list.filter((c) => status === 'all' || (status === 'open' && open.includes(c)) || (status === 'overdue' && overdue(c)) || c.status === status)
        const current = all.find((c) => c.id === params.get('open'))
        return (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Pending" value={open.length} /><Stat label="Resolved / closed" value={list.length - open.length} />
              <Stat label="Overdue" value={list.filter(overdue).length} tone={list.some(overdue) ? 'red' : undefined} />
              <Stat label="Average resolution" value={`${avg} h`} />
            </div>
            <DataTable title="Complaints" rows={rows} onRowClick={(c) => setParams({ open: c.id })}
              filters={(
                <>
                  <select aria-label="Status" className={`${inputCls} !w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="open">Open</option><option value="overdue">Overdue</option>
                    {['new', 'assigned', 'in_progress', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{label(s)}</option>)}<option value="all">All</option>
                  </select>
                  <Button className="!py-1.5" onClick={() => setLogging(true)}>Log complaint</Button>
                </>
              )}
              columns={[
                { key: 'ticket_no', label: '#' }, { key: 'title', label: 'Issue', render: (c) => <span className="font-medium">{c.title}{overdue(c) && <span className="ml-1 text-xs text-red-700">overdue</span>}</span>, value: (c) => c.title },
                { key: 'category', label: 'Category', value: (c) => complaintCategory(c.category) },
                { key: 'where', label: 'Where', value: (c) => (c.is_common_area ? `${c.property_id} common area` : `${c.property_id} · ${c.rooms?.room_no ?? ''}`) },
                { key: 'who', label: 'Tenant', value: (c) => c.profiles?.full_name ?? '' },
                { key: 'priority', label: 'Priority', render: (c) => <StatusBadge value={c.priority} tones={{ medium: 'amber', low: 'gray' }} />, value: (c) => c.priority },
                { key: 'status', label: 'Status', render: (c) => <StatusBadge value={c.status} />, value: (c) => c.status },
                { key: 'created_at', label: 'Raised', render: (c) => formatDateTime(c.created_at), value: (c) => c.created_at },
                { key: 'due_at', label: 'Due', render: (c) => formatDateTime(c.due_at), value: (c) => c.due_at },
              ]} />
            {logging && <LogComplaint onClose={() => setLogging(false)} onDone={() => { setLogging(false); reload() }} />}
            {current && <ComplaintPanel c={current} onClose={() => setParams({})} onChanged={reload} />}
          </>
        )
      }}
    </Load>
  )
}

// PRD 6.1: office logs a complaint for a tenant (phoned in) or for a common area
function LogComplaint({ onClose, onDone }) {
  const { property, properties } = useScope()
  const [v, setV] = useState({ property_id: property || properties[0]?.id, customer_id: '', is_common_area: true, category: 'electrical', title: '', description: '', priority: 'medium', preferred_time: '' })
  const a = useAction()
  return (
    <Load loader={() => m.loadTenants(v.property_id)} deps={[v.property_id]}>
      {(tenants) => (
        <Modal title="Log a complaint" onClose={onClose}>
          <FormFields value={v} onChange={setV} fields={[
            { key: 'property_id', label: 'Property', type: 'select', required: true, options: properties.map((p) => [p.id, p.name]) },
            { key: 'customer_id', label: 'Tenant (blank = common area)', type: 'select', options: tenants.filter((t) => t.bookings.some((b) => b.status === 'active')).map((t) => [t.id, t.full_name]) },
            { key: 'category', label: 'Category', type: 'select', required: true, options: COMPLAINT_CATEGORIES.map((c) => [c, complaintCategory(c)]) },
            { key: 'priority', label: 'Priority', type: 'select', required: true, options: PRIORITIES },
            { key: 'title', label: 'Short title', required: true, span: true }, { key: 'description', label: 'Details', type: 'textarea' },
            { key: 'preferred_time', label: 'Preferred time to visit' },
          ]} />
          <ActionMsg action={a} />
          <Button className="mt-3" disabled={a.busy} onClick={async () => (await a.run(() => m.raiseComplaint({ ...v, is_common_area: !v.customer_id }))) && onDone()}>Save</Button>
        </Modal>
      )}
    </Load>
  )
}

// PRD 6.2: assign (staff or vendor), priority, status flow with notes, cost and photos, full timeline
function ComplaintPanel({ c, onClose, onChanged }) {
  const { user } = useAuth()
  const [v, setV] = useState({ assigned_to: c.assigned_to ?? '', staff_member_id: c.staff_member_id ?? '', vendor_id: c.vendor_id ?? '', priority: c.priority,
    resolution: c.resolution, fixed_by: c.fixed_by, cost: c.cost, note: '' })
  const [after, setAfter] = useState(c.after_photos ?? [])
  const a = useAction()
  const save = (extra = {}) => a.run(async () => {
    await m.updateComplaint(c.id, { priority: v.priority, assigned_to: v.assigned_to || null, staff_member_id: v.staff_member_id || null, vendor_id: v.vendor_id || null,
      resolution: v.resolution, fixed_by: v.fixed_by, cost: Number(v.cost || 0), after_photos: after, note: v.note, ...extra })
    setV((x) => ({ ...x, note: '' }))
    onChanged()
  }, 'Saved')
  const view = (p) => a.run(async () => window.open(await m.fileUrl('complaint-media', p), '_blank', 'noopener'))
  return (
    <Load loader={() => Promise.all([m.staffDirectory(c.property_id), m.rows('vendors', '*', (q) => q.eq('is_active', true)), m.loadComplaintEvents(c.id)])} deps={[c.id, c.status]}>
      {([staff, vendors, events]) => (
        <Modal title={`#${c.ticket_no} · ${c.title}`} onClose={onClose} wide>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Fact k="Status"><StatusBadge value={c.status} /></Fact><Fact k="Category">{complaintCategory(c.category)}</Fact>
            <Fact k="Where">{c.is_common_area ? 'Common area' : `Room ${c.rooms?.room_no ?? ''} ${c.beds?.code ?? ''}`}</Fact>
            <Fact k="Tenant">{c.profiles?.full_name}{c.profiles?.phone ? ` · ${c.profiles.phone}` : ''}</Fact>
            <Fact k="Raised">{formatDateTime(c.created_at)}</Fact><Fact k="Expected by">{formatDateTime(c.due_at)}</Fact>
            <Fact k="Preferred time">{c.preferred_time}</Fact><Fact k="Rating">{c.rating ? `${c.rating}/5 ${c.feedback}` : '—'}</Fact>
          </dl>
          {c.description && <p className="mt-3 whitespace-pre-line rounded-xl bg-cream p-3 text-sm">{c.description}</p>}
          {c.photos?.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{c.photos.map((p, i) => <Small key={p} onClick={() => view(p)}>Photo / video {i + 1}</Small>)}</div>}
          <div className="mt-4">
            <FormFields value={v} onChange={setV} fields={[
              { key: 'assigned_to', label: 'Assign to staff (with app login)', type: 'select', options: staff.filter((s) => s.user_id).map((s) => [s.user_id, `${s.full_name} · ${label(s.designation)}`]) },
              { key: 'staff_member_id', label: 'or staff without login', type: 'select', options: staff.filter((s) => !s.user_id).map((s) => [s.id, s.full_name]) },
              { key: 'vendor_id', label: 'or external vendor', type: 'select', options: vendors.map((x) => [x.id, `${x.name} · ${x.trade}`]) },
              { key: 'priority', label: 'Priority', type: 'select', required: true, options: PRIORITIES },
              { key: 'fixed_by', label: 'Fixed by' }, { key: 'cost', label: 'Repair cost (₹, goes to expenses)', type: 'number', min: 0 },
              { key: 'resolution', label: 'Work done', type: 'textarea' }, { key: 'note', label: 'Note for this update', type: 'textarea' },
            ]} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <FileButton label="Add after photos" accept="image/*,video/*" multiple onFile={(files) => a.run(async () => {
              const paths = []
              for (const f of files) paths.push(await m.uploadFile('complaint-media', user.id, f))
              setAfter((x) => [...x, ...paths])
            })} />
            {after.map((p, i) => <Small key={p} onClick={() => view(p)}>After {i + 1}</Small>)}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => save()} disabled={a.busy}>Save</Button>
            {complaintMoves(c.status, { manage: true }).map((s) => (
              <Button key={s} variant="outline" disabled={a.busy} onClick={() => save({ status: s })}>{s === 'reopen' ? 'Reopen' : `Mark ${label(s).toLowerCase()}`}</Button>
            ))}
          </div>
          <div className="mt-2"><ActionMsg action={a} /></div>
          <h3 className="mb-2 mt-6 font-semibold">Timeline</h3>
          <ol className="space-y-1 text-sm">
            {events.map((e) => (
              <li key={e.id} className="border-l-2 border-gold pl-3">
                <span className="text-xs text-slate-500">{formatDateTime(e.created_at)} · {e.profiles?.full_name ?? 'System'}</span>
                <p>{e.from_status && e.from_status !== e.to_status ? `${label(e.from_status)} → ` : ''}{label(e.to_status)}{e.note ? ` · ${e.note}` : ''}</p>
              </li>
            ))}
          </ol>
        </Modal>
      )}
    </Load>
  )
}

// PRD 6.3: everything fixed, per property / room / bed, with who, when, cost and photos
function History() {
  const { property } = useScope()
  return (
    <Load loader={m.loadComplaints}>
      {(all) => (
        <DataTable title="Maintenance history" rows={all.filter((c) => c.resolved_at && (!property || c.property_id === property))} columns={[
          { key: 'resolved_at', label: 'Fixed on', render: (c) => formatDate(c.resolved_at), value: (c) => c.resolved_at },
          { key: 'property_id', label: 'Property' }, { key: 'room', label: 'Room', value: (c) => (c.is_common_area ? 'Common area' : c.rooms?.room_no) },
          { key: 'bed', label: 'Bed', value: (c) => c.beds?.code ?? '' }, { key: 'title', label: 'Issue' },
          { key: 'category', label: 'Category', value: (c) => complaintCategory(c.category) }, { key: 'fixed_by', label: 'Fixed by', value: (c) => c.fixed_by || c.vendors?.name || '' },
          { key: 'resolution', label: 'Work done' }, { key: 'cost', label: 'Cost', render: (c) => rupees(c.cost), value: (c) => c.cost },
          { key: 'photos', label: 'Photos', value: (c) => `${c.photos.length} before / ${c.after_photos.length} after` },
          { key: 'hours', label: 'Hours to fix', value: (c) => hours(c)?.toFixed(1) },
        ]} />
      )}
    </Load>
  )
}

function Preventive() {
  const { property, properties } = useScope()
  return (
    <Load loader={() => m.rows('vendors', '*')}>
      {(vendors) => (
        <CrudPanel table="maintenance_schedules" title="Preventive maintenance" deps={[property]} query={(q) => (property ? q.eq('property_id', property) : q).order('next_due')}
          defaults={{ property_id: property || properties[0]?.id, interval_days: 90, remind_days: 3, active: true, next_due: new Date().toISOString().slice(0, 10) }}
          columns={[
            { key: 'title', label: 'Task' }, { key: 'property_id', label: 'Property' }, { key: 'interval_days', label: 'Every (days)' },
            { key: 'next_due', label: 'Next due', render: (r) => formatDate(r.next_due) }, { key: 'remind_days', label: 'Remind days before' },
            { key: 'active', label: 'Status', render: (r) => <StatusBadge value={r.active ? 'active' : 'stopped'} /> },
          ]}
          fields={[
            { key: 'property_id', label: 'Property', type: 'select', required: true, options: properties.map((p) => [p.id, p.name]) },
            { key: 'title', label: 'Task (AC servicing, water tank cleaning, pest control, fire extinguisher check…)', required: true, span: true },
            { key: 'interval_days', label: 'Repeat every (days)', type: 'number', required: true, min: 1 }, { key: 'next_due', label: 'Next due', type: 'date', required: true },
            { key: 'remind_days', label: 'Remind this many days before', type: 'number', min: 0 },
            { key: 'vendor_id', label: 'Vendor', type: 'select', options: vendors.map((x) => [x.id, x.name]) },
            { key: 'active', label: 'Active', type: 'checkbox' },
          ]} />
      )}
    </Load>
  )
}

function Vendors() {
  const { property, properties } = useScope()
  return (
    <CrudPanel table="vendors" title="Vendors" query={(q) => q.order('name')} defaults={{ property_id: property || null, is_active: true }}
      columns={[{ key: 'name', label: 'Name' }, { key: 'trade', label: 'Trade' }, { key: 'phone', label: 'Phone' }, { key: 'property_id', label: 'Property', value: (r) => r.property_id ?? 'All' },
        { key: 'is_active', label: 'Status', render: (r) => <StatusBadge value={r.is_active ? 'active' : 'inactive'} /> }]}
      fields={[
        { key: 'name', label: 'Name', required: true }, { key: 'trade', label: 'Trade (electrician, plumber…)', keepEmpty: true }, { key: 'phone', label: 'Phone', type: 'tel', keepEmpty: true },
        { key: 'property_id', label: 'Property (blank = all)', type: 'select', options: properties.map((p) => [p.id, p.name]) },
        { key: 'notes', label: 'Notes', type: 'textarea', keepEmpty: true }, { key: 'is_active', label: 'Active', type: 'checkbox' },
      ]} />
  )
}
