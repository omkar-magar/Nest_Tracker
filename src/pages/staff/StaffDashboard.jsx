import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import useAsync from '../../hooks/useAsync'
import Shell from '../../components/dashboard/Shell'
import RoomsBoard from '../../components/dashboard/RoomsBoard'
import DuesTable from '../../components/dashboard/DuesTable'
import { ErrorBox, Notice, Spinner } from '../../components/ui'
import { loadMyPermissions, staffOverview } from '../../services/api'

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

  const p = role === 'admin' ? { can_view_customers: true, can_manage_beds: true } : perms.data ?? {}
  const tabs = [['rooms', 'Rooms and beds'], ...(p.can_view_customers ? [['customers', 'Customers and dues']] : [])]

  return (
    <Shell title="Staff dashboard" tabs={tabs} tab={tab} onTab={setTab}>
      {tab === 'rooms' && <RoomsBoard canManage={Boolean(p.can_manage_beds)} />}
      {tab === 'customers' && <Customers />}
      {!p.can_view_customers && <div className="mt-6"><Notice>Customer details are switched off for your account. Ask the owner if you need them.</Notice></div>}
    </Shell>
  )
}
