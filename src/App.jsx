import { Suspense, lazy, useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import QuickContactBar from './components/QuickContactBar'
import FloatingShortcuts from './components/FloatingShortcuts'
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
import { useAuth } from './context/AuthContext'
import useCampaignTracking from './hooks/useCampaignTracking'

// Signed-in areas load on demand: a visitor browsing the public site never downloads the dashboards or the payment code.
const Book = lazy(() => import('./pages/Book'))
const Account = lazy(() => import('./pages/Account'))
const StaffHome = lazy(() => import('./pages/staff/StaffHome'))
const ManagerDashboard = lazy(() => import('./pages/staff/ManagerDashboard'))
const CaretakerDashboard = lazy(() => import('./pages/staff/CaretakerDashboard'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Vacancies = lazy(() => import('./pages/Vacancies'))
const Brochure = lazy(() => import('./pages/Brochure'))
const Unsubscribe = lazy(() => import('./pages/Unsubscribe'))
// PG-management console (owner, managers, sales): one chunk per module
const ManageLayout = lazy(() => import('./pages/manage/ManageLayout'))
const Dashboard = lazy(() => import('./pages/manage/Dashboard'))
const Properties = lazy(() => import('./pages/manage/Properties'))
const Beds = lazy(() => import('./pages/manage/Beds'))
const Tenants = lazy(() => import('./pages/manage/Tenants'))
const Register = lazy(() => import('./pages/manage/Register'))
const TenantDetail = lazy(() => import('./pages/manage/TenantDetail'))
const CheckIn = lazy(() => import('./pages/manage/CheckIn'))
const Billing = lazy(() => import('./pages/manage/Billing'))
const Expenses = lazy(() => import('./pages/manage/Expenses'))
const Complaints = lazy(() => import('./pages/manage/Complaints'))
const Enquiries = lazy(() => import('./pages/manage/Enquiries'))
const EnquiryDetail = lazy(() => import('./pages/manage/EnquiryDetail'))
const Sales = lazy(() => import('./pages/manage/Sales'))
const Staff = lazy(() => import('./pages/manage/Staff'))
const Reports = lazy(() => import('./pages/manage/Reports'))
const Settings = lazy(() => import('./pages/manage/Settings'))

const MANAGE = ['admin', 'manager']
// sales executives start on their leads; owner and managers on the dashboard
function ManageHome() {
  const { role } = useAuth()
  return role === 'sales' ? <Navigate to="/admin/enquiries" replace /> : <Dashboard />
}
const only = (roles, el) => <RequireRole roles={roles} loginPath="/admin/login">{el}</RequireRole>

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
      <QuickContactBar />
      <FloatingShortcuts />
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
  useCampaignTracking()
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
          <Route path="vacancies" element={<Vacancies />} />
          <Route path="unsubscribe" element={<Unsubscribe />} />
          <Route path="forgot-password" element={<ResetPassword mode="request" />} />
          <Route path="reset-password" element={<ResetPassword mode="update" />} />
          <Route path="account" element={<RequireRole roles={['customer']} loginPath="/login"><Account /></RequireRole>} />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route element={<AppLayout />}>
          <Route path="staff/login" element={<Login audience="employee" />} />
          <Route path="staff" element={<RequireRole roles={['employee', 'admin', 'manager']} loginPath="/staff/login"><StaffHome /></RequireRole>} />
          <Route path="staff/manager" element={<RequireRole roles={['manager', 'admin']} loginPath="/staff/login"><ManagerDashboard /></RequireRole>} />
          <Route path="staff/caretaker" element={<RequireRole roles={['employee', 'admin']} loginPath="/staff/login"><CaretakerDashboard /></RequireRole>} />
          <Route path="admin/login" element={<Login audience="admin" />} />
          <Route path="brochure" element={<Brochure />} />
          <Route path="admin" element={<RequireRole roles={['admin', 'manager', 'sales']} loginPath="/admin/login"><ManageLayout /></RequireRole>}>
            <Route index element={<ManageHome />} />
            <Route path="beds" element={<Beds />} />
            <Route path="register" element={only(MANAGE, <Register />)} />
            <Route path="tenants" element={only(MANAGE, <Tenants />)} />
            <Route path="tenants/:id" element={only(MANAGE, <TenantDetail />)} />
            <Route path="checkin" element={only(MANAGE, <CheckIn />)} />
            <Route path="billing" element={only(MANAGE, <Billing />)} />
            <Route path="expenses" element={only(MANAGE, <Expenses />)} />
            <Route path="complaints" element={only(MANAGE, <Complaints />)} />
            <Route path="enquiries" element={<Enquiries />} />
            <Route path="enquiries/:id" element={<EnquiryDetail />} />
            <Route path="sales" element={<Sales />} />
            <Route path="staff" element={only(MANAGE, <Staff />)} />
            <Route path="reports" element={only(MANAGE, <Reports />)} />
            <Route path="properties" element={only(MANAGE, <Properties />)} />
            <Route path="settings" element={only(['admin'], <Settings />)} />
            <Route path="website" element={only(['admin'], <AdminDashboard embedded />)} />
          </Route>
        </Route>
      </Routes>
    </>
  )
}
