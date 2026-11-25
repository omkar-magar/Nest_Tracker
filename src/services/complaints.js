import { rpc, rows, uploadFile } from './manage'

// Complaint management. Who may do what is decided by update_complaint() and RLS in
// supabase/migrations/20261125000002_complaint_management.sql; these are thin calls.
// Admin/manager data is user-specific, so it goes through useAsync (via <Load>), never the shared cache.

const update = (id, p) => rpc('update_complaint', { p_id: id, p })

// ---------------------------------------------------------------- office (admin, managers)
export const loadBoard = () =>
  rows('complaints', '*, rooms(room_no), beds(code), profiles!complaints_customer_id_fkey(full_name, phone), vendors(name)',
    (q) => q.order('created_at', { ascending: false }).limit(500))
export const complaintStats = (property) => rpc('complaint_stats', { p_property: property || null })
export const complaintAssignees = () => rpc('complaint_assignees')

export const takeComplaint = (id, userId, note = '') => update(id, { assigned_to: userId, note })
export const assignComplaint = (id, to, note = '') => update(id, { assigned_to: to || null, note })
export const setComplaintPriority = (id, priority) => update(id, { priority })
export const moveComplaint = (id, status, note = '', extra = {}) => update(id, { ...extra, status, note })
export const saveComplaintWork = (id, fields) => update(id, fields)
export const commentOnComplaint = (id, note) => update(id, { note })

// ---------------------------------------------------------------- everyone who can see the complaint
export const complaintTimeline = (id) => rpc('complaint_timeline', { p_id: id })

// ---------------------------------------------------------------- resident
export const myComplaints = () => rpc('my_complaints').then((r) => r ?? [])
export const myComplaintPlace = () => rpc('my_complaint_place')
export const confirmFixed = (id, rating, feedback = '') => update(id, { status: 'closed', rating: Number(rating), feedback })
export const reopenComplaint = (id, note) => update(id, { status: 'reopen', note })

// ---------------------------------------------------------------- images
export const MAX_IMAGES = 5
export const MAX_IMAGE_MB = 5
export function checkImages(files, already = 0, max = MAX_IMAGES) {
  if (already + files.length > max) return `Attach at most ${max} images`
  const bad = files.find((f) => !/^image\/(jpeg|png|webp)$/.test(f.type))
  if (bad) return `${bad.name} is not a JPG, PNG or WebP image`
  const big = files.find((f) => f.size > MAX_IMAGE_MB * 1024 * 1024)
  if (big) return `${big.name} is larger than ${MAX_IMAGE_MB} MB`
  return ''
}
// files go into the uploader's own folder; the database only accepts paths in that folder
export async function uploadImages(userId, files) {
  const paths = []
  for (const f of files) paths.push(await uploadFile('complaint-media', userId, f))
  return paths
}

export async function raiseMyComplaint(userId, fields, files) {
  const photos = await uploadImages(userId, files)
  return rpc('raise_complaint', { p: { ...fields, photos } })
}

// ---------------------------------------------------------------- timeline wording
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
export function timelineText(e) {
  const d = e.details ?? {}
  switch (e.action) {
    case 'created': return 'Raised the complaint'
    case 'taken': return 'Took responsibility'
    case 'assigned': return `Assigned to ${e.to_assignee_name ?? 'someone'}`
    case 'reassigned': return `Reassigned from ${e.from_assignee_name ?? 'someone'} to ${e.to_assignee_name ?? 'someone'}`
    case 'unassigned': return `Removed ${e.from_assignee_name ?? 'the assignee'}`
    case 'priority_changed': return `Priority changed from ${d.from} to ${d.to}`
    case 'started': return 'Started work'
    case 'resolved': return 'Marked resolved'
    case 'closed': return 'Closed'
    case 'reopened': return 'Reopened'
    case 'rated': return `Rated ${d.rating}/5`
    case 'comment': return 'Added a note'
    case 'work_updated': {
      const parts = []
      if ('resolution' in d) parts.push('updated resolution notes')
      if (d.photos_added > 0) parts.push(`added ${plural(d.photos_added, 'resolution image')}`)
      if ('cost' in d) parts.push(`set repair cost to ₹${d.cost}`)
      if ('fixed_by' in d || 'vendor_id' in d || 'staff_member_id' in d) parts.push('updated who fixed it')
      if ('due_at' in d) parts.push('changed the due time')
      const s = parts.join(', ') || 'updated work details'
      return s[0].toUpperCase() + s.slice(1)
    }
    default: return 'Updated'
  }
}
