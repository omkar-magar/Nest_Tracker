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

// Extensions: a guest on a daily stay asks; the manager extends any stay (also after check-out) with the dates they
// decide, an optional charge added to the rent and the rent status.
export const isDailyStay = (t) => t === 'pg_daily' || t === 'flat_daily'
export const myExtension = () => rpc('my_extension')
export const requestExtension = (until, note) => rpc('request_extension', { p_until: until, p_note: note || '' })
export const cancelExtension = (id) => rpc('cancel_extension', { p_id: id })
export const extensionRequests = (pid) => rpc('extension_requests', { p_property: pid || null })
export const extendStay = (guestId, { until, charge, status, note }, requestId = null) => rpc('extend_stay', {
  p_guest: guestId, p_until: until, p_charge: Number(charge) || 0, p_status: status || null, p_note: note || '', p_request: requestId,
})
export const declineExtension = (id, note) => rpc('decline_extension', { p_id: id, p_note: note || '' })
export const EXTENSION_STATUS = { requested: ['Waiting for your manager', 'amber'], approved: ['Approved', 'green'], declined: ['Not approved', 'red'], cancelled: ['Cancelled', 'gray'] }
