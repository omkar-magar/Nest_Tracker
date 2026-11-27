import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import Icon from '../manage/Icon'
import { useAuth } from '../../context/AuthContext'

// Frame for the signed-in apps (console, manager, staff): a left sidebar from lg up, and on phones a Menu button
// that slides the same sidebar in as a drawer. nav(close) renders the menu; close() shuts the drawer after a pick.
// actions sit top right (bell); tools get their own row on phones (search, wing picker).
const ROLE_TEXT = { admin: 'Owner', manager: 'Manager', sales: 'Sales', employee: 'Staff' }
const initials = (name) => (name ?? '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'

export default function AppFrame({ title, nav, actions, tools, children }) {
  const { profile, role, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  useEffect(() => {
    if (!open) return undefined
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])

  return (
    <div className="min-h-screen text-navy lg:flex">
      {open && <div className="fixed inset-0 z-40 bg-navy/40 lg:hidden" aria-hidden="true" onClick={close} />}
      <aside id="app-menu" aria-label="Menu"
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-navy/10 bg-white transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 ${open ? 'translate-x-0 shadow-xl' : '-translate-x-full max-lg:invisible'}`}>
        <div className="flex items-center justify-between gap-2 border-b border-navy/10 px-4 py-3">
          <span className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-navy text-sm font-bold text-white">{initials(profile?.full_name)}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{profile?.full_name}</span>
              <span className="block text-xs text-slate-600">{ROLE_TEXT[role] ?? 'Signed in'}</span>
            </span>
          </span>
          <button onClick={close} aria-label="Close menu" className="rounded-full p-1.5 text-slate-600 hover:bg-navy/5 focus-visible:outline-2 focus-visible:outline-navy lg:hidden">
            <Icon name="close" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">{nav(close)}</div>
        <div className="border-t border-navy/10 p-3">
          <button onClick={signOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-navy/5 focus-visible:outline-2 focus-visible:outline-navy">
            <Icon name="logout" className="h-5 w-5" />Log out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-navy/10 bg-cream">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 lg:px-8">
            <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} aria-controls="app-menu"
              className="-ml-1 rounded-full p-2 hover:bg-navy/5 focus-visible:outline-2 focus-visible:outline-navy lg:hidden">
              <Icon name="menu" />
            </button>
            <h1 className="min-w-0 truncate text-lg font-bold sm:text-xl">{title}</h1>
            {/* tools drop to a full-width second row on phones */}
            {tools && <div className="order-last flex w-full items-center gap-2 empty:hidden md:order-none md:ml-auto md:w-auto">{tools}</div>}
            <div className={`ml-auto flex shrink-0 items-center gap-2 ${tools ? 'md:ml-0' : ''}`}>{actions}</div>
          </div>
        </header>
        {/* the app layout already wraps this in <main> */}
        <div className="px-4 py-5 lg:px-8">{children}</div>
      </div>
    </div>
  )
}

const itemCls = (active) => `flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-navy ${active ? 'bg-navy text-white' : 'text-navy hover:bg-navy/5'}`

// A titled group of menu entries
export function NavGroup({ title, children, tablist }) {
  return (
    <div className="mt-4">
      {title && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>}
      {tablist
        ? <div role="tablist" aria-label={title} aria-orientation="vertical" className="space-y-0.5">{children}</div>
        : <ul className="space-y-0.5">{children}</ul>}
    </div>
  )
}

// A menu entry that is a page link (console modules)
export function NavItem({ to, end, icon, children, onClick }) {
  return (
    <li>
      <NavLink to={to} end={end} onClick={onClick} className={({ isActive }) => itemCls(isActive)}>
        {icon && <Icon name={icon} className="h-5 w-5 shrink-0" />}{children}
      </NavLink>
    </li>
  )
}

// A menu entry that switches a tab on the same page (staff and manager pages)
export function TabItem({ selected, icon, children, onClick }) {
  return (
    <button role="tab" aria-selected={selected} onClick={onClick} className={itemCls(selected)}>
      {icon && <Icon name={icon} className="h-5 w-5 shrink-0" />}{children}
    </button>
  )
}
