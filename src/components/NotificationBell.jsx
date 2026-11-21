import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import useAsync from '../hooks/useAsync'
import { loadMyNotifications, markNotificationsRead } from '../services/manage'
import { disablePush, enablePush, pushState, pushSupported } from '../services/push'
import { formatDateTime } from '../services/format'

// In-app inbox (notifications with channel 'in_app') plus the switch for phone push alerts.
export default function NotificationBell() {
  const { user } = useAuth()
  const { data, reload } = useAsync(() => loadMyNotifications(user.id).catch(() => []), [user.id])
  const [open, setOpen] = useState(false)
  const [push, setPush] = useState('unsupported')
  const [err, setErr] = useState('')
  const ref = useRef(null)
  const list = data ?? []
  const unread = list.filter((n) => n.status !== 'read')

  useEffect(() => { if (pushSupported()) pushState().then(setPush).catch(() => {}) }, [])
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && unread.length) { await markNotificationsRead(unread.map((n) => n.id)).catch(() => {}); reload() }
  }
  const switchPush = async () => {
    setErr('')
    try {
      if (push === 'on') await disablePush(); else await enablePush(user.id)
      setPush(await pushState())
    } catch (e) { setErr(e.message) }
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} aria-expanded={open} aria-label={`Notifications${unread.length ? `, ${unread.length} new` : ''}`}
        className="relative rounded-full border border-navy/20 px-3 py-1.5 text-sm font-semibold text-navy hover:bg-navy/5 focus-visible:outline-2 focus-visible:outline-navy">
        <span aria-hidden="true">🔔</span>
        {unread.length > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unread.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-navy/10 bg-white p-3 text-sm text-navy shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-semibold">Notifications</p>
            {push !== 'unsupported' && (
              <button onClick={switchPush} className="text-xs font-medium underline" disabled={push === 'denied'}>
                {push === 'on' ? 'Turn off phone alerts' : push === 'denied' ? 'Alerts blocked in browser' : 'Turn on phone alerts'}
              </button>
            )}
          </div>
          {err && <p role="alert" className="mb-2 text-xs text-red-700">{err}</p>}
          {list.length === 0 ? <p className="py-4 text-center text-slate-500">Nothing yet.</p> : (
            <ul className="max-h-80 divide-y divide-navy/5 overflow-y-auto">
              {list.map((n) => (
                <li key={n.id} className="py-2">
                  {n.link?.startsWith('/') ? <Link to={n.link} onClick={() => setOpen(false)} className="font-medium hover:underline">{n.subject || 'Update'}</Link>
                    : <p className="font-medium">{n.subject || 'Update'}</p>}
                  <p className="whitespace-pre-line text-xs text-slate-600">{n.body}</p>
                  <p className="text-[11px] text-slate-400">{formatDateTime(n.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
