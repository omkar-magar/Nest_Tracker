import { useAuth } from '../../context/AuthContext'
import { Button } from '../ui'

// Header + tab bar shared by the staff and admin dashboards. embedded: shown inside the management console,
// which already has the heading and log-out button.
export default function Shell({ title, tabs, tab, onTab, children, embedded = false, actions }) {
  const { profile, signOut } = useAuth()
  return (
    <div className={embedded ? 'text-navy' : 'mx-auto w-full max-w-6xl px-4 py-6 text-navy'}>
      {!embedded && <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-slate-600">{profile?.full_name}</p>
        </div>
        <span className="flex items-center gap-2">{actions}<Button variant="outline" onClick={signOut}>Log out</Button></span>
      </div>}
      <div role="tablist" aria-label={title} className={`${embedded ? '' : 'mt-5 '}flex gap-1 overflow-x-auto border-b border-navy/10`}>
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => onTab(key)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-navy ${tab === key ? 'border-gold text-navy' : 'border-transparent text-slate-600 hover:text-navy'}`}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="py-6">{children}</div>
    </div>
  )
}
