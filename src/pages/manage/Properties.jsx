import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import CrudPanel from '../../components/manage/CrudPanel'
import DataTable from '../../components/manage/DataTable'
import { ActionMsg, FormFields, H3, Load, Modal, Small, StatusBadge, Tabs, coerce, useAction, useScope } from '../../components/manage/kit'
import { Badge, Button, Card, Notice } from '../../components/ui'
import * as m from '../../services/manage'
import { BED_STATES, bedState, label } from '../../services/pg'
import { formatDate, rupees } from '../../services/format'

const ROOM_FIELDS = (properties, categories) => [
  { key: 'id', label: 'Room id (used for photo file names)', required: true, help: 'e.g. p1-204. Cannot be changed later.' },
  { key: 'property_id', label: 'Property', type: 'select', required: true, options: properties.map((p) => [p.id, `${p.id} · ${p.name}`]) },
  { key: 'room_no', label: 'Room number', required: true },
  { key: 'floor', label: 'Floor', type: 'number', required: true },
  { key: 'category_id', label: 'Category', type: 'select', required: true, options: categories.map((c) => [c.id, c.name]) },
  { key: 'room_type', label: 'Room type', type: 'select', required: true, options: ['single', 'double', 'triple', 'dormitory', 'flat', 'other'] },
  { key: 'ac_type', label: 'AC', type: 'select', required: true, options: ['AC', 'Non-AC'] },
  { key: 'attached_bathroom', label: 'Attached bathroom', type: 'checkbox' },
  { key: 'furnishing', label: 'Furnishing', type: 'select', required: true, options: ['furnished', 'semi-furnished', 'unfurnished'] },
  { key: 'rent_basis', label: 'Rent is per', type: 'select', required: true, options: [['bed', 'Bed'], ['room', 'Whole room']] },
  { key: 'billing_period', label: 'Billing', type: 'select', required: true, options: [['month', 'Monthly'], ['night', 'Nightly']] },
  { key: 'price', label: 'Rent (₹, room level)', type: 'number', required: true, min: 1, help: 'Beds can override this with their own rent.' },
  { key: 'deposit', label: 'Deposit (₹ per bed / room)', type: 'number', min: 0 },
  { key: 'features', label: 'Amenities (comma separated)', type: 'list', span: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'image_url', label: 'Main photo URL', span: true },
  { key: 'photos', label: 'More photo URLs (comma separated)', type: 'list', span: true },
  { key: 'is_active', label: 'Active (shown and bookable)', type: 'checkbox' },
]

function PropertiesTab() {
  const { role } = useAuth()
  return (
    <CrudPanel table="properties" title="Properties" query={(q) => q.order('id')} canDelete={false} canEdit
      defaults={{ is_active: true, geofence_m: 200 }}
      columns={[
        { key: 'id', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'city', label: 'City' }, { key: 'phone', label: 'Contact' },
        { key: 'gst_no', label: 'GST' }, { key: 'is_active', label: 'Status', render: (r) => <StatusBadge value={r.is_active ? 'active' : 'inactive'} />, value: (r) => (r.is_active ? 'active' : 'inactive') },
      ]}
      toForm={(r) => ({ ...r, photos: (r.photos || []).join(', ') })}
      fields={[
        { key: 'id', label: 'Code (P1, P2…)', required: true, disabled: role !== 'admin', help: 'Capital letters / digits; used in bed ids like P1-F2-R204-B1.' },
        { key: 'name', label: 'Name', required: true }, { key: 'city', label: 'City' },
        { key: 'address', label: 'Address', type: 'textarea' },
        { key: 'map_query', label: 'Google Maps location (search text or link)', span: true },
        { key: 'lat', label: 'Latitude (for staff GPS check-in)', type: 'number', step: 'any' },
        { key: 'lng', label: 'Longitude', type: 'number', step: 'any' },
        { key: 'geofence_m', label: 'Check-in radius (m)', type: 'number', min: 20 },
        { key: 'phone', label: 'Contact number', type: 'tel' }, { key: 'gst_no', label: 'GST number' }, { key: 'license_no', label: 'Licence number' },
        { key: 'photos', label: 'Photo URLs (comma separated)', type: 'list', span: true },
        { key: 'is_active', label: 'Active', type: 'checkbox' },
      ]} />
  )
}

function BedsEditor({ room, onChanged }) {
  const a = useAction()
  const [draft, setDraft] = useState({})
  const save = (b) => a.run(async () => {
    const d = draft[b.id] ?? {}
    await m.saveBed(b.id, { label: d.label ?? b.label, rent: d.rent === '' ? null : Number(d.rent ?? b.rent) || null, is_active: d.is_active ?? b.is_active })
    onChanged()
  }, 'Saved')
  const add = () => a.run(async () => {
    const used = new Set(room.beds.map((b) => b.label))
    const next = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).find((l) => !used.has(l))
    await m.saveBed(null, { room_id: room.id, label: next })
    onChanged()
  })
  const set = (id, k, v) => setDraft((d) => ({ ...d, [id]: { ...d[id], [k]: v } }))
  return (
    <div className="mt-3">
      <ul className="grid gap-2 sm:grid-cols-2">
        {room.beds.sort((x, y) => x.label.localeCompare(y.label)).map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-navy/10 p-2 text-sm">
            <span className={`rounded-lg border px-2 py-0.5 text-xs ${BED_STATES[bedState(b)].cls}`}>{b.code}</span>
            <label className="text-xs">Label <input className="w-12 rounded border border-navy/20 px-1" value={draft[b.id]?.label ?? b.label} onChange={(e) => set(b.id, 'label', e.target.value)} /></label>
            <label className="text-xs">Rent ₹ <input type="number" min="1" placeholder={String(room.price)} className="w-20 rounded border border-navy/20 px-1"
              value={draft[b.id]?.rent ?? b.rent ?? ''} onChange={(e) => set(b.id, 'rent', e.target.value)} /></label>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={draft[b.id]?.is_active ?? b.is_active} onChange={(e) => set(b.id, 'is_active', e.target.checked)} />Active</label>
            <Small onClick={() => save(b)} disabled={a.busy}>Save</Small>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-3"><Small onClick={add} disabled={a.busy}>+ Add bed</Small><ActionMsg action={a} /></div>
    </div>
  )
}

function RentHistory({ room }) {
  return (
    <Load loader={() => m.loadRentHistory(room.id)} deps={[room.id]}>
      {(list) => (list.length === 0 ? <p className="text-sm text-slate-500">No rent changes recorded yet.</p> : (
        <ul className="text-sm">
          {list.map((r) => (
            <li key={r.id} className="border-b border-navy/5 py-1">
              {formatDate(r.effective_from)} · {r.reason}: {r.old_rent == null ? 'room rate' : rupees(r.old_rent)} → {r.new_rent == null ? 'room rate' : rupees(r.new_rent)}
            </li>
          ))}
        </ul>
      ))}
    </Load>
  )
}

function RoomsTab() {
  const { property, properties } = useScope()
  const [editing, setEditing] = useState(null)
  const [bulk, setBulk] = useState(false)
  const [open, setOpen] = useState(null)
  return (
    <Load loader={() => Promise.all([m.loadRoomsWithBeds(property), m.rows('categories', '*', (q) => q.order('sort_order')),
      property ? m.loadFloors(property) : m.rows('floors', '*', (q) => q.order('property_id').order('number'))])} deps={[property]}>
      {([rooms, categories, floors], reload) => (
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button onClick={() => setEditing({ property_id: property || properties[0]?.id, floor: 1, room_type: 'double', ac_type: 'AC', furnishing: 'furnished',
              rent_basis: 'bed', billing_period: 'month', attached_bathroom: true, is_active: true, category_id: categories[0]?.id })}>Add room</Button>
            <Button variant="outline" onClick={() => setBulk(true)}>Bulk create rooms</Button>
          </div>
          <H3>Floors</H3>
          <div className="flex flex-wrap gap-2">
            {floors.map((f) => (
              <span key={`${f.property_id}-${f.number}`} className="flex items-center gap-2 rounded-full border border-navy/10 bg-white px-3 py-1 text-sm">
                {f.property_id} · Floor {f.number}{f.name ? ` (${f.name})` : ''} <StatusBadge value={f.is_active ? 'active' : 'inactive'} />
                <FloorToggle floor={f} onDone={reload} />
              </span>
            ))}
          </div>
          <H3>Rooms ({rooms.length})</H3>
          <div className="space-y-2">
            {rooms.map((r) => (
              <Card key={r.id} className="!p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{r.property_id} · Room {r.room_no} <span className="font-normal text-slate-500">floor {r.floor}</span></p>
                    <p className="text-xs text-slate-600">{label(r.room_type)} · {r.ac_type} · {r.attached_bathroom ? 'attached bath' : 'common bath'} · {label(r.furnishing)} · {rupees(r.price)}/{r.billing_period} per {r.rent_basis} · deposit {rupees(r.deposit)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!r.is_active && <Badge>Inactive</Badge>}
                    <Badge tone="navy">{r.beds.filter((b) => bedState(b) === 'occupied').length}/{r.beds.length} occupied</Badge>
                    <Small onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>Beds & history</Small>
                    <Small onClick={() => setEditing({ ...r, features: r.features.join(', '), photos: (r.photos || []).join(', ') })}>Edit</Small>
                  </div>
                </div>
                {open === r.id && (
                  <>
                    <BedsEditor room={r} onChanged={reload} />
                    <p className="mb-1 mt-4 text-sm font-semibold">Rent history</p>
                    <RentHistory room={r} />
                  </>
                )}
              </Card>
            ))}
          </div>
          {editing && <RoomModal room={editing} fields={ROOM_FIELDS(properties, categories)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
          {bulk && <BulkModal categories={categories} onClose={() => setBulk(false)} onSaved={() => { setBulk(false); reload() }} />}
        </div>
      )}
    </Load>
  )
}

function FloorToggle({ floor, onDone }) {
  const a = useAction()
  return (
    <>
      <button className="text-xs underline" disabled={a.busy}
        onClick={() => a.run(async () => { await m.setFloorActive(floor.property_id, floor.number, !floor.is_active); onDone() })}>
        {floor.is_active ? 'Deactivate' : 'Activate'}
      </button>
      {a.error && <span role="alert" className="text-xs text-red-700">{a.error}</span>}
    </>
  )
}

function RoomModal({ room, fields, onClose, onSaved }) {
  const [v, setV] = useState(room)
  const a = useAction()
  const isNew = !room.room_no
  const save = async (e) => {
    e.preventDefault()
    const data = coerce(fields, v)
    if (!isNew) delete data.id
    if (await a.run(() => m.saveRoom(isNew ? null : room.id, data))) onSaved()
  }
  return (
    <Modal title={isNew ? 'Add room' : `Edit room ${room.room_no}`} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <FormFields fields={fields.map((f) => (f.key === 'id' && !isNew ? { ...f, disabled: true } : f))} value={v} onChange={setV} />
        {isNew && <Notice>After saving, open “Beds & history” to add beds.</Notice>}
        <ActionMsg action={a} />
        <div className="flex gap-2"><Button type="submit" disabled={a.busy}>Save</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  )
}

function BulkModal({ categories, onClose, onSaved }) {
  const { property, properties } = useScope()
  const [v, setV] = useState({ property: property || properties[0]?.id, floor: 1, first: 101, count: 10, beds: 3, category: categories[0]?.id,
    roomType: 'triple', ac: 'AC', price: '', deposit: '', billing: 'month' })
  const a = useAction()
  const submit = async (e) => {
    e.preventDefault()
    const n = await a.run(() => m.bulkCreateRooms({ ...v, floor: Number(v.floor), first: Number(v.first), count: Number(v.count), beds: Number(v.beds),
      price: Number(v.price), deposit: Number(v.deposit || 0) }))
    if (n) onSaved()
  }
  return (
    <Modal title="Bulk create rooms" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormFields value={v} onChange={setV} fields={[
          { key: 'property', label: 'Property', type: 'select', required: true, options: properties.map((p) => [p.id, p.name]) },
          { key: 'floor', label: 'Floor', type: 'number', required: true },
          { key: 'first', label: 'First room number', type: 'number', required: true },
          { key: 'count', label: 'How many rooms', type: 'number', required: true, min: 1, max: 100 },
          { key: 'beds', label: 'Beds per room', type: 'number', required: true, min: 1, max: 20 },
          { key: 'category', label: 'Category', type: 'select', required: true, options: categories.map((c) => [c.id, c.name]) },
          { key: 'roomType', label: 'Room type', type: 'select', required: true, options: ['single', 'double', 'triple', 'dormitory'] },
          { key: 'ac', label: 'AC', type: 'select', required: true, options: ['AC', 'Non-AC'] },
          { key: 'price', label: 'Rent per bed (₹)', type: 'number', required: true, min: 1 },
          { key: 'deposit', label: 'Deposit per bed (₹)', type: 'number', min: 0 },
          { key: 'billing', label: 'Billing', type: 'select', required: true, options: [['month', 'Monthly'], ['night', 'Nightly']] },
        ]} />
        <p className="text-sm text-slate-600">Creates rooms {v.first} to {Number(v.first) + Number(v.count) - 1}, each with {v.beds} bed(s).</p>
        <ActionMsg action={a} />
        <div className="flex gap-2"><Button type="submit" disabled={a.busy}>{a.busy ? 'Creating…' : 'Create'}</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  )
}

function RevenueTab() {
  const { property } = useScope()
  const today = new Date()
  const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)
  // PRD 2.4: per room, expected vs collected this month, current tenants, paid / due
  return (
    <Load loader={() => Promise.all([m.rpc('report_rent_collection', { p_from: from, p_to: to, p_property: property || null }), m.loadRoomsWithBeds(property)])} deps={[property]}>
      {([bills, rooms]) => {
        const byRoom = rooms.map((r) => {
          const mine = bills.filter((b) => b.room_no === r.room_no && b.property_id === r.property_id && b.kind !== 'deposit')
          const beds = r.beds.filter((b) => b.is_active)
          return {
            id: r.id, room: `${r.property_id} · ${r.room_no}`, beds: beds.length,
            rent_per_bed: beds.map((b) => b.rent ?? r.price).join(' / '),
            tenants: [...new Set(mine.map((b) => b.tenant))].join(', '),
            expected: mine.reduce((s, b) => s + b.billed, 0), collected: mine.reduce((s, b) => s + b.collected, 0),
            due: mine.reduce((s, b) => s + b.outstanding, 0),
          }
        })
        return (
          <DataTable title="Room-wise rent" rows={byRoom} columns={[
            { key: 'room', label: 'Room' }, { key: 'beds', label: 'Beds' }, { key: 'rent_per_bed', label: 'Rent per bed (₹)' },
            { key: 'tenants', label: 'Current tenants' },
            { key: 'expected', label: 'Expected this month', render: (r) => rupees(r.expected) },
            { key: 'collected', label: 'Collected', render: (r) => rupees(r.collected) },
            { key: 'due', label: 'Due', render: (r) => (r.due ? <span className="font-semibold text-red-700">{rupees(r.due)}</span> : 'Paid') },
          ]} />
        )
      }}
    </Load>
  )
}

export default function Properties() {
  const [tab, setTab] = useState('rooms')
  return (
    <div>
      <Tabs tab={tab} onTab={setTab} tabs={[['rooms', 'Floors, rooms & beds'], ['revenue', 'Room-wise rent'], ['properties', 'Properties']]} />
      {tab === 'rooms' && <RoomsTab />}
      {tab === 'revenue' && <RevenueTab />}
      {tab === 'properties' && <PropertiesTab />}
    </div>
  )
}
