import { deleteRow, loadProperties, rows, rpc, updateRow } from './manage'
import { ymd } from './pg'

// Guest register: a room-by-room list of who is staying, without logins. Rules (who may edit, check-out,
// history, restore) live in supabase/migrations/20261121152007_guest_register.sql. This file holds the data
// calls plus the pure helpers: room counts, change links, imports.

export const STATUSES = ['paid', 'pending', 'partially_paid', 'not_updated', 'not_applicable']
export const STATUS_TEXT = { paid: 'Paid', pending: 'Pending', partially_paid: 'Partially paid', not_updated: 'Not updated', not_applicable: 'Not applicable' }
export const FIELDS = ['room_no', 'name', 'contact', 'rent', 'deposit', 'rent_status', 'deposit_status', 'check_in', 'expected_checkout', 'notes']
const LIVE_COLS = 'id, property_id, room_no, sort_order, name, contact, rent, deposit, rent_status, deposit_status, check_in, expected_checkout, notes, room_type, updated_at, due_date, customer_id, stay_type, first_bill, first_bill_days, carry_forward'

// ---------------------------------------------------------------- data
export async function loadRegisterProperties() {
  const [all, mine] = await Promise.all([loadProperties(), rpc('my_property_ids')])
  const ids = new Set((mine ?? []).map((r) => (typeof r === 'string' ? r : r.my_property_ids)))
  return all.filter((p) => ids.has(p.id))
}
// In a building with wings the same number exists in each wing, so the register names rooms "A-101"
export const roomKey = (room) => (room.wing ? `${room.wing}-${room.room_no}` : room.room_no)
export const loadRegisterRooms = (pid) => rows('rooms', 'room_no, floor, wing', (q) => q.eq('property_id', pid).eq('is_active', true))
  .then((list) => list.map((x) => ({ ...x, room_no: roomKey(x) })))
export const loadRegister = async (pid) => { await rpc('register_auto_checkout').catch(() => 0); return loadRegisterRows(pid) }
const loadRegisterRows = (pid) => rows('register_guests', LIVE_COLS, (q) => q.eq('property_id', pid).is('checked_out_on', null).order('sort_order').limit(2000))
export const loadPastGuests = (pid) => rows('register_guests', `${LIVE_COLS}, checked_out_on, checkout_note`,
  (q) => q.eq('property_id', pid).not('checked_out_on', 'is', null).order('checked_out_on', { ascending: false }).limit(1000))
export function loadRegisterHistory(pid, day) {
  return rows('register_history', '*', (q) => {
    let x = q.eq('property_id', pid)
    if (day) {
      const from = new Date(`${day}T00:00:00`)
      x = x.gte('changed_at', from.toISOString()).lt('changed_at', new Date(from.getTime() + 864e5).toISOString())
    }
    return x.order('changed_at', { ascending: false }).order('id', { ascending: false }).limit(500)
  })
}
export const applyChanges = (pid, ops, isImport = false) => rpc('register_apply', { p_property: pid, p_ops: ops, p_import: isImport })
export const addGuest = (pid, set, after) => applyChanges(pid, [{ op: 'add', set: clean(set), ...(after ? { after } : {}) }])
export const saveGuestField = (id, key, value) => updateRow('register_guests', id, clean({ [key]: value }))
export const checkoutGuest = (id, date, note) => rpc('register_checkout', { p_id: id, p_date: date, p_note: note || '' })
export const returnGuest = (id) => rpc('register_return', { p_id: id })
export const removeEntry = (id) => deleteRow('register_guests', id)
export const restoreHistory = (id) => rpc('register_restore', { p_history: id })

// Staying guests of one wing or, with no pid, every wing the login may see; for the bed board and reports
export const loadStayingGuests = (pid) => rows('register_guests', 'id, property_id, room_no, name, rent, rent_status, expected_checkout',
  (q) => (pid ? q.eq('property_id', pid) : q).is('checked_out_on', null).order('sort_order').limit(2000))
// staying guests whose name, contact or room contains `text` (header search); characters PostgREST's or() treats
// as syntax are dropped
export function searchGuests(text, pid) {
  const s = String(text ?? '').replace(/[,()*%\\"]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return Promise.resolve([])
  return rows('register_guests', 'id, property_id, room_no, name, contact, rent_status, check_in', (q) =>
    (pid ? q.eq('property_id', pid) : q).is('checked_out_on', null).neq('name', '')
      .or(`name.ilike.*${s}*,contact.ilike.*${s}*,room_no.ilike.*${s}*`).order('room_no').limit(20))
}
// "P1|A-101" -> named guests in that room, so app rooms ({ property_id, wing, room_no }) can find theirs
export const guestKey = (room) => `${room.property_id}|${roomKey(room)}`
export function guestsByRoom(guests = []) {
  const by = {}
  for (const g of guests.filter(occupies)) (by[`${g.property_id}|${g.room_no}`] ??= []).push(g)
  return by
}

// Figures for the dashboards (owner and managers only): per wing and grand total, who is leaving, whose rent is
// pending, latest arrivals / departures. '' or null = every wing the login may see.
export const EMPTY_SUMMARY = { totals: {}, properties: [], leaving: [], rent_pending: [], recent: [] }
export const registerSummary = (pid) => rpc('register_summary', { p_property: pid || null })
// the wing table: the bed / money row from owner_dashboard with that wing's register figures as `reg`
export const withRegister = (properties = [], reg = EMPTY_SUMMARY) => {
  const by = Object.fromEntries((reg.properties ?? []).map((p) => [p.id, p]))
  const ids = new Set([...properties.map((p) => p.id), ...Object.keys(by)])
  return [...ids].sort().map((id) => {
    const p = properties.find((x) => x.id === id) ?? { id, name: by[id]?.name ?? id }
    return { ...p, reg: by[id] ?? {} }
  })
}
// app bookings leaving soon and register guests with an expected check-out, one list by date
export const departures = (bookings = [], leaving = []) => [
  ...bookings.map((b) => ({ ...b, id: `b${b.booking_id}`, source: 'app' })),
  ...leaving.map((g) => ({ id: `g${g.id}`, name: g.name, room: g.room, date: g.date, source: 'register' })),
].sort((a, b) => String(a.date).localeCompare(String(b.date)))

// ---------------------------------------------------------------- values
const NUMS = ['rent', 'deposit']
const DATES = ['check_in', 'expected_checkout', 'checked_out_on', 'due_date']
export const money = (v) => {
  const s = String(v ?? '').replace(/[₹,\s]|rs\.?/gi, '')
  return s !== '' && /^\d+(\.\d+)?$/.test(s) ? Math.round(Number(s)) : null
}
// YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY (Indian order) -> YYYY-MM-DD, else null
export function toDate(v) {
  const s = String(v ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (!m) return null
  const y = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}
// "Paid", "partially paid", "Partially_Paid" -> status key
export function toStatus(v) {
  const k = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return STATUSES.includes(k) ? k : null
}
// form / link values -> what the columns take ('' becomes null for numbers and dates)
export function clean(set) {
  const out = {}
  for (const [k, raw] of Object.entries(set)) {
    if (k === 'room_type') { out[k] = raw === 'pg' ? 'pg' : 'rented'; continue }
    if (!FIELDS.includes(k) && k !== 'checked_out_on' && k !== 'checkout_note' && k !== 'due_date') continue
    if (NUMS.includes(k)) out[k] = money(raw)
    else if (DATES.includes(k)) out[k] = raw ? toDate(raw) : null
    else if (k.endsWith('_status')) out[k] = toStatus(raw) ?? 'not_updated'
    else out[k] = String(raw ?? '').trim()
  }
  return out
}

// ---------------------------------------------------------------- rooms: 2+ guests make a PG room; a guest alone is PG or rented by their room_type
export const occupies = (g) => Boolean(String(g.name ?? '').trim())
export const roomKind = (people, alone) => (people === 0 ? 'empty' : people === 1 && alone?.room_type !== 'pg' ? 'rented' : 'pg')
export const KIND_TEXT = { empty: 'Empty', rented: 'Rented', pg: 'PG' }
const byRoomNo = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })
export const floorOf = (roomNo) => { const n = parseInt(String(roomNo).split('-').pop(), 10); return Number.isFinite(n) && n >= 100 ? Math.floor(n / 100) : 0 }

// rooms: [{ room_no, floor? }] from the property; rooms only found in the register are added
export function roomSummary(guests, rooms = []) {
  const floor = Object.fromEntries(rooms.map((r) => [r.room_no, r.floor ?? floorOf(r.room_no)]))
  for (const g of guests) if (!(g.room_no in floor)) floor[g.room_no] = floorOf(g.room_no)
  const list = Object.keys(floor).sort(byRoomNo).map((room_no) => {
    const inRoom = guests.filter((g) => g.room_no === room_no)
    const people = inRoom.filter(occupies).length
    return { room_no, floor: floor[room_no], guests: inRoom, people, kind: roomKind(people, inRoom.find(occupies)) }
  })
  const of = (k) => list.filter((r) => r.kind === k)
  return {
    rooms: list,
    totalRooms: list.length,
    people: list.reduce((s, r) => s + r.people, 0),
    occupiedRooms: list.length - of('empty').length,
    pgRooms: of('pg').length,
    pgPeople: of('pg').reduce((s, r) => s + r.people, 0),
    rentedRooms: of('rented').length,
    emptyRooms: of('empty').length,
    rent: guests.reduce((s, g) => s + (Number(g.rent) || 0), 0),
    deposit: guests.reduce((s, g) => s + (Number(g.deposit) || 0), 0),
    rentPending: guests.filter((g) => occupies(g) && ['pending', 'partially_paid'].includes(g.rent_status)).length,
  }
}

export const sortGuests = (list) => [...list].sort((a, b) => byRoomNo(a.room_no, b.room_no) || a.sort_order - b.sort_order || a.id - b.id)
export const leavingSoon = (g, days = 7, today = ymd()) => {
  if (!g.expected_checkout) return false
  const d = new Date(`${today}T00:00`); d.setDate(d.getDate() + days)
  return g.expected_checkout <= ymd(d)
}
export const nightsBetween = (a, b) => (a && b ? Math.round((new Date(`${b}T00:00`) - new Date(`${a}T00:00`)) / 864e5) : null)

// ---------------------------------------------------------------- change links (?changes=[...])
// The same link format the old stand-alone page used, so instructions already pasted into an AI keep working.
// "flat" is accepted for room_no and status labels like "Paid" for keys. "delete" checks the guest out today.
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const linkFields = (s = {}, roomNos) => {
  if (s.payment !== undefined) throw new Error('Use rent_status / deposit_status instead of payment')
  const src = { ...s, room_no: s.room_no ?? s.room ?? s.flat }
  const f = {}
  for (const k of FIELDS) {
    if (src[k] === undefined || src[k] === null) continue
    const v = String(src[k]).trim()
    if (k === 'room_no' && roomNos.length && !roomNos.includes(v)) throw new Error(`Unknown room "${v}"`)
    if (k.endsWith('_status') && !toStatus(v)) throw new Error(`Invalid ${k.replace('_', ' ')} "${v}"`)
    if (k === 'contact' && v && !/^\d{10}$/.test(v)) throw new Error('Contact must be 10 digits')
    if (NUMS.includes(k) && v && money(v) === null) throw new Error(`${k} must be a number`)
    if (DATES.includes(k) && v && !toDate(v)) throw new Error(`${k.replace('_', ' ')} must be a date`)
    f[k] = v
  }
  return clean(f)
}
export function findGuest(list, m) {
  if (!m || typeof m !== 'object' || !Object.keys(m).length) return { err: 'No match details given' }
  const room = m.room_no ?? m.room ?? m.flat
  let r = list.filter((g) => (m.id === undefined || g.id === Number(m.id)) && (room === undefined || String(g.room_no) === String(room))
    && (m.contact === undefined || String(g.contact) === String(m.contact)))
  if (m.name !== undefined) {
    const n = norm(m.name)
    const exact = r.filter((g) => norm(g.name) === n)
    r = exact.length ? exact : r.filter((g) => n && norm(g.name).includes(n))
  }
  if (!r.length) return { err: `No guest found for ${JSON.stringify(m)}` }
  if (r.length > 1) return { err: `${r.length} guests match ${JSON.stringify(m)}; add the room or contact` }
  return { g: r[0] }
}

const describe = (f) => Object.entries(f).filter(([k, v]) => k !== 'room_no' && v !== null && v !== '')
  .map(([k, v]) => `${k.replace(/_/g, ' ')} ${k.endsWith('_status') ? STATUS_TEXT[v] : v}`).join(' · ')

// -> { items: [{ ok, tag, text, err }], ops } ; ops go to applyChanges
export function buildPlan(changes, guests, roomNos = [], today = ymd()) {
  const list = Array.isArray(changes) ? changes : [changes]
  const work = guests.map((g) => ({ ...g }))
  const items = []; const ops = []
  for (const c of list.slice(0, 50)) {
    const it = { ok: false, tag: String(c?.op ?? '?').toUpperCase(), text: '', err: '' }
    items.push(it)
    try {
      if (!c || typeof c !== 'object') throw new Error('Bad item')
      if (c.op === 'add') {
        const f = linkFields(c.set ?? c, roomNos)
        if (!f.room_no) throw new Error('Room is required')
        let after
        if (c.after) {
          const r = findGuest(work, c.after)
          if (r.err) throw new Error(`after: ${r.err}`)
          after = r.g.id
        }
        it.text = `Add ${f.name || 'blank entry'} to room ${f.room_no}${describe(f) ? ` · ${describe(f)}` : ''}`
        ops.push({ op: 'add', set: f, ...(after ? { after } : {}) })
      } else if (c.op === 'update') {
        const r = findGuest(work, c.match)
        if (r.err) throw new Error(r.err)
        it.text = `Room ${r.g.room_no} · ${r.g.name || 'unnamed'}`
        const f = linkFields(c.set, roomNos)
        if (!Object.keys(f).length) throw new Error('Nothing to change')
        const changed = Object.keys(f).filter((k) => String(r.g[k] ?? '') !== String(f[k] ?? ''))
        if (!changed.length) throw new Error('Already set, no change')
        it.text += `: ${changed.map((k) => `${k.replace(/_/g, ' ')} ${r.g[k] || '-'} → ${f[k] || '-'}`).join(', ')}`
        Object.assign(r.g, f)
        ops.push({ op: 'update', id: r.g.id, set: Object.fromEntries(changed.map((k) => [k, f[k]])) })
      } else if (c.op === 'delete' || c.op === 'checkout') {
        const r = findGuest(work, c.match)
        if (r.err) throw new Error(r.err)
        const date = toDate(c.date) ?? today
        it.tag = 'CHECK OUT'
        it.text = `Check out ${r.g.name || 'unnamed'} (room ${r.g.room_no}) on ${date}`
        work.splice(work.indexOf(r.g), 1)
        ops.push({ op: 'checkout', id: r.g.id, date, note: String(c.note ?? '') })
      } else throw new Error(`Unknown op "${c.op}"`)
      it.ok = true
    } catch (e) {
      it.err = e.message
      if (!it.text) it.text = JSON.stringify(c).slice(0, 110)
    }
  }
  return { items, ops }
}

export function readChangesParam(search) {
  const raw = new URLSearchParams(search).get('changes')
  if (raw === null) return null
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [v] } catch { return [{ op: 'invalid' }] }
}

export function guideText(base, roomNos = []) {
  const ex = [{ op: 'update', match: { room_no: '101', name: 'Rahul Sinha' }, set: { rent_status: 'paid' } },
    { op: 'add', set: { room_no: '102', name: 'New Guest', contact: '9876543210', rent: '5500', deposit: '5500', check_in: '2026-12-01' } }]
  return `You create one-click links that edit my PG guest register.
Link format: ${base}?changes=<URL-encoded JSON array>
Build the JSON array, then encode it with encodeURIComponent (spaces become %20, never "+").
Each array item is one of:
 {"op":"update","match":{"room_no":"101","name":"Full Name"},"set":{"rent_status":"paid"}}
 {"op":"add","set":{"room_no":"102","name":"Full Name","contact":"10 digits","rent":"5500","deposit":"5500","check_in":"YYYY-MM-DD"}}   (optional "after":{"room_no":"..","name":".."} places it after that guest)
 {"op":"checkout","match":{"room_no":"101","name":"Full Name"},"date":"YYYY-MM-DD","note":""}   (guest leaves; date defaults to today)
Fields you may set: ${FIELDS.join(', ')}.
rent_status and deposit_status must each be one of: ${STATUSES.join(' | ')}
Dates are YYYY-MM-DD. contact must be exactly 10 digits.${roomNos.length ? `\nroom_no must be one of: ${roomNos.join(', ')}` : ''}
"match" must identify exactly ONE guest: use room_no + name exactly as in the register (or contact). Never guess names or numbers; ask me if unsure.
Keep each link to 40 changes or fewer.
Reply with the link as a clickable markdown link, plus one plain line per change so I can double-check before clicking.
Example link: ${base}?changes=${encodeURIComponent(JSON.stringify(ex))}`
}

// ---------------------------------------------------------------- imports
// Old stand-alone page backup ({ guests, history }) or a CSV (headers like the Excel export, or the old ones).
// Returns { ops, skipped: [reason], past } ; past = guests deleted in the old page, offered as Past guests.
const pick = (r, ...keys) => { for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k]; return '' }
function fromOld(r) {
  const contact = String(pick(r, 'contact', 'phone', 'mobile', 'contact_number')).replace(/\D/g, '')
  const rent = pick(r, 'rent', 'rent_', 'rent_rs'); const deposit = pick(r, 'deposit', 'deposit_', 'deposit_rs')
  const extra = [money(rent) === null && rent ? `Rent: ${rent}` : '', money(deposit) === null && deposit ? `Deposit: ${deposit}` : '']
  if (contact && contact.length !== 10) extra.push(`Contact: ${contact}`)
  return {
    room_no: String(pick(r, 'room_no', 'room', 'flat', 'flat_no')).trim(),
    name: String(pick(r, 'name', 'tenant', 'guest_name', 'guest')).trim(),
    contact: contact.length === 10 ? contact : '',
    rent: money(rent), deposit: money(deposit),
    rent_status: toStatus(pick(r, 'rent_status', 'payment')) ?? 'not_updated',
    deposit_status: toStatus(pick(r, 'deposit_status', 'payment')) ?? 'not_updated',
    check_in: toDate(pick(r, 'check_in', 'checkin', 'check_in_date')),
    expected_checkout: toDate(pick(r, 'expected_checkout', 'expected_check_out', 'check_out', 'checkout')),
    notes: [String(pick(r, 'notes')).trim(), ...extra].filter(Boolean).join(' · '),
  }
}
// wing: put rooms without a wing ("101") into that wing ("A-101")
export function parseImport(data, existing = [], { wing = '' } = {}) {
  const inWing = (f) => (wing && f.room_no && !f.room_no.includes('-') ? { ...f, room_no: `${wing}-${f.room_no}` } : f)
  const seen = new Set(existing.map((g) => `${g.room_no}|${norm(g.name)}`))
  const skipped = []; const ops = []
  const guests = Array.isArray(data) ? data : data?.guests
  if (!Array.isArray(guests)) throw new Error('This file has no guest list. Use the JSON backup from the old page, or a CSV.')
  for (const [i, r] of guests.entries()) {
    const f = inWing(fromOld(r))
    if (!f.room_no) { skipped.push(`Row ${i + 1}: no room`); continue }
    if (!f.name) continue // empty placeholder rows; the room overview shows empty rooms anyway
    const key = `${f.room_no}|${norm(f.name)}`
    if (seen.has(key)) { skipped.push(`Row ${i + 1}: ${f.name} (room ${f.room_no}) is already in the register`); continue }
    seen.add(key)
    ops.push({ op: 'add', set: f })
  }
  const past = []
  for (const h of Array.isArray(data?.history) ? data.history : []) {
    if (h.op !== 'DELETE' || !h.old_row?.name) continue
    const f = inWing(fromOld(h.old_row))
    if (!f.room_no) continue
    const day = String(h.changed_at ?? '').slice(0, 10) || ymd()
    past.push({ op: 'add', set: { ...f, checked_out_on: day, checkout_note: `Removed in the old register on ${day}` } })
  }
  return { ops, skipped, past }
}
