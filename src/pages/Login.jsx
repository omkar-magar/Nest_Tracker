import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../components/Navbar'
import { Button, Card, Field, Notice, Spinner, inputCls } from '../components/ui'

// Roles allowed in each area. Admin may use the staff area too; the database still decides what they can read.
const AUDIENCE = {
  customer: { title: 'Log in', roles: ['customer'], after: '/account' },
  employee: { title: 'Staff log in', roles: ['employee', 'admin'], after: '/staff' },
  admin: { title: 'Admin log in', roles: ['admin'], after: '/admin' },
}

export default function Login({ audience = 'customer' }) {
  const cfg = AUDIENCE[audience]
  const { configured, loading, user, role, signIn, signOut } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const next = params.get('next')
  const allowed = cfg.roles.includes(role)

  // Already signed in with the right role (for example the PWA reopening): go straight in.
  useEffect(() => {
    if (user && allowed) navigate(next && next.startsWith('/') ? next : cfg.after, { replace: true })
  }, [user, allowed, next, cfg.after, navigate])

  if (!configured) {
    return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="warn">Accounts are not available until Supabase is configured. See docs/setup.md.</Notice></div>
  }
  if (loading) return <Spinner />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) setError(error.message)
  }

  const wrongRole = user && role && !allowed
  if (user && role && allowed) return <Navigate to={cfg.after} replace />

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 text-navy">
      <h1 className="text-2xl font-bold">{cfg.title}</h1>
      {wrongRole ? (
        <Card className="mt-6">
          <p className="text-sm">You are signed in as a <strong>{role}</strong>, which cannot open this area.</p>
          <div className="mt-4 flex gap-2">
            <Button to={homeFor(role)}>Go to my dashboard</Button>
            <Button variant="outline" onClick={signOut}>Log out</Button>
          </div>
        </Card>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-navy/10 bg-white p-5">
          <Field label="Email">
            <input className={inputCls} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className={inputCls} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</Button>
          {audience === 'customer' && (
            <p className="text-center text-sm text-slate-600">New here? <Link className="font-medium underline" to="/signup">Create an account</Link></p>
          )}
        </form>
      )}
    </div>
  )
}
