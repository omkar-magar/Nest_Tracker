import { supabase } from '../lib/supabase'
import { rows } from './manage'

// Furniture and mattress stock per room (table room_inventory; who may read or edit is in its RLS).
export const INVENTORY_ITEMS = [
  ['mattress', 'Mattresses'], ['cupboard', 'Cupboards'], ['table', 'Tables'], ['bed', 'Beds'], ['chair', 'Chairs'], ['pillow', 'Pillows'],
]

export const loadInventory = (pid) =>
  rows('room_inventory', 'property_id, room_no, item, qty, updated_at', (q) => (pid ? q.eq('property_id', pid) : q).order('room_no'))

// one room's counts, e.g. { mattress: 5, bed: 5 }; every listed item is written so a cleared field saves as 0
export async function saveRoomInventory(property, roomNo, counts) {
  const items = [...new Set([...INVENTORY_ITEMS.map(([k]) => k), ...Object.keys(counts)])]
  const list = items.map((item) => ({ property_id: property, room_no: roomNo, item, qty: Math.max(0, Math.floor(Number(counts[item]) || 0)) }))
  const { error } = await supabase.from('room_inventory').upsert(list, { onConflict: 'property_id,room_no,item' })
  if (error) throw error
}

// rows -> sorted rooms with counts per item, plus totals; rooms are grouped by wing and floor (101 -> floor 1)
export function summarizeInventory(list, properties = []) {
  const wingOf = Object.fromEntries(properties.map((p) => [p.id, p.wing ? `${p.wing} wing` : p.name]))
  const byRoom = {}
  const totals = {}
  const extra = new Set()
  for (const r of list ?? []) {
    const key = `${r.property_id}|${r.room_no}`
    const room = (byRoom[key] ??= { key, property_id: r.property_id, room_no: r.room_no, wing: wingOf[r.property_id] ?? r.property_id, counts: {} })
    room.counts[r.item] = (room.counts[r.item] ?? 0) + r.qty
    totals[r.item] = (totals[r.item] ?? 0) + r.qty
    if (!INVENTORY_ITEMS.some(([k]) => k === r.item)) extra.add(r.item)
  }
  const items = [...INVENTORY_ITEMS, ...[...extra].sort().map((k) => [k, k[0].toUpperCase() + k.slice(1).replace(/_/g, ' ')])]
  const rooms = Object.values(byRoom).sort((a, b) =>
    a.property_id.localeCompare(b.property_id) || a.room_no.localeCompare(b.room_no, undefined, { numeric: true }))
  const groups = []
  for (const r of rooms) {
    const n = Number.parseInt(r.room_no, 10)
    const label = `${r.wing} · ${Number.isFinite(n) && n >= 100 ? `Floor ${Math.floor(n / 100)}` : 'Other rooms'}`
    let g = groups[groups.length - 1]
    if (!g || g.label !== label) groups.push(g = { label, rooms: [], totals: {} })
    g.rooms.push(r)
    for (const [k, v] of Object.entries(r.counts)) g.totals[k] = (g.totals[k] ?? 0) + v
  }
  return { items, rooms, groups, totals }
}

// "5 mattresses · 1 chair" for a room card; empty when nothing is recorded
export function inventoryLine(counts = {}) {
  return INVENTORY_ITEMS.filter(([k]) => counts[k] > 0)
    .map(([k, plural]) => `${counts[k]} ${counts[k] === 1 ? k : plural.toLowerCase()}`)
    .join(' · ')
}
