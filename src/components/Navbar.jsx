import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const links = [
  ['Rooms', '/rooms'],
  ['Amenities', '/amenities'],
  ['Location', '/location'],
  ['FAQ', '/#faq'],
  ['Contact', '/#contact'],
]

export const homeFor = (role) => ({ customer: '/account', employee: '/staff', admin: '/admin' })[role] ?? '/login'

const navCls = ({ isActive }) => `transition-colors hover:text-navy ${isActive ? 'font-semibold text-navy' : ''}`

export default function Navbar() {
  const { role, user, signOut, configured } = useAuth()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const close = () => setOpen(false)

  const logout = async () => {
    close()
    await signOut()
    navigate('/')
  }

  const authButtons = user ? (
    <>
      <Link onClick={close} to={homeFor(role)} className="rounded-full bg-navy px-5 py-2 text-center font-semibold text-white">Dashboard</Link>
      <button onClick={logout} className="rounded-full border border-navy/30 px-5 py-2 font-medium">Log out</button>
    </>
  ) : (
    configured && <Link onClick={close} to="/login" className="rounded-full bg-navy px-5 py-2 text-center font-semibold text-white transition-colors hover:bg-navy/90">Log in</Link>
  )

  return (
    <header className="sticky top-0 z-40 border-b border-navy/10 bg-cream/90 text-navy backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" onClick={close} className="flex items-center gap-2" aria-label="YOLO nest home">
          <img src="/images/logo.png" alt="" className="h-9 w-auto mix-blend-multiply" />
          <span className="flex flex-col text-left leading-none">
            <span className="text-lg font-extrabold tracking-tight">YOLO</span>
            <span className="-mt-0.5 text-sm font-semibold tracking-[0.2em] text-gold">nest</span>
          </span>
        </Link>
        <nav aria-label="Main" className="hidden gap-7 text-[15px] text-navy/80 md:flex">
          {links.map(([label, to]) => (
            <NavLink key={to} to={to} end className={to.includes('#') ? 'transition-colors hover:text-navy' : navCls}>{label}</NavLink>
          ))}
        </nav>
        <div className="hidden gap-2 text-sm md:flex">{authButtons}</div>
        <button
          className="rounded-lg p-2 md:hidden focus-visible:outline-2 focus-visible:outline-navy"
          aria-label="Menu" aria-expanded={open} aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {open && (
        <div id="mobile-menu" className="border-t border-navy/10 bg-cream px-4 pb-4 md:hidden">
          <nav aria-label="Mobile" className="flex flex-col py-2">
            {links.map(([label, to]) => (
              <Link key={to} to={to} onClick={close} className="py-3 text-navy/80">{label}</Link>
            ))}
          </nav>
          <div className="flex flex-col gap-2 text-sm">{authButtons}</div>
        </div>
      )}
    </header>
  )
}
