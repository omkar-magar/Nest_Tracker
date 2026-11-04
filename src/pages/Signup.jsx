import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, Field, Notice, inputCls } from '../components/ui'

export default function Signup() {
  const { configured, user, role, signUp } = useAuth()
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  if (!configured) {
    return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="warn">Accounts are not available until Supabase is configured. See docs/setup.md.</Notice></div>
  }
  if (user && role) return <Navigate to="/account" replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { data, error } = await signUp(form.email.trim(), form.password, form.name.trim(), form.phone)
    setBusy(false)
    if (error) return setError(error.message)
    if (!data.session) setNeedsConfirm(true) // project requires email confirmation
  }

  if (needsConfirm) {
    return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="ok">Check your email to confirm your account, then <Link className="font-medium underline" to="/login">log in</Link>.</Notice></div>
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 text-navy">
      <h1 className="text-2xl font-bold">Create your account</h1>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-navy/10 bg-white p-5">
        <Field label="Full name"><input className={inputCls} required autoComplete="name" value={form.name} onChange={set('name')} /></Field>
        <Field label="Mobile number"><input className={inputCls} required inputMode="tel" autoComplete="tel" pattern="[0-9+ \-]{10,15}" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input className={inputCls} type="email" required autoComplete="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Password (8+ characters)"><input className={inputCls} type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} /></Field>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</Button>
        <p className="text-center text-xs text-slate-500">By signing up you accept our <Link className="underline" to="/terms">terms</Link> and <Link className="underline" to="/privacy">privacy policy</Link>.</p>
        <p className="text-center text-sm text-slate-600">Already have an account? <Link className="font-medium underline" to="/login">Log in</Link></p>
      </form>
    </div>
  )
}
