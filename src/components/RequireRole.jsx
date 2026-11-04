import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeFor } from './Navbar'
import { Button, Notice, Spinner } from './ui'

// Screen-level guard: sends visitors to the right login page. This is a convenience, not security.
// The data behind these screens is protected by Row Level Security and role checks in the database.
export default function RequireRole({ roles, loginPath, children }) {
  const { configured, loading, user, role, signOut } = useAuth()
  const { pathname } = useLocation()

  if (!configured) {
    return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="warn">This area needs Supabase to be configured. See docs/setup.md.</Notice></div>
  }
  if (loading) return <Spinner />
  if (!user) return <Navigate to={`${loginPath}?next=${encodeURIComponent(pathname)}`} replace />
  if (!role) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-navy">
        <Notice tone="warn">This account is not active. Contact the PG office.</Notice>
        <Button className="mt-4" onClick={signOut}>Log out</Button>
      </div>
    )
  }
  if (!roles.includes(role)) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-navy">
        <Notice tone="warn">Your account ({role}) cannot open this area.</Notice>
        <div className="mt-4 flex gap-2">
          <Button to={homeFor(role)}>Go to my dashboard</Button>
          <Button variant="outline" onClick={signOut}>Log out</Button>
        </div>
      </div>
    )
  }
  return children
}
