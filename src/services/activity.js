import { rpc } from './manage'
import { rupees } from './format'

// Owner-only screens: the registration pipeline and recent activity. The database works out stages and groups;
// this file only turns rows into sentences and links.

export const adminRegistrations = (pid) => rpc('admin_registrations', { p_property: pid || null })
export const adminRecentActivity = (pid, days = 7) => rpc('admin_recent_activity', { p_property: pid || null, p_days: days })

// ---------------------------------------------------------------- registrations
export const STAGES = [
  ['waiting', 'Waiting for approval'],
  ['started', 'Started, not sent'],
  ['rejected', 'Rejected'],
  ['living', 'Approved · living'],
  ['ended', 'Checked out'],
]
export const STAGE_LABEL = Object.fromEntries(STAGES)
export const LATE_HOURS = 12 // a registration waiting longer than this is flagged

export function duration(from, to = new Date()) {
  const mins = Math.max(0, Math.round((new Date(to) - new Date(from)) / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ${mins % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

// waiting time so far, or how long the approval took; late = waiting past LATE_HOURS
export function timing(r, now = new Date()) {
  if (r.stage === 'waiting' && r.submitted_at) {
    return { text: `waiting ${duration(r.submitted_at, now)}`, late: now - new Date(r.submitted_at) > LATE_HOURS * 3600000 }
  }
  if (r.submitted_at && r.approved_at && ['living', 'ended', 'rejected'].includes(r.stage)) {
    return { text: `took ${duration(r.submitted_at, r.approved_at)}`, late: false }
  }
  return { text: '', late: false }
}

// who has it: the approver once decided, otherwise the alerted managers
export function handling(r) {
  if (r.stage === 'started') return 'Not sent yet'
  if (['living', 'ended', 'rejected'].includes(r.stage) && r.approved_by) {
    return `${r.stage === 'rejected' ? 'Rejected' : 'Approved'} by ${r.approved_by}`
  }
  if (!r.handlers?.length) return 'No manager alerted for this wing'
  const seen = r.handlers.filter((h) => h.seen).map((h) => h.name)
  const names = r.handlers.map((h) => h.name).join(', ')
  return seen.length ? `${names} · seen by ${seen.join(', ')}` : `${names} · not seen yet`
}

// where to act on it
export function registrationLink(r) {
  if (r.stage === 'waiting') return { to: `/admin/register?wing=${r.property_id}&tab=new`, text: 'Approve in register' }
  if ((r.stage === 'living' || r.stage === 'ended') && r.property_id) {
    return { to: `/admin/register?wing=${r.property_id}&q=${encodeURIComponent(r.name)}`, text: 'Open in register' }
  }
  return { to: `/admin/tenants/${r.id}`, text: 'Open profile' }
}

// timeline steps for the detail view: [label, at, by]
export function timeline(r, wing = r.property_id) {
  const steps = [['Signed up', r.signed_up_at]]
  if (r.submitted_at) steps.push([`Sent the form${wing ? ` · ${wing}` : ''}`, r.submitted_at])
  for (const h of r.handlers ?? []) steps.push([`Alert to ${h.name}${h.seen ? ' · seen' : ' · not seen'}`, null])
  if (r.stage === 'rejected') steps.push([`Rejected${r.approved_by ? ` by ${r.approved_by}` : ''}${r.note ? `: ${r.note}` : ''}`, r.approved_at])
  if (r.stage === 'living' || r.stage === 'ended') {
    steps.push([`Approved${r.approved_by ? ` by ${r.approved_by}` : ''}${r.room_no ? ` · Room ${r.room_no}` : ''}`, r.approved_at])
  }
  if (r.checked_out_on) steps.push(['Checked out', r.checked_out_on])
  return steps
}

// ---------------------------------------------------------------- recent activity
// [key, title, icon, link to the whole area]
export const GROUPS = [
  ['registrations', 'Registrations', 'userPlus', '/admin/registrations'],
  ['complaints', 'Complaints', 'wrench', '/admin/complaints'],
  ['submissions', 'Submissions to review', 'doc', null],
  ['guests', 'Guest register', 'bed', '/admin/register'],
  ['money', 'Money', 'rupee', '/admin/billing'],
  ['enquiries', 'Enquiries', 'search', '/admin/enquiries'],
]

const amt = (i) => (i.amount != null ? rupees(i.amount) : '')
const join = (...parts) => parts.filter(Boolean).join(' · ')
const reg = (i) => `/admin/registrations?open=${i.ref}`
const inRegister = (i) => `/admin/register?${i.property_id ? `wing=${i.property_id}&` : ''}q=${encodeURIComponent(i.name)}`

const DESCRIBE = {
  registrations: {
    submitted: (i) => ({ text: `${i.name} registered`, sub: i.open ? 'Waiting for approval' : '', to: reg(i) }),
    approved: (i) => ({ text: `${i.name} approved${i.detail ? ` · Room ${i.detail}` : ''}`, sub: i.who && `by ${i.who}`, to: reg(i) }),
    rejected: (i) => ({ text: `${i.name}'s registration rejected`, sub: join(i.detail, i.who && `by ${i.who}`), to: reg(i) }),
  },
  complaints: {
    raised: (i) => ({ text: `New complaint: ${i.name}`, sub: join(i.detail, i.who), to: `/admin/complaints?open=${i.ref}` }),
    resolved: (i) => ({ text: `Resolved: ${i.name}`, sub: join(i.detail, i.who && `fixed by ${i.who}`), to: `/admin/complaints?open=${i.ref}` }),
  },
  guests: {
    insert: (i) => ({ text: `${i.name} added to Room ${i.detail}`, sub: i.who && `by ${i.who}`, to: inRegister(i) }),
    return: (i) => ({ text: `${i.name} is back in Room ${i.detail}`, sub: i.who && `by ${i.who}`, to: inRegister(i) }),
    checkout: (i) => ({ text: `${i.name} checked out of Room ${i.detail}`, sub: i.who && `by ${i.who}`, to: inRegister(i) }),
    delete: (i) => ({ text: `${i.name} removed from the register`, sub: i.who && `by ${i.who}`, to: '/admin/register' }),
  },
  money: {
    rent_paid: (i) => ({ text: `${i.name} rent marked paid ${amt(i)}`.trim(), sub: join(i.detail, i.who && `by ${i.who}`), to: inRegister(i) }),
    payment: (i) => ({ text: `${i.name || 'A tenant'} paid ${amt(i)}`, sub: 'Online payment', to: `/admin/tenants/${i.ref}` }),
    expense: (i) => ({ text: `${i.name} expense ${amt(i)}`, sub: join(i.detail, i.who && `by ${i.who}`), to: '/admin/expenses' }),
  },
  submissions: {
    document: (i) => ({ text: `${i.name || 'A tenant'} uploaded ${i.detail}`, sub: i.open ? 'Needs review' : 'Reviewed', to: `/admin/tenants/${i.ref}` }),
    leave: (i) => ({ text: `${i.name} asked for leave`, sub: i.detail, to: '/admin/staff?tab=leave' }),
    expense: (i) => ({ text: `${i.name} expense ${amt(i)} to approve`, sub: join(i.detail, i.who && `by ${i.who}`), to: '/admin/expenses' }),
  },
  enquiries: {
    new: (i) => ({ text: `New enquiry from ${i.name}`, sub: join(i.detail && `via ${i.detail}`, i.who && `with ${i.who}`), to: `/admin/enquiries/${i.ref}` }),
  },
}

// { text, sub, to } for one feed item
export function describe(group, item) {
  const fn = DESCRIBE[group]?.[item.kind]
  return fn ? fn(item) : { text: item.name || item.kind, sub: item.detail, to: null }
}
