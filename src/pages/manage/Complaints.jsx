import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import CrudPanel from '../../components/manage/CrudPanel'
import DataTable from '../../components/manage/DataTable'
import { ActionMsg, Fact, FileButton, FormFields, Load, Modal, StatusBadge, Tabs, useAction, useScope } from '../../components/manage/kit'
import { ComplaintImages, ComplaintStatusBadge, ComplaintTimeline, PriorityBadge } from '../../components/complaints/ComplaintParts'
import { Button, Card, Field, Notice, Stat, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import * as cx from '../../services/complaints'
import { COMPLAINT_CATEGORIES, PRIORITIES, complaintCategory, complaintMoves, complaintStatus, filterComplaints, isComplaintActive,
  isComplaintOverdue, label, ymd } from '../../services/pg'
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
const fmtHours = (h) => (h === null || h === undefined ? '—' : `${h} h`)
const where = (c) => (c.is_common_area ? `${c.property_id} · common area` : `${c.property_id} · ${c.room_label || c.rooms?.room_no || ''}`)

// Both managers see every complaint in both buildings; the building filter here is only a view filter.
function Tickets() {
  const { user, role } = useAuth()
  const { properties } = useScope()
  const [params, setParams] = useSearchParams()
  const [building, setBuilding] = useState('')
  const [filter, setFilter] = useState('all')
  const [logging, setLogging] = useState(() => params.get('new') === '1') // dashboard's "Raise maintenance"
  const admin = role === 'admin'
  return (
    <Load loader={() => Promise.all([cx.loadBoard(), cx.complaintStats(building), cx.complaintAssignees()])} deps={[building]}>
      {([all, stats, people], reload) => {
        const names = Object.fromEntries(people.map((p) => [p.id, p.full_name]))
        const list = all.filter((c) => !building || c.property_id === building)
        const filters = [['all', 'All'], ['unassigned', 'Unassigned'], ...(admin ? [] : [['mine', 'Assigned to me']]),
          ...['new', 'assigned', 'in_progress', 'resolved', 'closed'].map((s) => [s, complaintStatus(s)])]
        const rows = filterComplaints(list, filter, user.id)
        const current = all.find((c) => c.id === params.get('open'))
        return (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="Total" value={stats.total} hint={`${stats.unassigned} unassigned`} />
              <Stat label="Pending" value={stats.pending} hint="Open or assigned" tone={stats.overdue ? 'red' : undefined} />
              <Stat label="In progress" value={stats.in_progress} />
              <Stat label="Resolved" value={stats.resolved} hint={`${stats.closed} closed`} />
              <Stat label="Avg. resolution" value={fmtHours(stats.avg_resolution_hours)} hint={stats.overdue ? `${stats.overdue} overdue` : undefined} />
            </div>
            {stats.by_assignee.length > 0 && (
              <Card className="mb-4 !p-4">
                <h3 className="mb-2 text-sm font-semibold">Complaints by manager</h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {stats.by_assignee.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-cream px-3 py-2 text-sm">
                      <span className="font-medium">{p.name}{p.role !== 'manager' && <span className="text-xs text-slate-500"> · {label(p.role)}</span>}</span>
                      <span className="text-slate-700">{p.active} active · {p.resolved} resolved · avg {fmtHours(p.avg_hours)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <div role="group" aria-label="Filter complaints" className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {filters.map(([k, text]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                  className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${filter === k ? 'border-navy bg-navy text-white' : 'border-navy/20 text-navy hover:bg-navy/5'}`}>
                  {text} <span className={filter === k ? 'text-white/80' : 'text-slate-500'}>{filterComplaints(list, k, user.id).length}</span>
                </button>
              ))}
            </div>
            <DataTable title="Complaints" rows={rows} onRowClick={(c) => setParams({ open: c.id })}
              empty={filter === 'all' ? 'No complaints yet' : 'No complaints match this filter'}
              filters={(
                <>
                  <select aria-label="Building" className={`${inputCls} !w-auto`} value={building} onChange={(e) => setBuilding(e.target.value)}>
                    <option value="">All buildings</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <Button className="!py-1.5" onClick={() => setLogging(true)}>Log complaint</Button>
                </>
              )}
              columns={[
                { key: 'ticket_no', label: '#' },
                { key: 'title', label: 'Issue', value: (c) => c.title,
                  render: (c) => <span className="font-medium">{c.title}{isComplaintOverdue(c) && <span className="ml-1 text-xs text-red-700">overdue</span>}{c.reopen_count > 0 && <span className="ml-1 text-xs text-slate-500">reopened</span>}</span> },
                { key: 'category', label: 'Category', value: (c) => complaintCategory(c.category) },
                { key: 'where', label: 'Where', value: where },
                { key: 'who', label: 'Resident', value: (c) => c.profiles?.full_name ?? '' },
                { key: 'assigned_to', label: 'Assigned to', value: (c) => (c.assigned_to ? names[c.assigned_to] ?? 'Staff' : 'Unassigned'),
                  render: (c) => (c.assigned_to ? names[c.assigned_to] ?? 'Staff' : <span className="text-slate-500">Unassigned</span>) },
                { key: 'priority', label: 'Priority', render: (c) => <PriorityBadge priority={c.priority} />, value: (c) => c.priority },
                { key: 'status', label: 'Status', render: (c) => <ComplaintStatusBadge status={c.status} />, value: (c) => complaintStatus(c.status) },
                { key: 'created_at', label: 'Raised', render: (c) => formatDateTime(c.created_at), value: (c) => c.created_at },
              ]} />
            {logging && <LogComplaint onClose={() => setLogging(false)} onDone={() => { setLogging(false); reload() }} />}
            {current && <ComplaintPanel key={current.id} c={current} people={people} names={names} onClose={() => setParams({})} onChanged={reload} />}
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


// One complaint. The owner assigns, reassigns, sets priority, closes and reopens. A manager takes an unassigned
// complaint and works only on their own. update_complaint() enforces the same rules.
const MOVE_TEXT = {
  in_progress: ['Start work', 'Mark this complaint as in progress?'],
  resolved: ['Mark resolved', 'Mark this complaint as resolved? The resident will be notified.'],
  closed: ['Close complaint', 'Close this complaint? Only the admin can reopen it after this.'],
  reopen: ['Reopen', 'Reopen this complaint?'],
}

function ComplaintPanel({ c, people, names, onClose, onChanged }) {
  const { user, role } = useAuth()
  const admin = role === 'admin'
  const mine = c.assigned_to === user.id
  const canWork = (admin || mine) && c.status !== 'closed'
  const [assignee, setAssignee] = useState(c.assigned_to ?? '')
  const [priority, setPriority] = useState(c.priority)
  const [work, setWork] = useState({ resolution: c.resolution, fixed_by: c.fixed_by, cost: c.cost, vendor_id: c.vendor_id ?? '', staff_member_id: c.staff_member_id ?? '' })
  const [after, setAfter] = useState(c.after_photos ?? [])
  const [note, setNote] = useState('')
  const [version, setVersion] = useState(0)
  const a = useAction()
  const act = async (fn, msg, ask) => {
    if (ask && !window.confirm(ask)) return
    if (await a.run(fn, msg)) { setNote(''); setVersion((v) => v + 1); onChanged() }
  }
  const workFields = () => ({ ...work, cost: Number(work.cost || 0), after_photos: after })
  const who = c.assigned_to ? names[c.assigned_to] ?? 'a staff member' : null

  return (
    <Modal title={`#${c.ticket_no} · ${c.title}`} onClose={onClose} wide>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Fact k="Status"><ComplaintStatusBadge status={c.status} /></Fact>
        <Fact k="Priority"><PriorityBadge priority={c.priority} /></Fact>
        <Fact k="Category">{complaintCategory(c.category)}</Fact>
        <Fact k="Where">{where(c)}{c.beds?.code ? ` · bed ${c.beds.code}` : ''}</Fact>
        <Fact k="Resident">{c.profiles?.full_name ?? (c.is_common_area ? 'Common area' : '—')}{c.profiles?.phone ? ` · ${c.profiles.phone}` : ''}</Fact>
        <Fact k="Assigned to">{who ?? 'Unassigned'}</Fact>
        <Fact k="Raised">{formatDateTime(c.created_at)}</Fact>
        <Fact k="Expected by">{formatDateTime(c.due_at)}{isComplaintOverdue(c) ? ' (overdue)' : ''}</Fact>
        {c.resolved_at && <Fact k="Resolved">{formatDateTime(c.resolved_at)}</Fact>}
        {c.preferred_time && <Fact k="Preferred time">{c.preferred_time}</Fact>}
        {c.rating && <Fact k="Rating">{`${c.rating}/5 ${c.feedback}`}</Fact>}
        {c.reopen_count > 0 && <Fact k="Reopened">{`${c.reopen_count} time(s)`}</Fact>}
      </dl>
      {c.description && <p className="mt-3 whitespace-pre-line rounded-xl bg-cream p-3 text-sm">{c.description}</p>}
      {c.photos?.length > 0 && <div className="mt-3"><p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Resident's images</p><ComplaintImages paths={c.photos} name="Resident image" /></div>}
      {c.after_photos?.length > 0 && <div className="mt-3"><p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Resolution images</p><ComplaintImages paths={c.after_photos} name="Resolution image" /></div>}

      {/* assignment */}
      <section aria-label="Assignment" className="mt-5 rounded-2xl border border-navy/10 p-4">
        <h3 className="mb-2 font-semibold">Assignment</h3>
        {admin ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Assign to">
              <select className={`${inputCls} sm:!w-72`} value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={c.status === 'closed'}>
                <option value="">Unassigned</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {label(p.role)}</option>)}
              </select>
            </Field>
            <Button disabled={a.busy || c.status === 'closed' || assignee === (c.assigned_to ?? '')}
              onClick={() => act(() => cx.assignComplaint(c.id, assignee, note), 'Assignment saved',
                assignee ? `${c.assigned_to ? 'Reassign' : 'Assign'} this complaint to ${names[assignee]}?` : `Remove ${who} from this complaint?`)}>
              {assignee ? (c.assigned_to ? 'Reassign' : 'Assign') : 'Unassign'}
            </Button>
            {c.status === 'closed' && <p className="text-sm text-slate-600">Reopen the complaint to assign it.</p>}
          </div>
        ) : !c.assigned_to ? (
          isComplaintActive(c) ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm">Nobody has taken this complaint yet.</p>
              <Button disabled={a.busy} onClick={() => act(() => cx.takeComplaint(c.id, user.id, note), 'It is yours now', 'Take responsibility for this complaint?')}>Assign to me</Button>
            </div>
          ) : <p className="text-sm text-slate-600">Not assigned.</p>
        ) : mine ? <p className="text-sm">Assigned to you.</p> : (
          <Notice>Assigned to {who}. Only the admin can reassign it.</Notice>
        )}
      </section>

      {/* priority (owner) */}
      {admin && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Priority">
            <select className={`${inputCls} !w-40`} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}
            </select>
          </Field>
          <Button variant="outline" disabled={a.busy || priority === c.priority} onClick={() => act(() => cx.setComplaintPriority(c.id, priority), 'Priority saved')}>Save priority</Button>
        </div>
      )}

      {/* work (owner or the assignee) */}
      {canWork && (
        <WorkForm c={c} work={work} setWork={setWork} after={after} setAfter={setAfter} userId={user.id} action={a}
          onSave={() => act(() => cx.saveComplaintWork(c.id, workFields()), 'Work details saved')} />
      )}

      {/* status and notes */}
      {(admin || mine) && (
        <div className="mt-4">
          <Field label="Note for this update (shown in the timeline)">
            <textarea rows={2} className={inputCls} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            {complaintMoves(c.status, { admin, mine }).map((s) => (
              <Button key={s} variant={s === 'closed' ? 'outline' : 'primary'} disabled={a.busy}
                onClick={() => act(() => cx.moveComplaint(c.id, s, note, s === 'resolved' && canWork ? workFields() : {}), `${MOVE_TEXT[s][0]} done`, MOVE_TEXT[s][1])}>
                {MOVE_TEXT[s][0]}
              </Button>
            ))}
            <Button variant="outline" disabled={a.busy || !note.trim()} onClick={() => act(() => cx.commentOnComplaint(c.id, note), 'Note added')}>Add note</Button>
          </div>
        </div>
      )}
      <div className="mt-2"><ActionMsg action={a} /></div>

      <h3 className="mb-2 mt-6 font-semibold">Activity</h3>
      <ComplaintTimeline id={c.id} version={version} />
    </Modal>
  )
}

function WorkForm({ c, work, setWork, after, setAfter, userId, action, onSave }) {
  return (
    <Load loader={() => Promise.all([m.staffDirectory(c.property_id), m.rows('vendors', 'id, name, trade', (q) => q.eq('is_active', true))])} deps={[c.property_id]}>
      {([staff, vendors]) => (
        <section aria-label="Resolution" className="mt-4 rounded-2xl border border-navy/10 p-4">
          <h3 className="mb-2 font-semibold">Resolution</h3>
          <FormFields value={work} onChange={setWork} fields={[
            { key: 'resolution', label: 'Resolution notes (needed to mark it resolved)', type: 'textarea', maxLength: 2000 },
            { key: 'fixed_by', label: 'Fixed by' }, { key: 'cost', label: 'Repair cost (₹, goes to expenses)', type: 'number', min: 0 },
            { key: 'vendor_id', label: 'External vendor', type: 'select', options: (vendors ?? []).map((x) => [x.id, `${x.name}${x.trade ? ` · ${x.trade}` : ''}`]) },
            { key: 'staff_member_id', label: 'Staff without app login', type: 'select', options: (staff ?? []).filter((s) => !s.user_id).map((s) => [s.id, s.full_name]) },
          ]} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <FileButton label="Add resolution images" accept="image/jpeg,image/png,image/webp" multiple busy={action.busy}
              onFile={(files) => action.run(async () => {
                const bad = cx.checkImages(files, after.length, 10)
                if (bad) throw new Error(bad)
                const paths = await cx.uploadImages(userId, files)
                setAfter((x) => [...x, ...paths])
              }, 'Images uploaded. Save to attach them.')} />
            {after.length > c.after_photos.length && <span className="text-sm">{after.length - c.after_photos.length} new image(s) not saved yet</span>}
            <Button variant="outline" disabled={action.busy} onClick={onSave}>Save work details</Button>
          </div>
        </section>
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
          defaults={{ property_id: property || properties[0]?.id, interval_days: 90, remind_days: 3, active: true, next_due: ymd() }}
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
