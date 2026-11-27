import { Suspense, useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import Icon from '../../components/manage/Icon'
import { useAuth } from '../../context/AuthContext'
import useAsync from '../../hooks/useAsync'
import NotificationBell from '../../components/NotificationBell'
import AppFrame, { NavGroup, NavItem } from '../../components/dashboard/AppFrame'
import { ScopeProvider, useScope } from '../../components/manage/kit'
import { ErrorBox, Spinner, inputCls } from '../../components/ui'
import { loadProperties, loadStartProperty, runJobs } from '../../services/manage'

// Modules of the management console, the roles that see them, and their menu group and icon.
// The database enforces the same role split.
export const MODULES = [
  ['', 'Dashboard', ['admin', 'manager'], 'Overview', 'home'],
  ['activity', 'Recent activity', ['admin'], 'Overview', 'pulse'],
  ['reports', 'Reports', ['admin', 'manager'], 'Overview', 'chart'],
  ['register', 'Guest register', ['admin', 'manager'], 'Guests', 'list'],
  ['registrations', 'Registrations', ['admin'], 'Guests', 'userPlus'],
  ['tenants', 'Tenants', ['admin', 'manager'], 'Guests', 'users'],
  ['beds', 'Beds', ['admin', 'manager', 'sales'], 'Guests', 'bed'],
  ['complaints', 'Complaints', ['admin', 'manager'], 'Guests', 'wrench'],
  ['billing', 'Rent & payments', ['admin', 'manager'], 'Money', 'rupee'],
  ['expenses', 'Expenses', ['admin', 'manager'], 'Money', 'receipt'],
  ['enquiries', 'Enquiries', ['admin', 'manager', 'sales'], 'Sales', 'chat'],
  ['sales', 'Marketing & sales', ['admin', 'manager', 'sales'], 'Sales', 'megaphone'],
  ['properties', 'Properties & rooms', ['admin', 'manager'], 'Property', 'building'],
  ['inventory', 'Inventory', ['admin', 'manager'], 'Property', 'box'],
  ['staff', 'Employees', ['admin', 'manager'], 'Property', 'user'],
  ['settings', 'Settings & users', ['admin'], 'Admin', 'sliders'],
  ['website', 'Website & bookings', ['admin'], 'Admin', 'globe'],
]
const GROUPS = ['Overview', 'Guests', 'Money', 'Sales', 'Property', 'Admin']
const TITLES = { admin: 'Admin dashboard', manager: 'Manager dashboard', sales: 'Sales dashboard' }

function PropertySwitch() {
  const { property, setProperty, properties } = useScope()
  const { role } = useAuth()
  if (properties.length < 2 && role !== 'admin') return null
  return (
    <label className="text-sm">
      <span className="sr-only">Property</span>
      <select className={`${inputCls} !w-auto max-w-[9.5rem] !py-1.5 md:max-w-none`} value={property} onChange={(e) => setProperty(e.target.value)}>
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
    <form role="search" className="relative min-w-0 flex-1 md:w-60 md:flex-none" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/admin/tenants?q=${encodeURIComponent(q.trim())}`) }}>
      <label htmlFor="tenant-search" className="sr-only">Search tenants, rooms</label>
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input id="tenant-search" type="search" placeholder="Search tenants, rooms…" value={q} onChange={(e) => setQ(e.target.value)}
        className={`${inputCls} !rounded-full !py-1.5 !pl-9`} />
    </form>
  )
}

export default function ManageLayout() {
  const { role, user } = useAuth()
  const props = useAsync(() => Promise.all([loadProperties(), loadStartProperty(user?.id)]), [user?.id])

  // Timed rules (invoices, reminders, late fees, escalations...) also run from the scheduler; opening the console
  // gives them a nudge. The database skips the run if it happened in the last 30 minutes.
  useEffect(() => { if (role === 'admin' || role === 'manager') runJobs().catch(() => {}) }, [role])

  const mine = MODULES.filter(([, , roles]) => roles.includes(role))
  // managers work from the guest register, so the Guests group leads their menu
  const groups = role === 'manager' ? ['Guests', ...GROUPS.filter((g) => g !== 'Guests')] : GROUPS
  const nav = (close) => (
    <nav aria-label="Modules">
      {groups.map((g) => {
        const items = mine.filter((m) => m[3] === g)
        if (!items.length) return null
        return (
          <NavGroup key={g} title={g}>
            {items.map(([path, text, , , icon]) => (
              <NavItem key={path} to={path ? `/admin/${path}` : '/admin'} end={!path} icon={icon} onClick={close}>{text}</NavItem>
            ))}
          </NavGroup>
        )
      })}
      {role === 'manager' && (
        <NavGroup title="Me">
          <NavItem to="/staff/manager" icon="calendar" onClick={close}>My day</NavItem>
        </NavGroup>
      )}
    </nav>
  )
  const manages = role === 'admin' || role === 'manager'
  return (
    <ScopeProvider properties={props.data?.[0] ?? []} initial={props.data?.[1] ?? ''}>
      <AppFrame title={TITLES[role] ?? 'Dashboard'} nav={nav} actions={<NotificationBell />}
        tools={<><PropertySwitch />{manages && <TenantSearch />}</>}>
        {props.error ? <ErrorBox error={props.error} onRetry={props.reload} /> : <Suspense fallback={<Spinner />}><Outlet /></Suspense>}
      </AppFrame>
    </ScopeProvider>
  )
}
