import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../components/Navbar'
import { Button, Card, Field, Notice, Spinner, inputCls } from '../components/ui'
import { supabase } from '../lib/supabase'
import useAsync from '../hooks/useAsync'

// Roles allowed in each area. Admin may use the staff area too; the database still decides what they can read.
const AUDIENCE = {
  customer: { title: 'Log in', roles: ['customer'], after: '/account' },
  employee: { title: 'Staff log in', roles: ['employee', 'admin', 'manager'], after: '/staff' },
  admin: { title: 'Admin log in', roles: ['admin', 'manager', 'sales'], after: '/admin' },
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
  // managers land on the guest register in the console
  const after = audience === 'admin' && role === 'manager' ? '/admin/register' : cfg.after
  const [otp, setOtp] = useState(false)
  // ?property=P1 shows that property's name and address: a branded login link per property (PRD 2.1)
  const propertyId = params.get('property')
  const branded = useAsync(() => (propertyId && configured
    ? supabase.from('properties').select('name, address').eq('id', propertyId).maybeSingle().then((r) => r.data)
    : Promise.resolve(null)), [propertyId, configured])

  // Already signed in with the right role (for example the PWA reopening): go straight in.
  useEffect(() => {
    if (user && allowed) navigate(next && next.startsWith('/') ? next : after, { replace: true })
  }, [user, allowed, next, after, navigate])

  if (!configured) {
    return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="warn">Accounts are not available until Supabase is configured. See docs/setup.md.</Notice></div>
  }
  if (loading) return <Spinner />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const id = email.trim()
    // guests may type their email instead of a phone number; Supabase Auth signs in by email anyway
    const byEmail = audience === 'customer' && id.includes('@')
    const { data: lookedUp, error: lookupError } = byEmail ? { data: id } : await supabase.rpc('login_email', { p_identifier: id, p_staff: audience !== 'customer' })
    const authEmail = lookedUp
    if (lookupError || !authEmail) {
      setBusy(false)
      return setError('Invalid login credentials')
    }
    const { error } = await signIn(authEmail, password)
    setBusy(false)
    if (error) setError(error.message)
  }

  const wrongRole = user && role && !allowed
  if (user && role && allowed) return <Navigate to={after} replace />

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 text-navy">
      <h1 className="text-2xl font-bold">{cfg.title}</h1>
      {branded.data && <p className="mt-1 text-sm text-slate-600">{branded.data.name} · {branded.data.address}</p>}
      {wrongRole ? (
        <Card className="mt-6">
          <p className="text-sm">You are signed in as a <strong>{role}</strong>, which cannot open this area.</p>
          <div className="mt-4 flex gap-2">
            <Button to={homeFor(role)}>Go to my dashboard</Button>
            <Button variant="outline" onClick={signOut}>Log out</Button>
          </div>
        </Card>
      ) : otp ? <OtpLogin onBack={() => setOtp(false)} /> : (
        <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-navy/10 bg-white p-5">
          <Field label={audience === 'customer' ? 'Phone number or email' : 'Username'}>
            {audience === 'customer'
              ? <input className={inputCls} autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              : <input className={inputCls} autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Password">
            <input className={inputCls} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</Button>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <button type="button" className="font-medium underline" onClick={() => setOtp(true)}>Use mobile number (OTP) instead</button>
            <Link className="font-medium underline" to="/forgot-password">Forgot password?</Link>
          </div>
          {audience === 'customer' && (
            <p className="text-center text-sm text-slate-600">New here? <Link className="font-medium underline" to="/signup">Create an account</Link></p>
          )}
        </form>
      )}
    </div>
  )
}

const e164 = (phone) => {
  const d = phone.replace(/\D/g, '')
  return `+${d.length === 10 ? `91${d}` : d}`
}

// PRD 2.1 login with mobile number + one-time code. Needs an SMS provider switched on in Supabase Auth (Phone).
function OtpLogin({ onBack }) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [state, setState] = useState({ busy: false, error: '' })
  const send = async (e) => {
    e.preventDefault()
    setState({ busy: true, error: '' })
    const { error } = sent
      ? await supabase.auth.verifyOtp({ phone: e164(phone), token: code.trim(), type: 'sms' })
      : await supabase.auth.signInWithOtp({ phone: e164(phone), options: { shouldCreateUser: false } })
    setState({ busy: false, error: error?.message ?? '' })
    if (!error && !sent) setSent(true)
  }
  return (
    <form onSubmit={send} className="mt-6 space-y-4 rounded-2xl border border-navy/10 bg-white p-5">
      <Field label="Mobile number">
        <input className={inputCls} inputMode="tel" autoComplete="tel" required disabled={sent} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      {sent && (
        <Field label="6-digit code sent by SMS">
          <input className={inputCls} inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
      )}
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={state.busy}>{state.busy ? 'Please wait…' : sent ? 'Verify and log in' : 'Send code'}</Button>
      <button type="button" className="text-sm font-medium underline" onClick={onBack}>Use password instead</button>
    </form>
  )
}
