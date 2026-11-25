// Pure helpers shared by the PG-management screens. No data access here.

export const BED_STATES = {
  vacant: { label: 'Vacant', cls: 'bg-green-100 text-green-900 border-green-300' },
  occupied: { label: 'Occupied', cls: 'bg-navy text-white border-navy' },
  reserved: { label: 'Reserved', cls: 'bg-sun/40 text-navy border-gold' },
  maintenance: { label: 'Maintenance / blocked', cls: 'bg-red-100 text-red-800 border-red-300' },
  inactive: { label: 'Inactive', cls: 'bg-slate-100 text-slate-500 border-slate-300 line-through' },
}

// Same order of checks as public.bed_state() in the database
export function bedState(b) {
  if (b.is_active === false) return 'inactive'
  if (b.is_occupied) return 'occupied'
  if (b.is_reserved) return 'reserved'
  if (b.status && b.status !== 'available') return 'maintenance'
  return 'vacant'
}

// Invoice label, same rules as public.bill_state()
export function invoiceState(b, today = ymd()) {
  if (b.status === 'void') return 'void'
  if (b.status === 'paid') return 'paid'
  if (b.due_date < today) return 'overdue'
  if ((b.amount_paid || 0) > 0) return 'partially_paid'
  return 'pending'
}
export const INVOICE_TONES = { pending: 'amber', partially_paid: 'amber', overdue: 'red', paid: 'green', void: 'gray' }
export const owed = (b) => (b.status === 'unpaid' ? b.amount - (b.amount_paid || 0) : 0)

export function ageingBucket(daysLate) {
  if (daysLate <= 7) return '0-7'
  if (daysLate <= 15) return '8-15'
  if (daysLate <= 30) return '16-30'
  return '30+'
}

export const label = (s) => (s ? String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '')

// Only the last four characters of an ID number are ever kept or shown.
export const maskId = (last4) => (last4 ? `XXXX-XXXX-${last4}` : '')
export const lastFour = (idNumber) => String(idNumber || '').replace(/[^0-9A-Za-z]/g, '').slice(-4)

export const ENQUIRY_STATUSES = ['new', 'contacted', 'interested', 'visit_scheduled', 'visited', 'negotiation', 'booked', 'lost']
export const LOST_REASONS = ['price', 'location', 'food', 'found_elsewhere', 'not_reachable', 'facilities', 'other']
export const LEAD_SOURCES = ['website', 'app', 'google_ads', 'google_business', 'facebook', 'instagram', 'whatsapp', 'call', 'walk_in',
  'justdial', 'broker', 'referral', 'hoarding', 'pamphlet', 'college_tieup', 'corporate_tieup', 'other']
export const COMPLAINT_CATEGORIES = ['electrical', 'plumbing', 'wifi', 'housekeeping', 'maintenance', 'food', 'ac_appliances', 'furniture', 'security', 'noise', 'other']
// the short list residents choose from
export const RESIDENT_COMPLAINT_CATEGORIES = ['plumbing', 'electrical', 'housekeeping', 'wifi', 'maintenance', 'other']
export const COMPLAINT_LABELS = { electrical: 'Electricity', housekeeping: 'Cleaning', wifi: 'Wi-Fi', ac_appliances: 'AC / Appliances', food: 'Food / Mess', noise: 'Noise / Neighbour' }
export const complaintCategory = (c) => COMPLAINT_LABELS[c] ?? label(c)
// the database keeps 'new'; people see "Open"
export const COMPLAINT_STATUSES = ['new', 'assigned', 'in_progress', 'resolved', 'closed']
export const complaintStatus = (s) => (s === 'new' ? 'Open' : label(s))
export const isComplaintActive = (c) => ['new', 'assigned', 'in_progress'].includes(c.status)
export const isComplaintOverdue = (c, now = new Date()) => isComplaintActive(c) && Boolean(c.due_at) && new Date(c.due_at) < now

// Board filters: all | unassigned | mine | new (Open) | assigned | in_progress | resolved | closed
export function filterComplaints(list, filter, userId) {
  if (filter === 'all') return list
  if (filter === 'unassigned') return list.filter((c) => !c.assigned_to && isComplaintActive(c))
  if (filter === 'mine') return list.filter((c) => c.assigned_to === userId)
  return list.filter((c) => c.status === filter)
}
export const PRIORITIES = ['low', 'medium', 'high', 'urgent']
export const CHARGE_KINDS = ['electricity', 'ac', 'laundry', 'food', 'parking', 'maintenance', 'wifi', 'fine', 'damage', 'other']
export const ID_TYPES = ['aadhaar', 'driving_licence', 'passport', 'voter_id', 'college_id', 'company_id', 'pan', 'other']
export const PAY_MODES = ['cash', 'upi', 'bank_transfer', 'cheque']

// Next allowed complaint moves; update_complaint() enforces the same rules.
// admin: the owner. mine: the complaint is assigned to this login. tenant: the resident who raised it.
// Assignment is not a move: it happens by assigning (admin) or taking (manager).
export function complaintMoves(status, { admin, mine, tenant }) {
  const m = []
  if ((admin || mine) && status === 'assigned') m.push('in_progress')
  if ((admin || mine) && ['assigned', 'in_progress'].includes(status)) m.push('resolved')
  if ((admin && status !== 'closed') || (tenant && status === 'resolved')) m.push('closed')
  if ((admin && ['resolved', 'closed'].includes(status)) || (tenant && status === 'resolved')) m.push('reopen')
  return m
}

// Lead temperature rule used for the preview (the database sets the stored value the same way)
export function leadTemperature(moveIn, today = new Date(), hot = 7, warm = 30) {
  if (!moveIn) return 'warm'
  const days = Math.round((new Date(`${moveIn}T00:00`) - new Date(today.toDateString())) / 864e5)
  if (days <= hot) return 'hot'
  if (days <= warm) return 'warm'
  return 'cold'
}

export const ymd = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const monthStart = (d = new Date()) => ymd(new Date(d.getFullYear(), d.getMonth(), 1))
export const addDays = (s, n) => { const d = new Date(`${s}T00:00`); d.setDate(d.getDate() + n); return ymd(d) }

// WhatsApp-ready vacancy message built from live bed data (PRD 9.4)
// taken(room): beds in use that the bed records don't know about (guests kept only in the guest register)
export function vacancyMessage(rooms, { brandName, phone, url, taken = () => 0 }) {
  const lines = rooms
    .map((r) => ({ r, free: Math.max(0, (r.beds || []).filter((b) => bedState(b) === 'vacant').length - taken(r)) }))
    .filter((x) => x.free > 0)
    .map(({ r, free }) => `• Room ${r.room_no} (${r.ac_type}, ${label(r.room_type)}): ${free} bed${free > 1 ? 's' : ''} free · ₹${Number(r.price).toLocaleString('en-IN')}/${r.billing_period === 'night' ? 'night' : 'month'}`)
  if (!lines.length) return `${brandName}: we are full right now. Call ${phone} to join the waiting list.`
  return [`🏠 ${brandName} - beds available now`, ...lines, '', `Book a visit: ${url}`, `Call / WhatsApp: ${phone}`].join('\n')
}
