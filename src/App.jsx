import { Suspense, lazy, useEffect } from 'react'
import { Outlet, Route, Routes, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import RequireRole from './components/RequireRole'
import { Button, Spinner } from './components/ui'
import usePwaIdentity from './hooks/usePwaIdentity'
import Home from './pages/Home'
import Rooms from './pages/Rooms'
import Amenities from './pages/Amenities'
import Location from './pages/Location'
import Login from './pages/Login'
import Signup from './pages/Signup'
import { Privacy, Terms } from './pages/Legal'

// Signed-in areas load on demand: a visitor browsing the public site never downloads the dashboards or the payment code.
const Book = lazy(() => import('./pages/Book'))
const Account = lazy(() => import('./pages/Account'))
const StaffDashboard = lazy(() => import('./pages/staff/StaffDashboard'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))

// New page -> top. Link with a #hash -> scroll to that section once it has rendered.
function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0 })
      return undefined
    }
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 50)
    return () => clearTimeout(t)
  }, [pathname, hash])
  return null
}

function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <Navbar />
      <main className="flex flex-1 flex-col"><Suspense fallback={<Spinner />}><Outlet /></Suspense></main>
      <Footer />
    </div>
  )
}

// Staff and admin apps have no public navbar or footer: they open straight into the dashboard.
function AppLayout() {
  return <main className="min-h-screen bg-cream"><Suspense fallback={<Spinner />}><Outlet /></Suspense></main>
}

function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center text-navy">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-slate-600">That page does not exist.</p>
      <Button to="/" variant="sun" className="mt-6">Back home</Button>
    </div>
  )
}

export default function App() {
  usePwaIdentity()
  return (
    <>
      <ScrollManager />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="rooms" element={<Rooms />} />
          <Route path="amenities" element={<Amenities />} />
          <Route path="location" element={<Location />} />
          <Route path="login" element={<Login audience="customer" />} />
          <Route path="signup" element={<Signup />} />
          <Route path="book/:roomId" element={<Book />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="terms" element={<Terms />} />
          <Route path="account" element={<RequireRole roles={['customer']} loginPath="/login"><Account /></RequireRole>} />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route element={<AppLayout />}>
          <Route path="staff/login" element={<Login audience="employee" />} />
          <Route path="staff" element={<RequireRole roles={['employee', 'admin']} loginPath="/staff/login"><StaffDashboard /></RequireRole>} />
          <Route path="admin/login" element={<Login audience="admin" />} />
          <Route path="admin" element={<RequireRole roles={['admin']} loginPath="/admin/login"><AdminDashboard /></RequireRole>} />
        </Route>
      </Routes>
    </>
  )
}
