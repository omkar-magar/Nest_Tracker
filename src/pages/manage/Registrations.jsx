import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useScope } from '../../components/manage/kit'
import { Badge, Empty, ErrorBox, TableSkeleton, inputCls } from '../../components/ui'
import useAsync from '../../hooks/useAsync'
import { LATE_HOURS, STAGES, STAGE_LABEL, adminRegistrations, handling, registrationLink, timeline, timing } from '../../services/activity'
import { formatDateTime } from '../../services/format'

// Owner view of self-registrations: which stage each one is in, how long it has waited and who has it.
const TONES = { waiting: 'amber', started: 'gray', rejected: 'red', living: 'green', ended: 'gray' }

export default function Registrations() {
  const { property, properties } = useScope()
  const [params] = useSearchParams()
  const openId = params.get('open')
  const q = useAsync(() => adminRegistrations(property), [property])
  const [stage, setStage] = useState('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(openId)
  const wingName = (id) => properties.find((p) => p.id === id)?.name ?? id

  // a link from Recent activity opens that registration, whatever filter was on
  useEffect(() => {
    if (!openId || !q.data) return
    setOpen(openId); setStage('all'); setSearch('')
    requestAnimationFrame(() => document.getElementById(`reg-${openId}`)?.scrollIntoView({ block: 'center' }))
  }, [openId, q.data])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (q.data?.rows ?? []).filter((r) => (stage === 'all' || r.stage === stage)
      && (!term || `${r.name} ${r.phone} ${r.room_no ?? ''}`.toLowerCase().includes(term)))
  }, [q.data, stage, search])

  if (q.loading) return <TableSkeleton />
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />
  const counts = q.data?.counts ?? {}
  const total = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0)
  const now = new Date()
  const late = (q.data?.rows ?? []).filter((r) => timing(r, now).late).length

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Registrations</h2>
          <p className="text-sm text-slate-600">Every self-registration, its stage and who is handling it. Flagged after {LATE_HOURS} hours waiting.</p>
        </div>
        <label className="w-full sm:w-64">
          <span className="sr-only">Search registrations</span>
          <input type="search" className={inputCls} placeholder="Search name, phone, room…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      <div role="group" aria-label="Filter by stage" className="mt-4 flex flex-wrap gap-2">
        {[['all', 'All', total], ...STAGES.map(([k, t]) => [k, t, counts[k] ?? 0])].map(([k, t, n]) => (
          <button key={k} type="button" aria-pressed={stage === k} onClick={() => setStage(k)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-navy ${stage === k ? 'border-navy bg-navy text-white' : 'border-navy/15 bg-white text-navy hover:border-navy/40'}`}>
            {t} <span className="ml-1 font-bold">{n}</span>
          </button>
        ))}
      </div>
      {late > 0 && <p role="status" className="mt-3 text-sm font-medium text-red-700">{late} registration{late > 1 ? 's have' : ' has'} been waiting over {LATE_HOURS} hours.</p>}

      {rows.length === 0 ? <div className="mt-5"><Empty title="No registrations here">Try another stage or clear the search.</Empty></div> : (
        <ul className="mt-5 space-y-3">
          {rows.map((r) => {
            const t = timing(r, now)
            const link = registrationLink(r)
            const expanded = open === r.id
            return (
              <li key={r.id} id={`reg-${r.id}`} className={`scroll-mt-16 rounded-2xl border bg-white p-4 ${expanded && openId === r.id ? 'border-gold' : 'border-navy/10'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{r.name || 'No name'} <span className="text-sm font-normal text-slate-600">{r.phone}</span></p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <Badge tone={TONES[r.stage]}>{STAGE_LABEL[r.stage]}</Badge>
                      <span>{r.property_id ? wingName(r.property_id) : 'No wing picked'}</span>
                      {r.room_no && <span>· Room {r.room_no}</span>}
                      <span>· {r.submitted_at ? `sent ${formatDateTime(r.submitted_at)}` : `signed up ${formatDateTime(r.signed_up_at)}`}</span>
                      {t.text && (t.late ? <Badge tone="red">{t.text}</Badge> : <span>· {t.text}</span>)}
                    </div>
                    <p className="mt-1.5 text-sm"><span className="text-slate-600">Handling:</span> {handling(r)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" aria-expanded={expanded} aria-controls={`reg-tl-${r.id}`} onClick={() => setOpen(expanded ? null : r.id)}
                      className="rounded-full border border-navy/20 px-3 py-1 text-xs font-semibold text-navy hover:border-navy/50 focus-visible:outline-2 focus-visible:outline-navy">
                      {expanded ? 'Hide steps' : 'Steps'}
                    </button>
                    <Link to={link.to} className="rounded-full bg-navy px-3 py-1 text-xs font-semibold text-white hover:bg-navy/90 focus-visible:outline-2 focus-visible:outline-gold">{link.text}</Link>
                  </div>
                </div>
                {expanded && (
                  <ol id={`reg-tl-${r.id}`} aria-label={`Steps for ${r.name}`} className="mt-3 space-y-2 border-l-2 border-navy/10 pl-4">
                    {timeline(r, r.property_id && wingName(r.property_id)).map(([text, at], i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium">{text}</span>
                        {at && <span className="text-slate-600"> · {formatDateTime(at)}</span>}
                      </li>
                    ))}
                    {r.stage === 'waiting' && <li className="text-sm text-slate-600">Next: a manager approves it with a room, rent and dates</li>}
                  </ol>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-4 text-xs text-slate-600">Stages: started → waiting for approval → approved and living → checked out (or rejected). "Seen" means the manager opened their notifications.</p>
    </div>
  )
}
