import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import useAsync from '../../hooks/useAsync'
import { ErrorBox, Spinner } from '../../components/ui'
import { loadMyStaff } from '../../services/manage'
import StaffDashboard from './StaffDashboard'

// /staff picks the right page: managers and caretakers each have their own, everyone else (cook, security...)
// and the owner get the general staff dashboard. Caretakers are employees whose staff profile says 'caretaker'.
export default function StaffHome() {
  const { user, role } = useAuth()
  const mine = useAsync(() => (role === 'employee' ? loadMyStaff(user.id) : Promise.resolve(null)), [user.id, role])

  if (role === 'manager') return <Navigate to="/staff/manager" replace />
  if (mine.loading) return <Spinner />
  if (mine.error) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorBox error={mine.error} onRetry={mine.reload} /></div>
  if (mine.data?.designation === 'caretaker') return <Navigate to="/staff/caretaker" replace />
  return <StaffDashboard />
}
