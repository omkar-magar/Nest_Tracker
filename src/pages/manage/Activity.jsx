import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/manage/Icon'
import { useScope } from '../../components/manage/kit'
import { ErrorBox, TableSkeleton } from '../../components/ui'
import useAsync from '../../hooks/useAsync'
import { GROUPS, adminRecentActivity, describe } from '../../services/activity'
import { ago } from '../../services/dashboard'

// Owner's recent activity, one card per area; every row opens the screen where that work is done.
const PERIODS = [[1, 'Today'], [7, '7 days'], [30, '30 days']]

export default function Activity() {
  const { property, properties } = useScope()
  const [days, setDays] = useState(7)
  const q = useAsync(() => adminRecentActivity(property, days), [property, days])
  const wing = (id) => properties.find((p) => p.id === id)?.name ?? id
  const data = q.data ?? {}
  const needAction = GROUPS.reduce((s, [k]) => s + Number(data[k]?.open ?? 0), 0)

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Recent activity</h2>
          <p className="text-sm text-slate-600">What happened across the PG, by area. Click any row to open it.</p>
        </div>
        <div role="group" aria-label="Period" className="flex gap-1 rounded-full border border-navy/15 bg-white p-1">
          {PERIODS.map(([d, t]) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
              className={`rounded-full px-3 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-navy ${days === d ? 'bg-navy text-white' : 'text-navy hover:bg-navy/5'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {q.loading ? <div className="mt-5"><TableSkeleton /></div> : q.error ? <div className="mt-5"><ErrorBox error={q.error} onRetry={q.reload} /></div> : (
        <>
          {needAction > 0 && <p role="status" className="mt-3 text-sm font-medium text-red-700">{needAction} item{needAction > 1 ? 's' : ''} still need action.</p>}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {GROUPS.map(([key, title, icon, to]) => {
              const g = data[key] ?? { count: 0, open: 0, items: [] }
              return (
                <section key={key} aria-labelledby={`act-${key}`} className="rounded-2xl border border-navy/10 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 id={`act-${key}`} className="flex items-center gap-2 font-semibold">
                      <Icon name={icon} className="h-5 w-5 text-chart-1" />{title}
                      <span className="text-sm font-normal text-slate-600">{g.count}</span>
                      {g.open > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">{g.open} to act on</span>}
                    </h3>
                    {to && (
                      <Link to={to} className="flex items-center gap-1 rounded-full bg-chart-1/10 px-3 py-1 text-xs font-semibold text-navy hover:bg-chart-1/20 focus-visible:outline-2 focus-visible:outline-navy">
                        Open<Icon name="arrow" className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                  {g.items.length === 0 ? <p className="py-2 text-sm text-slate-600">Nothing in this period.</p> : (
                    <ul className="divide-y divide-navy/5">
                      {g.items.map((item, i) => {
                        const d = describe(key, item)
                        const body = (
                          <>
                            <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.open ? 'bg-red-600' : 'bg-navy/20'}`} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium">{d.text}{item.open && <span className="sr-only"> (needs action)</span>}</span>
                              <span className="block text-xs text-slate-600">
                                {[d.sub, item.property_id && wing(item.property_id), ago(item.at)].filter(Boolean).join(' · ')}
                              </span>
                            </span>
                          </>
                        )
                        return (
                          <li key={`${item.kind}-${item.ref}-${i}`}>
                            {d.to ? (
                              <Link to={d.to} className="-mx-2 flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-navy/5 focus-visible:outline-2 focus-visible:outline-navy">{body}</Link>
                            ) : <div className="flex items-start gap-3 py-2">{body}</div>}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {g.count > g.items.length && <p className="mt-1 text-xs text-slate-600">Showing the latest {g.items.length} of {g.count}.</p>}
                </section>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
