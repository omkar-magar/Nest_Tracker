import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import useAsync from '../../hooks/useAsync'
import Shell from '../../components/dashboard/Shell'
import RoomsBoard from '../../components/dashboard/RoomsBoard'
import DuesTable from '../../components/dashboard/DuesTable'
import NotificationBell from '../../components/NotificationBell'
import GuestRegister from '../../components/register/GuestRegister'
import { ErrorBox, Spinner } from '../../components/ui'
import { loadMyPermissions, staffOverview } from '../../services/api'
import { MyComplaints, MyLeave, MyPayslips, Notices, Today } from './StaffSelf'

// The caretaker's day: check in, today's checklist, complaints assigned to them, beds. Customer details and bed
// controls only show when the owner has switched them on for this login (employee_permissions).
function Customers() {
  const { data, error, loading, reload } = useAsync(staffOverview, [])
  if (loading) return <Spinner label="Loading customers" />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return <DuesTable rows={data} />
}

export default function CaretakerDashboard() {
  const { user } = useAuth()
  const [tab, setTab] = useState('today')
  const perms = useAsync(() => loadMyPermissions(user.id), [user.id])

  if (perms.loading) return <Spinner />
  if (perms.error) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorBox error={perms.error} onRetry={perms.reload} /></div>

  const p = perms.data ?? {}
  const tabs = [['today', 'Today', 'Work', 'home'], ['complaints', 'My complaints', 'Work', 'wrench'], ['rooms', 'Rooms and beds', 'Work', 'bed'],
    ...(p.can_view_customers ? [['register', 'Guest register', 'Work', 'list'], ['customers', 'Customers and dues', 'Work', 'rupee']] : []),
    ['leave', 'Leave', 'Me', 'calendar'], ['payslips', 'Payslips', 'Me', 'receipt'], ['notices', 'Notices', 'Me', 'bell']]

  return (
    <Shell title="Caretaker" tabs={tabs} tab={tab} onTab={setTab} actions={<NotificationBell />}>
      {tab === 'today' && <Today />}
      {tab === 'complaints' && <MyComplaints />}
      {tab === 'rooms' && <RoomsBoard canManage={Boolean(p.can_manage_beds)} />}
      {tab === 'register' && <GuestRegister />}
      {tab === 'customers' && <Customers />}
      {tab === 'leave' && <MyLeave />}
      {tab === 'payslips' && <MyPayslips />}
      {tab === 'notices' && <Notices />}
    </Shell>
  )
}
