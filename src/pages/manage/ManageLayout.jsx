import { Suspense, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import useAsync from '../../hooks/useAsync'
import NotificationBell from '../../components/NotificationBell'
import { ScopeProvider, useScope } from '../../components/manage/kit'
import { Button, ErrorBox, Spinner, inputCls } from '../../components/ui'
import { loadProperties, loadStartProperty, runJobs } from '../../services/manage'

// Modules of the management console and the roles that see them. The database enforces the same split.
export const MODULES = [
  ['', 'Dashboard', ['admin', 'manager']],
  ['beds', 'Beds', ['admin', 'manager', 'sales']],
  ['tenants', 'Tenants', ['admin', 'manager']],
  ['billing', 'Rent & payments', ['admin', 'manager']],
  ['expenses', 'Expenses', ['admin', 'manager']],
  ['complaints', 'Complaints', ['admin', 'manager']],
  ['enquiries', 'Enquiries', ['admin', 'manager', 'sales']],
  ['sales', 'Marketing & sales', ['admin', 'manager', 'sales']],
  ['staff', 'Employees', ['admin', 'manager']],
  ['reports', 'Reports', ['admin', 'manager']],
  ['properties', 'Properties & rooms', ['admin', 'manager']],
  ['settings', 'Settings & users', ['admin']],
  ['website', 'Website & bookings', ['admin']],
]
const TITLES = { admin: 'Admin dashboard', manager: 'Manager dashboard', sales: 'Sales dashboard' }

function PropertySwitch() {
  const { property, setProperty, properties } = useScope()
  const { role } = useAuth()
  if (properties.length < 2 && role !== 'admin') return null
  return (
    <label className="text-sm">
      <span className="sr-only">Property</span>
      <select className={`${inputCls} !w-auto !py-1.5`} value={property} onChange={(e) => setProperty(e.target.value)}>
        <option value="">All wings · grand total</option>
        {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  )
}

export default function ManageLayout() {
  const { role, profile, user, signOut } = useAuth()
  const props = useAsync(() => Promise.all([loadProperties(), loadStartProperty(user?.id)]), [user?.id])

  // Timed rules (invoices, reminders, late fees, escalations...) also run from the scheduler; opening the console
  // gives them a nudge. The database skips the run if it happened in the last 30 minutes.
  useEffect(() => { if (role === 'admin' || role === 'manager') runJobs().catch(() => {}) }, [role])

  const nav = MODULES.filter(([, , roles]) => roles.includes(role))
  return (
    <ScopeProvider properties={props.data?.[0] ?? []} initial={props.data?.[1] ?? ''}>
      <div className="mx-auto w-full max-w-7xl px-4 py-5 text-navy">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{TITLES[role] ?? 'Dashboard'}</h1>
            <p className="text-sm text-slate-600">{profile?.full_name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PropertySwitch />
            <NotificationBell />
            <Button variant="outline" onClick={signOut}>Log out</Button>
          </div>
        </header>
        <nav aria-label="Modules" className="mt-4 flex gap-1 overflow-x-auto border-b border-navy/10 pb-px">
          {nav.map(([path, text]) => (
            <NavLink key={path} to={path ? `/admin/${path}` : '/admin'} end={!path}
              className={({ isActive }) => `whitespace-nowrap rounded-t-xl px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-navy ${isActive ? 'border-b-2 border-gold text-navy' : 'text-slate-600 hover:text-navy'}`}>
              {text}
            </NavLink>
          ))}
        </nav>
        <div className="py-6">
          {props.error ? <ErrorBox error={props.error} onRetry={props.reload} /> : <Suspense fallback={<Spinner />}><Outlet /></Suspense>}
        </div>
      </div>
    </ScopeProvider>
  )
}
