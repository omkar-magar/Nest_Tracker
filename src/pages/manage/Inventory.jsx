import { useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import useAsync from '../../hooks/useAsync'
import { ActionMsg, FormFields, H3, Modal, Small, useAction, useScope } from '../../components/manage/kit'
import { Badge, Button, ErrorBox, Notice, Stat, Table, TableSkeleton } from '../../components/ui'
import { loadInventory, saveRoomInventory, summarizeInventory } from '../../services/inventory'
import { ADDON_STATUS, addonLabel, addonRequests, decideAddon, monthName } from '../../services/stay'
import { rupees } from '../../services/format'

const cell = (n) => (n ? n : <span className="text-slate-500" aria-label="none">—</span>)

// Furniture and mattress stock: totals first, then where each thing is, room by room.
export default function Inventory() {
  const { property, properties } = useScope()
  const { role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager'
  const data = useAsync(() => loadInventory(property), [property])
  const view = useMemo(() => (data.data ? summarizeInventory(data.data, properties) : null), [data.data, properties])
  const [editing, setEditing] = useState(null)

  if (data.loading) return <TableSkeleton />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { items, rooms, groups, totals } = view
  const addRoom = canEdit && property ? <Button variant="outline" className="!py-1.5" onClick={() => setEditing({ property_id: property, room_no: '', counts: {}, isNew: true })}>Add a room</Button> : null

  return (
    <div>
      {canEdit && <AddonRequests property={property} onDecided={data.reload} />}
      <H3 action={addRoom}>Total count</H3>
      {rooms.length === 0 ? (
        <Notice>No furniture recorded for this wing yet.{canEdit && !property ? ' Pick a wing to add rooms.' : ''}</Notice>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {items.map(([k, text]) => <Stat key={k} label={text} value={totals[k] ?? 0} />)}
          </div>
          <p className="mt-2 text-xs text-slate-500">Across {rooms.length} room{rooms.length === 1 ? '' : 's'}.</p>

          <H3>Where things are</H3>
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.label} aria-label={g.label}>
                <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{g.label}</h4>
                <Table head={['Room', ...items.map(([, text]) => text), ...(canEdit ? [''] : [])]}>
                  {g.rooms.map((r) => (
                    <tr key={r.key}>
                      <th scope="row" className="px-4 py-2.5 font-semibold">{r.room_no}</th>
                      {items.map(([k]) => <td key={k} className="px-4 py-2.5">{cell(r.counts[k])}</td>)}
                      {canEdit && (
                        <td className="px-4 py-2.5 text-right">
                          <Small onClick={() => setEditing(r)} aria-label={`Edit room ${r.room_no}`}>Edit</Small>
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="bg-cream font-bold">
                    <th scope="row" className="px-4 py-2.5">Total</th>
                    {items.map(([k]) => <td key={k} className="px-4 py-2.5">{g.totals[k] ?? 0}</td>)}
                    {canEdit && <td />}
                  </tr>
                </Table>
              </section>
            ))}
          </div>
        </>
      )}

      {editing && <EditRoom room={editing} items={items} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); data.reload() }} />}
    </div>
  )
}

const addonTone = { requested: 'amber', approved: 'green', rejected: 'red', cancelled: 'gray' }

// Residents' extra-furniture requests. Approving adds the item to the room count and the price to their next rent.
function AddonRequests({ property, onDecided }) {
  const q = useAsync(() => addonRequests(property), [property])
  const a = useAction()
  const [showAll, setShowAll] = useState(false)
  if (q.loading || q.error || !q.data?.length) return null
  const waiting = q.data.filter((x) => x.status === 'requested')
  const list = showAll ? q.data : waiting
  const decide = async (x, approve) => {
    const note = approve ? '' : window.prompt('Reason for declining (optional)') ?? null
    if (note === null) return
    if (await a.run(() => decideAddon(x.id, approve, note), approve ? 'Approved. Added to the room and the next rent.' : 'Declined')) { q.reload(); if (approve) onDecided() }
  }
  return (
    <section aria-label="Extra furniture requests" className="mb-8">
      <H3 action={<Small onClick={() => setShowAll((s) => !s)}>{showAll ? 'Only waiting' : 'Show answered too'}</Small>}>
        Extra furniture requests {waiting.length > 0 && <Badge tone="amber">{waiting.length} waiting</Badge>}
      </H3>
      {list.length === 0 ? <p className="text-sm text-slate-600">No requests waiting.</p> : (
        <Table head={['Resident', 'Room', 'Item', 'Charge', 'Status', '']}>
          {list.map((x) => (
            <tr key={x.id}>
              <td className="px-4 py-2.5">{x.resident || '—'}</td>
              <td className="px-4 py-2.5">{x.room_no}</td>
              <td className="px-4 py-2.5">{x.qty} × {addonLabel(x.item)}</td>
              <td className="px-4 py-2.5">{rupees(x.amount)}{x.charge_month && <span className="block text-xs text-slate-600">on {monthName(x.charge_month)} rent</span>}</td>
              <td className="px-4 py-2.5"><Badge tone={addonTone[x.status]}>{ADDON_STATUS[x.status]}</Badge></td>
              <td className="px-4 py-2.5 text-right">
                {x.status === 'requested' && <span className="inline-flex gap-1">
                  <Button className="!py-1" disabled={a.busy} onClick={() => decide(x, true)}>Approve</Button>
                  <Button variant="outline" className="!py-1" disabled={a.busy} onClick={() => decide(x, false)}>Decline</Button>
                </span>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className="mt-2"><ActionMsg action={a} /></div>
    </section>
  )
}

function EditRoom({ room, items, onClose, onSaved }) {
  const a = useAction()
  const [form, setForm] = useState({ room_no: room.room_no, ...Object.fromEntries(items.map(([k]) => [k, String(room.counts[k] ?? 0)])) })
  const save = async (e) => {
    e.preventDefault()
    const roomNo = form.room_no.trim()
    const counts = Object.fromEntries(items.map(([k]) => [k, form[k]]))
    if (await a.run(() => saveRoomInventory(room.property_id, roomNo, counts))) onSaved()
  }
  return (
    <Modal title={room.isNew ? 'Add a room' : `Room ${room.room_no}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <FormFields value={form} onChange={setForm} fields={[
          ...(room.isNew ? [{ key: 'room_no', label: 'Room number', required: true, maxLength: 10, span: true }] : []),
          ...items.map(([k, text]) => ({ key: k, label: text, type: 'number', min: 0, max: 999 })),
        ]} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={a.busy}>Save</Button>
          <ActionMsg action={a} />
        </div>
      </form>
    </Modal>
  )
}
