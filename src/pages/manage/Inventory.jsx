import { useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import useAsync from '../../hooks/useAsync'
import { ActionMsg, FormFields, H3, Modal, Small, useAction, useScope } from '../../components/manage/kit'
import { Button, ErrorBox, Notice, Stat, Table, TableSkeleton } from '../../components/ui'
import { loadInventory, saveRoomInventory, summarizeInventory } from '../../services/inventory'

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
      <H3 action={addRoom}>Total count</H3>
      {rooms.length === 0 ? (
        <Notice>No furniture recorded for this wing yet.{canEdit && !property ? ' Pick a wing to add rooms.' : ''}</Notice>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
