import { useEffect, useRef, useState } from 'react'
import useAsync from '../../hooks/useAsync'
import { loadBeds, setBedStatus } from '../../services/api'
import { subscribeAvailability } from '../../services/catalog'
import { Badge, Card, ErrorBox, Spinner } from '../ui'

const roomState = (beds) => {
  const taken = beds.filter((b) => b.is_occupied).length
  if (taken === 0) return { text: 'Available', tone: 'green' }
  return taken === beds.length ? { text: 'Fully occupied', tone: 'red' } : { text: 'Partially occupied', tone: 'amber' }
}

export function bedCounts(rooms) {
  const beds = rooms.flatMap((r) => r.beds)
  return {
    rooms: rooms.length,
    beds: beds.length,
    occupied: beds.filter((b) => b.is_occupied).length,
    maintenance: beds.filter((b) => !b.is_occupied && b.status === 'maintenance').length,
    available: beds.filter((b) => !b.is_occupied && b.status === 'available').length,
  }
}

// Live room and bed grid. canManage shows the maintenance toggle (the database re-checks the permission).
export default function RoomsBoard({ canManage = false }) {
  const { data, error, loading, reload } = useAsync(loadBeds, [])
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('all')
  const again = useRef(reload)
  again.current = reload

  useEffect(() => {
    let t
    const off = subscribeAvailability(() => { clearTimeout(t); t = setTimeout(() => again.current(), 250) })
    return () => { clearTimeout(t); off() }
  }, [])

  if (loading) return <Spinner label="Loading rooms" />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  const toggle = async (bed) => {
    setErr('')
    try { await setBedStatus(bed.id, bed.status === 'maintenance' ? 'available' : 'maintenance'); reload() } catch (e) { setErr(e.message) }
  }
  const rooms = data.map((r) => ({ ...r, beds: [...r.beds].sort((a, b) => a.label.localeCompare(b.label)) }))
  const shown = rooms.filter((r) => filter === 'all' || roomState(r.beds).tone === filter)
  const c = bedCounts(rooms)

  return (
    <div>
      <p className="text-sm text-slate-600" aria-live="polite">
        {c.rooms} rooms · {c.beds} beds · {c.available} free · {c.occupied} occupied · {c.maintenance} under maintenance. Updates live.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter rooms">
        {[['all', 'All'], ['green', 'Available'], ['amber', 'Partially occupied'], ['red', 'Fully occupied']].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
            className={`rounded-full border px-4 py-1 text-sm ${filter === k ? 'border-navy bg-navy text-white' : 'border-navy/20'}`}>{label}</button>
        ))}
      </div>
      {err && <p role="alert" className="mt-3 text-sm text-red-700">{err}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((r) => {
          const s = roomState(r.beds)
          return (
            <Card key={r.id}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Room {r.room_no} <span className="text-xs font-normal text-slate-500">F{r.floor} · {r.ac_type}</span></h3>
                <Badge tone={s.tone}>{s.text}</Badge>
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">
                {r.beds.map((b) => {
                  const state = b.is_occupied ? 'Occupied' : b.status === 'maintenance' ? 'Maintenance' : 'Free'
                  const cls = b.is_occupied ? 'bg-red-100 text-red-800' : b.status === 'maintenance' ? 'bg-slate-200 text-slate-700' : 'bg-green-100 text-green-900'
                  return (
                    <li key={b.id}>
                      {canManage && !b.is_occupied ? (
                        <button onClick={() => toggle(b)} title="Toggle maintenance" className={`rounded-lg px-3 py-1 text-sm ${cls} focus-visible:outline-2 focus-visible:outline-navy`}>
                          Bed {b.label}: {state}
                        </button>
                      ) : (
                        <span className={`inline-block rounded-lg px-3 py-1 text-sm ${cls}`}>Bed {b.label}: {state}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
