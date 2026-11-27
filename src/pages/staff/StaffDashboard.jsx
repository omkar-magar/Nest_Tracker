import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import useAsync from '../../hooks/useAsync'
import Shell from '../../components/dashboard/Shell'
import RoomsBoard from '../../components/dashboard/RoomsBoard'
import DuesTable from '../../components/dashboard/DuesTable'
import NotificationBell from '../../components/NotificationBell'
import { ErrorBox, Notice, Spinner } from '../../components/ui'
import { loadMyPermissions, staffOverview } from '../../services/api'
import { MyComplaints, MyLeave, MyPayslips, Notices, Today } from './StaffSelf'

function Customers() {
  const { data, error, loading, reload } = useAsync(staffOverview, [])
  if (loading) return <Spinner label="Loading customers" />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return <DuesTable rows={data} />
}

export default function StaffDashboard() {
  const { user, role } = useAuth()
  const [tab, setTab] = useState('rooms')
  const perms = useAsync(() => loadMyPermissions(user.id), [user.id])

  if (perms.loading) return <Spinner />
  if (perms.error) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorBox error={perms.error} onRetry={perms.reload} /></div>

  const full = role === 'admin' || role === 'manager'
  const p = full ? { can_view_customers: true, can_manage_beds: true } : perms.data ?? {}
  const tabs = [['today', 'Today', 'Work', 'home'], ['rooms', 'Rooms and beds', 'Work', 'bed'], ...(p.can_view_customers ? [['customers', 'Customers and dues', 'Work', 'rupee']] : []),
    ['complaints', 'My complaints', 'Work', 'wrench'], ['leave', 'Leave', 'Me', 'calendar'], ['payslips', 'Payslips', 'Me', 'receipt'], ['notices', 'Notices', 'Me', 'bell']]

  return (
    <Shell title="Staff dashboard" tabs={tabs} tab={tab} onTab={setTab} actions={<NotificationBell />}>
      {tab === 'today' && <Today />}
      {tab === 'rooms' && <RoomsBoard canManage={Boolean(p.can_manage_beds)} />}
      {tab === 'customers' && <Customers />}
      {tab === 'complaints' && <MyComplaints />}
      {tab === 'leave' && <MyLeave />}
      {tab === 'payslips' && <MyPayslips />}
      {tab === 'notices' && <Notices />}
      {tab === 'rooms' && !p.can_view_customers && <div className="mt-6"><Notice>Customer details are switched off for your account. Ask the owner if you need them.</Notice></div>}
    </Shell>
  )
}
