import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import Icon from '../../components/manage/Icon'
import { useAuth } from '../../context/AuthContext'
import useAsync from '../../hooks/useAsync'
import NotificationBell from '../../components/NotificationBell'
import { ScopeProvider, useScope } from '../../components/manage/kit'
import { Button, ErrorBox, Spinner, inputCls } from '../../components/ui'
import { loadProperties, loadStartProperty, runJobs } from '../../services/manage'

// Modules of the management console and the roles that see them. The database enforces the same split.
export const MODULES = [
  ['', 'Dashboard', ['admin', 'manager']],
  ['activity', 'Recent activity', ['admin']],
  ['registrations', 'Registrations', ['admin']],
  ['beds', 'Beds', ['admin', 'manager', 'sales']],
  ['register', 'Guest register', ['admin', 'manager']],
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

// Header search: opens Tenants filtered by name, phone or room
function TenantSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  return (
    <form role="search" className="relative w-full sm:w-64" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/admin/tenants?q=${encodeURIComponent(q.trim())}`) }}>
      <label htmlFor="tenant-search" className="sr-only">Search tenants, rooms</label>
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input id="tenant-search" type="search" placeholder="Search tenants, rooms…" value={q} onChange={(e) => setQ(e.target.value)}
        className={`${inputCls} !rounded-full !py-1.5 !pl-9`} />
    </form>
  )
}

const initials = (name) => (name ?? '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'

export default function ManageLayout() {
  const { role, profile, user, signOut } = useAuth()
  const props = useAsync(() => Promise.all([loadProperties(), loadStartProperty(user?.id)]), [user?.id])

  // Timed rules (invoices, reminders, late fees, escalations...) also run from the scheduler; opening the console
  // gives them a nudge. The database skips the run if it happened in the last 30 minutes.
  useEffect(() => { if (role === 'admin' || role === 'manager') runJobs().catch(() => {}) }, [role])

  // managers work from the guest register, so it leads their menu
  const nav = MODULES.filter(([, , roles]) => roles.includes(role))
    .sort((x, y) => (role === 'manager' ? (y[0] === 'register') - (x[0] === 'register') : 0))
  return (
    <ScopeProvider properties={props.data?.[0] ?? []} initial={props.data?.[1] ?? ''}>
      <div className="mx-auto w-full max-w-7xl px-4 py-5 text-navy">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-navy text-sm font-bold text-white">{initials(profile?.full_name)}</span>
            <div>
              <h1 className="text-2xl font-bold">{TITLES[role] ?? 'Dashboard'}</h1>
              <p className="text-sm text-slate-600">{profile?.full_name}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PropertySwitch />
            {(role === 'admin' || role === 'manager') && <TenantSearch />}
            {role === 'manager' && <Button to="/staff/manager" variant="outline">My day</Button>}
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
