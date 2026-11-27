import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import useAsync from '../../hooks/useAsync'
import { ActionMsg, Modal, Tabs, useAction } from '../manage/kit'
import { Badge, Button, Card, Empty, ErrorBox, Notice, Stat, TableSkeleton, inputCls } from '../ui'
import * as r from '../../services/register'
import { download, exportExcel, exportPDF } from '../../services/exporters'
import { ymd } from '../../services/pg'
import { formatDate, rupees } from '../../services/format'
import ExtendStay from './ExtendStay'
import { AddGuestModal, ChangesModal, CheckoutModal, History, PastGuests, StatusPill, Tools } from './RegisterPanels'
import NewRegistrations from './NewRegistrations'

// The guest register for one property: who is in which room, rent and deposit, check-in / check-out dates.
// Owner and managers edit; a caretaker with "view customers" switched on only reads. Room type (PG or rented)
// and the room counts follow from the list: a second guest in a room turns it into a PG room at once, and a guest
// alone can be marked PG or rented (room_type) in the Details popup.
const KIND_TONE = { pg: 'navy', rented: 'green', empty: 'gray' }
const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`
const kindText = (room) => (room.kind === 'empty' ? 'Empty' : `${r.KIND_TEXT[room.kind]} · ${people(room.people)}`)
const floorName = (f) => (f ? `Floor ${f}` : 'Other rooms')

export default function GuestRegister({ property }) {
  const { role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager'
  const props = useAsync(r.loadRegisterProperties, [])
  const location = useLocation()
  // ?wing= (from a tenant search hit) opens that wing; otherwise the one picked last time
  const [chosen, setChosen] = useState(() => {
    const wing = new URLSearchParams(location.search).get('wing')
    if (wing) return wing
    try { return localStorage.getItem('yolo.register.property') ?? '' } catch { return '' }
  })

  if (property) return <Register key={property} pid={property} canEdit={canEdit} />
  if (props.loading) return <TableSkeleton />
  if (props.error) return <ErrorBox error={props.error} onRetry={props.reload} />
  const list = props.data ?? []
  if (!list.length) return <Notice>No property is linked to your login yet. Ask the owner to assign you to one.</Notice>
  const pid = list.some((p) => p.id === chosen) ? chosen : list[0].id
  const pick = (id) => { setChosen(id); try { localStorage.setItem('yolo.register.property', id) } catch { /* private mode */ } }
  return (
    <div>
      {list.length > 1 && (
        <label className="mb-4 block text-sm font-medium">Property{' '}
          <select className={`${inputCls} !w-auto`} value={pid} onChange={(e) => pick(e.target.value)}>
            {list.map((p) => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}
          </select>
        </label>
      )}
      <Register key={pid} pid={pid} canEdit={canEdit} />
    </div>
  )
}

function Register({ pid, canEdit }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [pending] = useState(() => r.readChangesParam(location.search))
  const guests = useAsync(() => r.loadRegister(pid), [pid])
  const rooms = useAsync(() => r.loadRegisterRooms(pid), [pid])
  const [list, setList] = useState(null)
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') === 'new' && canEdit ? 'new' : 'current')
  const [plan, setPlan] = useState(null)
  const [planned, setPlanned] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => { if (guests.data) setList(guests.data) }, [guests.data])
  // a ?changes= link: drop it from the address bar, then show the review once the list is loaded
  useEffect(() => {
    if (pending) navigate({ pathname: location.pathname, search: '' }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const roomNos = useMemo(() => (rooms.data ?? []).map((x) => x.room_no).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })), [rooms.data])
  useEffect(() => {
    if (pending && canEdit && list && rooms.data && !planned) { setPlanned(true); setPlan(r.buildPlan(pending, list, roomNos)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, rooms.data])

  if (guests.error || rooms.error) return <ErrorBox error={guests.error || rooms.error} onRetry={() => { guests.reload(); rooms.reload() }} />
  if (!list || rooms.loading) return <TableSkeleton />

  const reload = () => guests.reload()
  const tabs = [['current', 'Current guests'], ...(canEdit ? [['new', 'New registrations']] : []), ['past', 'Past guests'], ...(canEdit ? [['history', 'Change history'], ['tools', 'Import and AI link']] : [])]
  return (
    <div>
      {pending && !canEdit && <div className="mb-4"><Notice tone="warn">Only the owner or a manager can apply changes from a link.</Notice></div>}
      {notice && <p role="status" className="mb-3 text-sm text-green-800">{notice}</p>}
      <Tabs label="Guest register" tabs={tabs} tab={tab} onTab={setTab} />
      {tab === 'new' && canEdit && <NewRegistrations pid={pid} onApproved={() => { reload(); setTab('current') }} />}
      {tab === 'current' && <Current pid={pid} list={list} setList={setList} rooms={rooms.data} roomNos={roomNos} canEdit={canEdit} reload={reload} />}
      {tab === 'past' && <PastGuests pid={pid} canEdit={canEdit} onChanged={reload} />}
      {tab === 'history' && <History pid={pid} onChanged={reload} />}
      {tab === 'tools' && <Tools pid={pid} guests={list} roomNos={roomNos} wings={[...new Set((rooms.data ?? []).map((x) => x.wing).filter(Boolean))].sort()} onChanged={() => { reload(); setTab('current') }} />}
      {plan && <ChangesModal pid={pid} plan={plan} onClose={() => setPlan(null)}
        onDone={(n) => { setPlan(null); setNotice(`${n} change${n === 1 ? '' : 's'} applied from link.`); reload() }} />}
    </div>
  )
}

const EXPORT_COLS = (kindOf) => [
  { key: 'sr', label: 'Sr' }, { key: 'room_no', label: 'Room' },
  { key: 'kind', label: 'Type', value: (g) => r.KIND_TEXT[kindOf[g.room_no]] },
  { key: 'name', label: 'Guest' }, { key: 'contact', label: 'Contact' },
  { key: 'rent', label: 'Rent (₹)' }, { key: 'rent_status', label: 'Rent status', value: (g) => r.STATUS_TEXT[g.rent_status] },
  { key: 'deposit', label: 'Deposit (₹)' }, { key: 'deposit_status', label: 'Deposit status', value: (g) => r.STATUS_TEXT[g.deposit_status] },
  { key: 'check_in', label: 'Check-in', value: (g) => (g.check_in ? formatDate(g.check_in) : '') },
  { key: 'expected_checkout', label: 'Expected check-out', value: (g) => (g.expected_checkout ? formatDate(g.expected_checkout) : '') },
  { key: 'notes', label: 'Notes' },
]

function Current({ pid, list, setList, rooms, roomNos, canEdit, reload }) {
  const [edit, setEdit] = useState(false)
  const location = useLocation()
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') ?? '')
  const [rentF, setRentF] = useState('')
  const [depF, setDepF] = useState('')
  const [kindF, setKindF] = useState('')
  const [soon, setSoon] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [adding, setAdding] = useState(null)
  const [leaving, setLeaving] = useState(null)
  const [details, setDetails] = useState(null)
  // stable, so saving a field (which re-renders this list) doesn't pull focus back to the popup
  const closeDetails = useCallback(() => setDetails(null), [])
  const detailGuest = details !== null ? list.find((x) => x.id === details) : null
  const [view, setViewState] = useState(() => { try { return localStorage.getItem('yolo.register.view') || 'table' } catch { return 'table' } })
  const setView = (v) => { setViewState(v); try { localStorage.setItem('yolo.register.view', v) } catch { /* private mode */ } }
  const a = useAction()

  const sorted = r.sortGuests(list)
  const sum = r.roomSummary(sorted, rooms)
  const kindOf = Object.fromEntries(sum.rooms.map((x) => [x.room_no, x.kind]))
  const filtering = q.trim() || rentF || depF || soon
  const needle = q.trim().toLowerCase()
  const match = (g) => (!needle || [g.name, g.contact, g.room_no].join(' ').toLowerCase().includes(needle))
    && (!rentF || g.rent_status === rentF) && (!depF || g.deposit_status === depF) && (!soon || r.leavingSoon(g))
  const shownRooms = sum.rooms
    .filter((x) => !kindF || x.kind === kindF)
    .map((x) => ({ ...x, shown: x.guests.filter(match) }))
    .filter((x) => !filtering || x.shown.length)
  const floors = [...new Set(shownRooms.map((x) => x.floor))]
  const shownCount = shownRooms.reduce((s, x) => s + x.shown.length, 0)
  const saved = (g) => setList((l) => l.map((x) => (x.id === g.id ? { ...x, ...g } : x)))
  const exportRows = sorted.map((g, i) => ({ ...g, sr: i + 1 }))
  const backup = () => a.run(async () => {
    const [past, history] = await Promise.all([r.loadPastGuests(pid), r.loadRegisterHistory(pid)])
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), property_id: pid, guests: sorted, past_guests: past, history }, null, 1)], { type: 'application/json' })
    download(`guest-register-${pid}-${ymd()}.json`, blob)
  }, 'Backup downloaded')
  const reset = () => { setQ(''); setRentF(''); setDepF(''); setKindF(''); setSoon(false) }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-5" aria-live="polite">
        <Stat label="Guests staying" value={sum.people} hint={sum.rentPending ? `${sum.rentPending} with rent pending` : undefined} />
        <Stat label="Rooms occupied" value={`${sum.occupiedRooms}/${sum.totalRooms}`} />
        <Stat label="PG rooms" value={sum.pgRooms} hint={`${people(sum.pgPeople)} sharing`} />
        <Stat label="Rented rooms" value={sum.rentedRooms} hint="1 person each" />
        <Stat label="Empty rooms" value={sum.emptyRooms} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {canEdit && <Button variant="sun" onClick={() => setAdding({})}>+ Add guest</Button>}
        {canEdit && view === 'rooms' && <Button variant="outline" aria-pressed={edit} onClick={() => setEdit(!edit)}>{edit ? 'Edit mode: on (saves as you type)' : 'Edit mode: off'}</Button>}
        {/* the three downloads share one menu */}
        <details className="relative">
          <summary className="inline-flex cursor-pointer list-none items-center rounded-full border border-navy/30 px-5 py-2 text-sm font-semibold hover:bg-navy/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy [&::-webkit-details-marker]:hidden">Export ▾</summary>
          <div className="absolute left-0 z-20 mt-1 w-48 rounded-2xl border border-navy/10 bg-white p-1 shadow-lg">
            <button className={menuItem} onClick={() => exportExcel('Guest register', exportRows, EXPORT_COLS(kindOf))}>Export Excel</button>
            <button className={menuItem} onClick={() => a.run(() => exportPDF('Guest register', exportRows, EXPORT_COLS(kindOf),
              `${sum.people} guests · ${sum.occupiedRooms}/${sum.totalRooms} rooms occupied · PG ${sum.pgRooms} rooms (${sum.pgPeople} people) · rented ${sum.rentedRooms}`))}>Export PDF</button>
            {canEdit && <button className={menuItem} disabled={a.busy} onClick={backup}>Backup (JSON)</button>}
          </div>
        </details>
      </div>
      <div className="mt-2"><ActionMsg action={a} /></div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" role="search">
        <div className="flex gap-2 lg:col-span-2">
          <label className="flex-1"><span className="sr-only">Search</span>
            <input type="search" className={inputCls} placeholder="Search name, contact or room" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {/* phones: the three status filters fold away behind this button */}
          <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}
            className="shrink-0 rounded-xl border border-navy/20 bg-white px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-navy sm:hidden">
            Filters{rentF || depF || kindF ? ' •' : ''}
          </button>
        </div>
        <label className={showFilters ? '' : 'max-sm:hidden'}><span className="sr-only">Rent status</span>
          <select className={inputCls} value={rentF} onChange={(e) => setRentF(e.target.value)}>
            <option value="">All rent statuses</option>{r.STATUSES.map((s) => <option key={s} value={s}>Rent: {r.STATUS_TEXT[s]}</option>)}
          </select>
        </label>
        <label className={showFilters ? '' : 'max-sm:hidden'}><span className="sr-only">Deposit status</span>
          <select className={inputCls} value={depF} onChange={(e) => setDepF(e.target.value)}>
            <option value="">All deposit statuses</option>{r.STATUSES.map((s) => <option key={s} value={s}>Deposit: {r.STATUS_TEXT[s]}</option>)}
          </select>
        </label>
        <label className={showFilters ? '' : 'max-sm:hidden'}><span className="sr-only">Room type</span>
          <select className={inputCls} value={kindF} onChange={(e) => setKindF(e.target.value)}>
            <option value="">All rooms</option><option value="pg">PG rooms</option><option value="rented">Rented rooms</option><option value="empty">Empty rooms</option>
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-navy" checked={soon} onChange={(e) => setSoon(e.target.checked)} />Leaving in the next 7 days</label>
        <span className="text-slate-600">Showing {shownCount} of {sorted.length} entries</span>
        {(filtering || kindF) && <button className="underline focus-visible:outline-2 focus-visible:outline-navy" onClick={reset}>Reset filters</button>}
        <span className="ml-auto inline-flex rounded-full border border-navy/20 p-0.5" role="group" aria-label="View">
          {[['table', 'List'], ['rooms', 'By room']].map(([v, text]) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-navy ${view === v ? 'bg-navy text-white' : 'text-navy hover:bg-navy/5'}`}>{text}</button>
          ))}
        </span>
      </div>

      {sum.totalRooms === 0 ? (
        <div className="mt-6"><Empty title="No rooms or guests yet">{canEdit ? 'Add the rooms under Properties & rooms, or import the old register under Import and AI link.' : 'Nothing has been added yet.'}</Empty></div>
      ) : view === 'table' ? (
        <GuestTable rooms={shownRooms.filter((x) => x.shown.length || kindF === 'empty')} onDetails={setDetails} />
      ) : floors.map((f) => (
        <section key={f} className="mt-6">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">{floorName(f)}</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shownRooms.filter((x) => x.floor === f).map((room) => (
              <Card key={room.room_no} className="!p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">Room {room.room_no}</h4>
                  <span className="flex items-center gap-2">
                    <Badge tone={KIND_TONE[room.kind]}>{kindText(room)}</Badge>
                    {canEdit && <button aria-label={`Add guest to room ${room.room_no}`} onClick={() => setAdding({ room: room.room_no, after: room.guests.at(-1)?.id })}
                      className="rounded-full border border-navy/30 px-2.5 text-sm font-semibold hover:bg-navy/5 focus-visible:outline-2 focus-visible:outline-navy">+</button>}
                  </span>
                </div>
                {room.shown.length > 0 && (
                  <ul className="mt-3 space-y-3">
                    {room.shown.map((g) => (
                      <GuestItem key={g.id} g={g} edit={canEdit && edit} canEdit={canEdit} roomNos={roomNos} onSaved={saved} onCheckout={() => setLeaving(g)} />
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        </section>
      ))}

      {adding && <AddGuestModal pid={pid} roomNos={roomNos} room={adding.room} after={adding.after} onClose={() => setAdding(null)} onDone={() => { setAdding(null); reload() }} />}
      {detailGuest && !leaving && <GuestDetails g={detailGuest} room={sum.rooms.find((x) => x.room_no === detailGuest.room_no)} canEdit={canEdit} roomNos={roomNos} onSaved={saved} onClose={closeDetails}
        onCheckout={setLeaving} />}
      {leaving && <CheckoutModal guest={leaving} onClose={() => setLeaving(null)} onDone={() => { setList((l) => l.filter((x) => x.id !== leaving.id)); setLeaving(null) }} />}
    </div>
  )
}

function GuestItem({ g, edit, canEdit, roomNos, onSaved, onCheckout }) {
  const soon = r.leavingSoon(g)
  if (edit) {
    return (
      <li className="rounded-xl border border-navy/10 p-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <EditCell g={g} k="name" label="Guest name" span onSaved={onSaved} />
          <EditCell g={g} k="contact" label="Contact" type="tel" onSaved={onSaved} />
          <EditCell g={g} k="room_no" label="Room" options={roomNos.length ? roomNos.map((n) => [n, n]) : null} onSaved={onSaved} />
          <EditCell g={g} k="rent" label="Rent (₹)" type="number" onSaved={onSaved} />
          <EditCell g={g} k="rent_status" label="Rent status" options={r.STATUSES.map((s) => [s, r.STATUS_TEXT[s]])} onSaved={onSaved} />
          <EditCell g={g} k="deposit" label="Deposit (₹)" type="number" onSaved={onSaved} />
          <EditCell g={g} k="deposit_status" label="Deposit status" options={r.STATUSES.map((s) => [s, r.STATUS_TEXT[s]])} onSaved={onSaved} />
          <EditCell g={g} k="check_in" label="Check-in" type="date" onSaved={onSaved} />
          <EditCell g={g} k="expected_checkout" label="Expected check-out" type="date" onSaved={onSaved} />
          <EditCell g={g} k="notes" label="Notes" span onSaved={onSaved} />
        </div>
        <div className="mt-2 text-right"><Button variant="danger" className="!px-3 !py-1 text-xs" onClick={onCheckout}>{r.occupies(g) ? 'Check out' : 'Remove'}</Button></div>
      </li>
    )
  }
  return (
    <li className="rounded-xl border border-navy/10 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{g.name || <span className="italic text-slate-500">Unnamed entry</span>}</p>
          {g.contact ? <a href={`tel:${g.contact}`} className="text-slate-600 underline focus-visible:outline-2 focus-visible:outline-navy">{g.contact}</a> : <p className="text-slate-500">No contact number</p>}
        </div>
        {soon && <Badge tone="amber">Leaving soon</Badge>}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <div><dt className="text-xs text-slate-500">Rent</dt><dd>{g.rent === null ? '—' : rupees(g.rent)} <StatusPill value={g.rent_status} /></dd></div>
        <div><dt className="text-xs text-slate-500">Deposit</dt><dd>{g.deposit === null ? '—' : rupees(g.deposit)} <StatusPill value={g.deposit_status} /></dd></div>
        <div><dt className="text-xs text-slate-500">Check-in</dt><dd>{g.check_in ? formatDate(g.check_in) : '—'}</dd></div>
        <div><dt className="text-xs text-slate-500">Expected check-out</dt><dd>{g.expected_checkout ? formatDate(g.expected_checkout) : '—'}</dd></div>
      </dl>
      {g.notes && <p className="mt-2 break-words text-slate-600">{g.notes}</p>}
      {canEdit && <div className="mt-2 text-right"><Button variant="outline" className="!px-3 !py-1 text-xs" onClick={onCheckout}>{r.occupies(g) ? 'Check out' : 'Remove'}</Button></div>}
    </li>
  )
}

// Every guest as one compact row (room, type, name, contact, rent status, dates); a room's number and type span
// its guests' rows. "Details" opens a popup with every field (editable for owner / manager) and Check out.
// On phones only room, name and rent status show. Empty rooms only show when filtered for.
const COLS = [['Sr'], ['Room', true], ['Type'], ['Guest', true], ['Contact'], ['Rent status', true], ['Check-in'], ['Expected check-out']]
const td = 'px-3 py-2 align-top'
const menuItem = 'block w-full rounded-xl px-3 py-2 text-left text-sm font-medium hover:bg-navy/5 focus-visible:outline-2 focus-visible:outline-navy disabled:opacity-50'
const wide = 'hidden sm:table-cell' // columns left out on phones
const STICKY = 'sticky right-0 whitespace-nowrap shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)]'
const shortKind = (room) => (room.kind === 'pg' ? `PG · ${room.people}` : room.kind === 'rented' ? 'Rented' : 'Empty')
const money = (v) => (v === null || v === undefined ? '—' : rupees(v))
const STATUS_OPTS = r.STATUSES.map((s) => [s, r.STATUS_TEXT[s]])

function GuestTable({ rooms, onDetails }) {
  let sr = 0
  if (!rooms.length) return <div className="mt-6"><Empty title="No guests match" /></div>
  return (
    <div className="mt-6 overflow-x-auto rounded-2xl border border-navy/10 bg-white">
      <table className="w-full text-left text-sm sm:min-w-[50rem]">
        <caption className="sr-only">Guest register</caption>
        <thead className="border-b border-navy/10 bg-cream text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {COLS.map(([h, phone]) => <th key={h} scope="col" className={`whitespace-nowrap px-3 py-2.5 font-semibold ${phone ? '' : wide}`}>{h}</th>)}
            <th scope="col" className={`${STICKY} ${wide} bg-cream px-3 py-2.5`}><span className="sr-only">Details</span></th>
          </tr>
        </thead>
        {rooms.map((room) => {
          const rows = room.shown.length ? room.shown : [null]
          return (
            <tbody key={room.room_no} className="border-b border-navy/10 last:border-0">
              {rows.map((g, i) => (
                <tr key={g?.id ?? 'empty'} className="border-t border-navy/5 first:border-0">
                  <td className={`${td} ${wide} text-slate-500`}>{g ? ++sr : ''}</td>
                  {i === 0 && (
                    <>
                      <th scope="rowgroup" rowSpan={rows.length} className={`${td} whitespace-nowrap font-semibold`}>{room.room_no}</th>
                      <td rowSpan={rows.length} className={`${td} ${wide} whitespace-nowrap`}><Badge tone={KIND_TONE[room.kind]}>{shortKind(room)}</Badge></td>
                    </>
                  )}
                  {!g ? <td colSpan={COLS.length - 2} className={`${td} italic text-slate-500`}>No guest</td> : (
                    <>
                      <td className={`${td} font-medium`}>
                        {/* phones have no Details column (it covered the status): the name opens the popup */}
                        <button type="button" aria-haspopup="dialog" onClick={() => onDetails(g.id)}
                          className="text-left underline decoration-navy/30 underline-offset-4 hover:decoration-navy focus-visible:outline-2 focus-visible:outline-navy sm:no-underline">
                          {g.name || <span className="italic text-slate-500">Unnamed entry</span>}
                        </button>
                        {r.leavingSoon(g) && <span className="mt-1 block"><Badge tone="amber">Leaving soon</Badge></span>}
                      </td>
                      <td className={`${td} ${wide} whitespace-nowrap`}>{g.contact ? <a href={`tel:${g.contact}`} className="underline focus-visible:outline-2 focus-visible:outline-navy">{g.contact}</a> : '—'}</td>
                      <td className={`${td} whitespace-nowrap`}><StatusPill value={g.rent_status} /></td>
                      <td className={`${td} ${wide} whitespace-nowrap`}>{g.check_in ? formatDate(g.check_in) : '—'}</td>
                      <td className={`${td} ${wide} whitespace-nowrap`}>{g.expected_checkout ? formatDate(g.expected_checkout) : '—'}</td>
                      <td className={`${td} ${STICKY} ${wide} bg-white`}>
                        <button type="button" aria-haspopup="dialog" aria-label={`Details, ${g.name || 'unnamed entry'}`} onClick={() => onDetails(g.id)}
                          className="rounded-full border border-navy/30 px-3 py-1 text-xs font-semibold text-navy hover:bg-navy/5 focus-visible:outline-2 focus-visible:outline-navy">Details</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}

// Popup with one guest's full entry. Owner / manager edit in place (each field saves when you leave it).
// Room type: a guest alone in the room picks PG or rented; with 2 or more guests the room is PG, no choice.
const TYPE_OPTS = [['rented', 'Rented (whole room)'], ['pg', 'PG (shared room)']]
function GuestDetails({ g, room, canEdit, roomNos, onSaved, onCheckout, onClose }) {
  const [extending, setExtending] = useState(false)
  const date = (v) => (v ? formatDate(v) : '—')
  const alone = r.occupies(g) && room?.people === 1
  const typeText = !room || room.kind === 'empty' ? '—' : room.kind === 'pg' ? `PG · ${people(room.people)}` : 'Rented'
  return (
    <Modal title={g.name ? `Guest details: ${g.name}` : 'Guest details'} onClose={onClose} wide>
      {canEdit ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <EditCell g={g} k="name" label="Guest name" onSaved={onSaved} />
            <EditCell g={g} k="contact" label="Contact" type="tel" onSaved={onSaved} />
            <EditCell g={g} k="room_no" label="Room" options={roomNos.length ? roomNos.map((n) => [n, n]) : null} onSaved={onSaved} />
            {alone ? <EditCell g={g} k="room_type" label="Room type" options={TYPE_OPTS} onSaved={onSaved} /> : (
              <div>
                <p className="text-xs font-medium text-slate-600">Room type</p>
                <p className="mt-1"><Badge tone={KIND_TONE[room?.kind ?? 'empty']}>{typeText}</Badge></p>
                {room?.people > 1 && <p className="mt-1 text-xs text-slate-600">Rooms with 2 or more guests are always PG. Change the room no to change this.</p>}
              </div>
            )}
            <EditCell g={g} k="rent" label="Rent (₹)" type="number" onSaved={onSaved} />
            <EditCell g={g} k="rent_status" label="Rent status" options={STATUS_OPTS} onSaved={onSaved} />
            <EditCell g={g} k="deposit" label="Deposit (₹)" type="number" onSaved={onSaved} />
            <EditCell g={g} k="deposit_status" label="Deposit status" options={STATUS_OPTS} onSaved={onSaved} />
            <EditCell g={g} k="check_in" label="Check-in" type="date" onSaved={onSaved} />
            <EditCell g={g} k="expected_checkout" label="Expected check-out" type="date" onSaved={onSaved} />
            <EditCell g={g} k="due_date" label="Rent due date" type="date" onSaved={onSaved} />
            <EditCell g={g} k="notes" label="Notes" span onSaved={onSaved} />
            <FirstBill g={g} />
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-600">Changes save as you leave each field.</p>
            <div className="flex flex-wrap gap-2">
              {r.occupies(g) && <Button variant="outline" onClick={() => setExtending(true)}>Extend stay</Button>}
              <Button variant="danger" onClick={() => onCheckout(g)}>{r.occupies(g) ? 'Check out' : 'Remove'}</Button>
              <Button variant="outline" onClick={onClose}>Done</Button>
            </div>
          </div>
        </>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div><dt className="text-xs text-slate-500">Room</dt><dd>{g.room_no}</dd></div>
          <div><dt className="text-xs text-slate-500">Room type</dt><dd>{typeText}</dd></div>
          <div><dt className="text-xs text-slate-500">Contact</dt><dd>{g.contact ? <a href={`tel:${g.contact}`} className="underline focus-visible:outline-2 focus-visible:outline-navy">{g.contact}</a> : '—'}</dd></div>
          <div><dt className="text-xs text-slate-500">Rent</dt><dd>{money(g.rent)} <StatusPill value={g.rent_status} /></dd></div>
          <div><dt className="text-xs text-slate-500">Deposit</dt><dd>{money(g.deposit)} <StatusPill value={g.deposit_status} /></dd></div>
          <div><dt className="text-xs text-slate-500">Check-in</dt><dd>{date(g.check_in)}</dd></div>
          <div><dt className="text-xs text-slate-500">Expected check-out</dt><dd>{date(g.expected_checkout)}</dd></div>
          <div><dt className="text-xs text-slate-500">Rent due date</dt><dd>{date(g.due_date)}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-slate-500">Notes</dt><dd className="break-words">{g.notes || '—'}</dd></div>
          <FirstBill g={g} />
        </dl>
      )}
      {extending && <ExtendStay guest={g} onClose={() => setExtending(false)} onDone={(v) => { setExtending(false); onSaved({ id: g.id, expected_checkout: v.until, rent: (g.rent ?? 0) + (Number(v.charge) || 0), rent_status: v.status }) }} />}
    </Modal>
  )
}

// One field in edit mode: selects save on change, the rest when you leave the field. `bare` hides the label (table cells).
function EditCell({ g, k, label, type = 'text', options, span, bare, onSaved }) {
  const current = g[k] === null || g[k] === undefined ? '' : String(g[k])
  const [v, setV] = useState(current)
  const [state, setState] = useState('')
  useEffect(() => setV(current), [current])
  const save = async (val) => {
    if (val === current) return
    if (k === 'contact' && val && !/^\d{10}$/.test(val)) { setState('Contact must be exactly 10 digits. Not saved.'); return }
    setState('Saving…')
    try {
      await r.saveGuestField(g.id, k, val)
      onSaved({ id: g.id, ...r.clean({ [k]: val }) })
      setState('Saved')
    } catch (e) { setState(e.message || 'Save failed') }
  }
  const id = `g${g.id}-${k}`
  const bad = state && state !== 'Saving…' && state !== 'Saved'
  return (
    <div className={span ? 'col-span-2' : ''}>
      <label htmlFor={id} className={bare ? 'sr-only' : 'text-xs font-medium text-slate-600'}>{label}</label>
      {options ? (
        <select id={id} className={inputCls} value={v} onChange={(e) => { setV(e.target.value); save(e.target.value) }}>
          {options.map(([val, text]) => <option key={val} value={val}>{text}</option>)}
        </select>
      ) : (
        <input id={id} type={type} inputMode={type === 'tel' ? 'numeric' : undefined} maxLength={type === 'tel' ? 10 : undefined}
          className={`${inputCls} ${bad ? '!border-red-500' : ''}`} value={v} onChange={(e) => setV(e.target.value)} onBlur={(e) => save(e.target.value)} />
      )}
      {state && <p role={bad ? 'alert' : 'status'} className={`mt-0.5 text-xs ${bad ? 'text-red-700' : 'text-slate-500'}`}>{state}</p>}
    </div>
  )
}

// first due date of a registration: extra days instead of the rent, plus anything still owed from registration
// (no extra days when the guest joined on the 1st-10th: the first due date bills the usual rent, plus what is owed)
export function FirstBill({ g }) {
  if (g.first_bill == null && !(g.carry_forward > 0)) return null
  const first = g.first_bill != null ? g.first_bill : g.rent ?? 0
  const parts = [g.first_bill != null ? `${g.first_bill_days} extra days ${money(g.first_bill)}` : `rent ${money(first)}`,
    g.carry_forward > 0 && `${money(g.carry_forward)} still owed from registration`].filter(Boolean)
  const total = parts.length > 1 ? ` = ${money(first + g.carry_forward)}` : ''
  return <div className="col-span-2 rounded-xl bg-cream p-2 text-sm">First due date{g.due_date ? ` (${formatDate(g.due_date)})` : ''}: {parts.join(' + ')}{total}. Usual rent after that.</div>
}
