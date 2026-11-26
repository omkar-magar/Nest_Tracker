import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import useAsync from '../../hooks/useAsync'
import { ActionMsg, Fact, FormFields, H3, Modal, Small, useAction, useScope } from '../../components/manage/kit'
import DataTable from '../../components/manage/DataTable'
import { Button, ErrorBox, Notice, TableSkeleton } from '../../components/ui'
import * as m from '../../services/manage'
import { BED_STATES, addDays, boardState, label, placeGuests, vacancyMessage, ymd } from '../../services/pg'
import { guestKey, guestsByRoom, loadStayingGuests } from '../../services/register'
import { inventoryLine, loadInventory } from '../../services/inventory'
import { brand } from '../../data/site'
import { formatDate, rupees, whatsappLink } from '../../services/format'

// PRD 2.3: colour-coded bed map by floor and room, live; tap a bed to see the tenant, allocate, reserve or block it.
export default function Beds() {
  const { property, properties } = useScope()
  const { role } = useAuth()
  const manage = role === 'admin' || role === 'manager'
  const data = useAsync(() => Promise.all([
    m.loadRoomsWithBeds(property),
    m.loadReservations(),
    manage ? m.loadOccupants() : Promise.resolve([]),
    // most current guests are kept in the guest register, not checked in through the app
    manage ? loadStayingGuests(property) : Promise.resolve([]),
    // furniture per room (Inventory tab); the bed map still works without it
    manage ? loadInventory(property).catch(() => []) : Promise.resolve([]),
  ]), [property, manage])
  const [bed, setBed] = useState(null)
  const [filter, setFilter] = useState('')
  const [shared, setShared] = useState('')

  // Live: Supabase Realtime on beds; a 60 s refresh covers servers without it.
  useEffect(() => {
    const ch = supabase.channel?.(`bed-map-${Math.random()}`)
    ch?.on?.('postgres_changes', { event: '*', schema: 'public', table: 'beds' }, () => data.reload())?.subscribe?.()
    const t = setInterval(() => data.reload(), 60000)
    return () => { clearInterval(t); if (ch) supabase.removeChannel?.(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property])

  const view = useMemo(() => {
    if (!data.data) return null
    const [rooms, resv, occ, staying, stock] = data.data
    const furniture = {}
    for (const s of stock) (furniture[`${s.property_id}|${s.room_no}`] ??= {})[s.item] = s.qty
    const register = guestsByRoom(staying)
    const inRegister = (r) => register[guestKey(r)] ?? []
    const occupant = Object.fromEntries(occ.map((o) => [o.bed_id, o.bookings]))
    const reservation = Object.fromEntries(resv.map((r) => [r.bed_id, r]))
    const board = rooms.filter((x) => x.is_active || manage)
    // register guests take their room's free beds, so the colours and counts show real occupancy
    const { onBed, extra } = placeGuests(board, inRegister)
    const stateOf = (b, r) => boardState(b, r, onBed[b.id])
    const floors = {}
    for (const r of board) {
      const key = `${r.property_id} · ${r.wing} wing · Floor ${r.floor}`
      ;(floors[key] ??= []).push(r)
    }
    const all = board.flatMap((r) => r.beds.map((b) => ({ ...b, room: r })))
    const counts = Object.fromEntries(Object.keys(BED_STATES).map((k) => [k, all.filter((b) => stateOf(b, b.room) === k).length]))
    const upcoming = occ.filter((o) => o.bookings.expected_checkout)
      .map((o) => ({ id: o.bed_id, bed: all.find((b) => b.id === o.bed_id)?.code, name: o.bookings.profiles?.full_name, date: o.bookings.expected_checkout,
        notice: o.bookings.notice_date, customer: o.bookings.customer_id }))
      .concat(all.filter((b) => onBed[b.id]?.expected_checkout).map((b) => ({ id: b.id, bed: b.code, name: onBed[b.id].name,
        date: onBed[b.id].expected_checkout, notice: null, customer: null })))
      .sort((a, b) => a.date.localeCompare(b.date))
    const regRooms = rooms.filter((r) => inRegister(r).length)
    const reg = {
      total: Object.values(register).reduce((s, list) => s + list.length, 0),
      shown: regRooms.reduce((s, r) => s + inRegister(r).length, 0),
      rooms: regRooms.length,
    }
    const stockOf = (r) => inventoryLine(furniture[`${r.property_id}|${r.room_no}`])
    return { rooms, floors, occupant, reservation, counts, upcoming, inRegister, reg, stockOf, onBed, extra, stateOf }
  }, [data.data, manage])

  if (data.loading) return <TableSkeleton />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { floors, occupant, reservation, counts, upcoming, rooms, inRegister, reg, stockOf, onBed, extra, stateOf } = view

  const share = () => {
    const msg = vacancyMessage(rooms, { brandName: brand.name, phone: brand.phone, url: `${window.location.origin}/vacancies`, taken: (r) => inRegister(r).length })
    setShared(msg)
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        <button onClick={() => setFilter('')} className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === '' ? 'border-navy bg-navy text-white' : 'border-navy/20'}`}>All</button>
        {Object.entries(BED_STATES).map(([k, s]) => (
          <button key={k} onClick={() => setFilter(filter === k ? '' : k)} aria-pressed={filter === k}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${s.cls} ${filter === k ? 'ring-2 ring-navy ring-offset-1' : ''}`}>
            {s.label}: {counts[k]}
          </button>
        ))}
        <Button variant="outline" className="ml-auto !py-1.5" onClick={share}>Share vacancies</Button>
      </div>

      {reg.total > 0 && (
        <p className="mb-4 rounded-2xl border border-navy/10 bg-cream px-4 py-3 text-sm">
          <Link to="/admin/register" className="font-semibold underline focus-visible:outline-2 focus-visible:outline-navy">Guest register</Link>:{' '}
          {reg.total} guest{reg.total === 1 ? '' : 's'} staying in {reg.rooms} room{reg.rooms === 1 ? '' : 's'}
          {reg.shown < reg.total && ` (${reg.total - reg.shown} in rooms not on this board)`}.
          {' '}Register guests fill their room's free beds in order (A, B, ...), so they count as occupied here and are left out of Share vacancies.
        </p>
      )}
      {Object.keys(floors).length === 0 && <Notice>No rooms yet. Add them under Properties & rooms.</Notice>}
      <div className="space-y-6">
        {Object.entries(floors).map(([floor, list]) => (
          <section key={floor} aria-label={floor}>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{floor}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((r) => (
                <div key={r.id} className="rounded-2xl border border-navy/10 bg-white p-3">
                  <p className="text-sm font-semibold">Room {r.room_no} <span className="font-normal text-slate-500">· {label(r.room_type)} · {r.ac_type}</span></p>
                  {inRegister(r).length > 0 && (
                    <p className="mt-1 text-xs text-slate-700">
                      <span className="rounded-full bg-navy/10 px-2 py-0.5 font-semibold text-navy">In register: {inRegister(r).length} of {r.beds.length} bed{r.beds.length === 1 ? '' : 's'}</span>{' '}
                      {inRegister(r).map((g) => g.name).join(', ')}
                    </p>
                  )}
                  {extra[r.id] && (
                    <p className="mt-1 text-xs font-semibold text-red-700">
                      {extra[r.id].length} register guest{extra[r.id].length === 1 ? '' : 's'} without a free bed: {extra[r.id].map((g) => g.name).join(', ')}
                    </p>
                  )}
                  {stockOf(r) && <p className="mt-1 text-xs text-slate-600">Furniture: {stockOf(r)}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.beds.sort((a, b) => a.label.localeCompare(b.label)).filter((b) => !filter || stateOf(b, r) === filter).map((b) => {
                      const st = stateOf(b, r)
                      const who = occupant[b.id]?.profiles?.full_name ?? onBed[b.id]?.name
                      return (
                        <button key={b.id} onClick={() => setBed({ ...b, room: r, state: st, guest: onBed[b.id] })}
                          aria-label={`Bed ${b.code}: ${BED_STATES[st].label}${who ? `, ${who}` : ''}`}
                          className={`min-w-[4.5rem] rounded-xl border px-2 py-1.5 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${BED_STATES[st].cls}`}>
                          <span className="block font-bold">Bed {b.label}</span>
                          <span className="block truncate">{who ?? (reservation[b.id] ? reservation[b.id].tenant_name : BED_STATES[st].label)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {manage && (
        <>
          <H3>Upcoming vacancies</H3>
          <DataTable title="Upcoming vacancies" rows={upcoming} search={false} empty="No planned check-outs" columns={[
            { key: 'date', label: 'Free from', render: (r) => formatDate(r.date) }, { key: 'bed', label: 'Bed' },
            { key: 'name', label: 'Current tenant', render: (r) => <Link className="underline" to={r.customer ? `/admin/tenants/${r.customer}` : '/admin/register'}>{r.name}</Link>, value: (r) => r.name },
            { key: 'notice', label: 'Notice given', render: (r) => formatDate(r.notice) },
          ]} />
        </>
      )}

      {bed && <BedPanel bed={bed} occupant={occupant[bed.id]} reservation={reservation[bed.id]} manage={manage} properties={properties}
        onClose={() => setBed(null)} onChanged={() => { setBed(null); data.reload() }} />}
      {shared && (
        <Modal title="Vacancy message" onClose={() => setShared('')}>
          <pre className="whitespace-pre-wrap rounded-xl bg-cream p-3 text-sm">{shared}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button href={`https://wa.me/?text=${encodeURIComponent(shared)}`} target="_blank" rel="noopener">Share on WhatsApp</Button>
            <Button variant="outline" onClick={() => navigator.clipboard?.writeText(shared)}>Copy</Button>
            <Button variant="outline" to="/brochure">Printable brochure</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function BedPanel({ bed, occupant, reservation, manage, onClose, onChanged }) {
  const st = bed.state
  const navigate = useNavigate()
  const a = useAction()
  const [mode, setMode] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', advance: '', mode: 'upi', expires: addDays(ymd(), 3), notes: '', reason: '' })
  const rent = bed.rent ?? bed.room.price

  const reserve = async (e) => {
    e.preventDefault()
    if (await a.run(() => m.reserveBed({ bed: bed.id, ...form }))) onChanged()
  }
  const block = async (status) => { if (await a.run(() => m.setBedBlock(bed.id, status, form.reason))) onChanged() }

  return (
    <Modal title={`Bed ${bed.code}`} onClose={onClose}>
      <dl className="grid grid-cols-2 gap-3">
        <Fact k="Status">{BED_STATES[st].label}{bed.block_reason ? ` (${bed.block_reason})` : ''}</Fact>
        <Fact k="Rent">{rupees(rent)} / {bed.room.billing_period}</Fact>
        <Fact k="Room">{bed.room.room_no} · {label(bed.room.room_type)} · {bed.room.ac_type}</Fact>
        <Fact k="Deposit">{rupees(bed.room.deposit)}</Fact>
      </dl>
      {occupant && (
        <div className="mt-4 rounded-xl bg-cream p-3 text-sm">
          <p className="font-semibold">{occupant.profiles?.full_name}</p>
          <p>Since {formatDate(occupant.check_in)} · {rupees(occupant.rate)}{occupant.expected_checkout ? ` · leaving ${formatDate(occupant.expected_checkout)}` : ''}</p>
          <div className="mt-2 flex gap-2">
            <Small to={`/admin/tenants/${occupant.customer_id}`}>Open tenant</Small>
            {occupant.profiles?.phone && <Small href={whatsappLink(occupant.profiles.phone)} target="_blank" rel="noopener">WhatsApp</Small>}
          </div>
        </div>
      )}
      {!occupant && bed.guest && (
        <div className="mt-4 rounded-xl bg-cream p-3 text-sm">
          <p className="font-semibold">{bed.guest.name}</p>
          <p>From the guest register{bed.guest.rent ? ` · ${rupees(bed.guest.rent)}` : ''}{bed.guest.rent_status ? ` · rent ${label(bed.guest.rent_status)}` : ''}
            {bed.guest.expected_checkout ? ` · leaving ${formatDate(bed.guest.expected_checkout)}` : ''}</p>
          <div className="mt-2"><Small to="/admin/register">Open guest register</Small></div>
        </div>
      )}
      {reservation && (
        <div className="mt-4 rounded-xl bg-sun/20 p-3 text-sm">
          <p className="font-semibold">Reserved for {reservation.tenant_name}</p>
          <p>Advance {rupees(reservation.advance_amount)} · holds until {formatDate(reservation.expires_on)}{reservation.phone ? ` · ${reservation.phone}` : ''}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {manage && <Small onClick={() => navigate(`/admin/checkin?bed=${bed.id}&reservation=${reservation.id}${reservation.customer_id ? `&tenant=${reservation.customer_id}` : ''}`)}>Check in</Small>}
            <Small onClick={async () => { if (window.confirm('Cancel this reservation?') && await a.run(() => m.cancelReservation(reservation.id))) onChanged() }}>Cancel reservation</Small>
          </div>
        </div>
      )}

      {st === 'vacant' && (
        <div className="mt-4 flex flex-wrap gap-2">
          {manage && <Button onClick={() => navigate(`/admin/checkin?bed=${bed.id}`)}>Allocate / check in</Button>}
          <Button variant="outline" onClick={() => setMode('reserve')}>Reserve</Button>
          {manage && <Button variant="outline" onClick={() => setMode('block')}>Block / maintenance</Button>}
        </div>
      )}
      {st === 'maintenance' && manage && <Button className="mt-4" onClick={() => block('available')} disabled={a.busy}>Mark available</Button>}

      {mode === 'reserve' && (
        <form onSubmit={reserve} className="mt-4 space-y-3 border-t border-navy/10 pt-4">
          <FormFields value={form} onChange={setForm} fields={[
            { key: 'name', label: 'Tenant name', required: true }, { key: 'phone', label: 'Mobile', type: 'tel' },
            { key: 'advance', label: 'Advance received (₹)', type: 'number', min: 0 },
            { key: 'mode', label: 'Advance paid by', type: 'select', options: ['cash', 'upi', 'bank_transfer', 'cheque'] },
            { key: 'expires', label: 'Hold until (auto-release after)', type: 'date', required: true, min: ymd() },
            { key: 'notes', label: 'Notes', type: 'textarea' },
          ]} />
          <Button type="submit" disabled={a.busy}>Reserve bed</Button>
        </form>
      )}
      {mode === 'block' && (
        <div className="mt-4 space-y-3 border-t border-navy/10 pt-4">
          <FormFields value={form} onChange={setForm} fields={[{ key: 'reason', label: 'Reason', span: true }]} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => block('maintenance')} disabled={a.busy}>Under maintenance</Button>
            <Button variant="outline" onClick={() => block('blocked')} disabled={a.busy}>Blocked</Button>
          </div>
        </div>
      )}
      <div className="mt-3"><ActionMsg action={a} /></div>
    </Modal>
  )
}
