import { Badge } from '../ui'
import { Load } from '../manage/kit'
import useAsync from '../../hooks/useAsync'
import { fileUrl } from '../../services/manage'
import { complaintTimeline, timelineText } from '../../services/complaints'
import { complaintStatus, label } from '../../services/pg'
import { formatDateTime } from '../../services/format'

// Pieces shared by the resident view and the office board.

const STATUS_TONES = { new: 'red', assigned: 'amber', in_progress: 'navy', resolved: 'green', closed: 'gray' }
export const ComplaintStatusBadge = ({ status }) => <Badge tone={STATUS_TONES[status] ?? 'gray'}>{complaintStatus(status)}</Badge>

const PRIORITY_TONES = { urgent: 'red', high: 'red', medium: 'amber', low: 'gray' }
export const PriorityBadge = ({ priority }) => <Badge tone={PRIORITY_TONES[priority] ?? 'gray'}>{label(priority)}</Badge>

// Thumbnails from the private bucket via short-lived signed links
export function ComplaintImages({ paths = [], name = 'Image' }) {
  const urls = useAsync(() => Promise.all(paths.map((p) => fileUrl('complaint-media', p))), [paths.join('|')])
  if (!paths.length) return null
  if (urls.loading) return <p className="text-xs text-slate-500">Loading images…</p>
  if (urls.error) return <p className="text-xs text-red-700">Could not load images</p>
  return (
    <ul className="flex flex-wrap gap-2">
      {urls.data.map((u, i) => (
        <li key={paths[i]}>
          <a href={u} target="_blank" rel="noopener noreferrer" className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy">
            <img src={u} alt={`${name} ${i + 1}`} loading="lazy" className="h-20 w-20 rounded-xl border border-navy/10 object-cover" />
          </a>
        </li>
      ))}
    </ul>
  )
}

export function ComplaintTimeline({ id, version }) {
  return (
    <Load loader={() => complaintTimeline(id)} deps={[id, version]}>
      {(events) => (events.length === 0 ? <p className="text-sm text-slate-500">No activity yet.</p> : (
        <ol className="space-y-2 text-sm">
          {events.map((e) => (
            <li key={e.id} className="border-l-2 border-gold pl-3">
              <p className="text-xs text-slate-500">
                {formatDateTime(e.created_at)} · {e.actor_name}{e.actor_role && e.actor_role !== 'customer' ? ` (${label(e.actor_role)})` : ''}
              </p>
              <p>
                {timelineText(e)}
                {e.from_status && e.to_status && e.from_status !== e.to_status && (
                  <span className="text-slate-600"> · {complaintStatus(e.from_status)} → {complaintStatus(e.to_status)}</span>
                )}
              </p>
              {e.note && <p className="mt-0.5 whitespace-pre-line text-slate-700">“{e.note}”</p>}
              {e.action === 'work_updated' && e.details?.resolution && <p className="mt-0.5 whitespace-pre-line text-slate-700">{e.details.resolution}</p>}
            </li>
          ))}
        </ol>
      ))}
    </Load>
  )
}
