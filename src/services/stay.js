import { rpc } from './manage'

// The resident's live stay from the guest register: rent this month and next (with approved extras),
// furniture in their room, and their extra-furniture requests. Null until a manager approves them.
export const myStay = () => rpc('my_stay')
export const requestAddon = (item, qty) => rpc('request_addon', { p_item: item, p_qty: Number(qty) })
export const cancelAddon = (id) => rpc('cancel_addon', { p_id: id })

// managers
export const addonRequests = (pid) => rpc('addon_requests', { p_property: pid || null })
export const decideAddon = (id, approve, note) => rpc('decide_addon', { p_id: id, p_approve: approve, p_note: note || '' })

export const ADDON_LABELS = { chair: 'Chair', table: 'Table', cupboard: 'Cupboard' }
export const addonLabel = (item) => ADDON_LABELS[item] ?? item[0].toUpperCase() + item.slice(1).replace(/_/g, ' ')
export const ADDON_STATUS = { requested: 'Waiting for approval', approved: 'Approved', rejected: 'Declined', cancelled: 'Cancelled' }

// '2026-12-01' -> 'December 2026'
export const monthName = (d) => (d ? new Date(`${d.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '')
