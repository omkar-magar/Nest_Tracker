import { useAuth } from '../../context/AuthContext'
import { Button } from '../ui'

// Header + tab bar shared by the staff and admin dashboards.
export default function Shell({ title, tabs, tab, onTab, children }) {
  const { profile, signOut } = useAuth()
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 text-navy">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-slate-600">{profile?.full_name}</p>
        </div>
        <Button variant="outline" onClick={signOut}>Log out</Button>
      </div>
      <div role="tablist" aria-label={title} className="mt-5 flex gap-1 overflow-x-auto border-b border-navy/10">
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
