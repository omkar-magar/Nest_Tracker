import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, Field, Notice, inputCls } from '../components/ui'
import ResidentForm from '../components/manage/ResidentForm'
import { clearStash, stashRegistration, tenantFormValue, validateTenant } from '../components/manage/tenantFields'
import { saveMyTenantProfile } from '../services/manage'

// Registration = the YOLO Nest Resident Registration Form: login details first, then the form's sections.
export default function Signup() {
  const { configured, user, role, signUp } = useAuth()
  const [form, setForm] = useState({ ...tenantFormValue(), rules_accepted: false, rules_signature: '' })
  const [password, setPassword] = useState('')
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
    setError('')
    const bad = validateTenant(form) || (!form.rules_accepted ? 'Accept the rules and regulations to register' : '')
    if (bad) return setError(bad)
    setBusy(true)
    const { data, error } = await signUp(form.email.trim(), password, form.full_name.trim(), form.phone)
    if (error) { setBusy(false); return setError(error.message) }
    const entry = { ...form, full_name: form.full_name.trim(), email: form.email.trim(), rules_signature: form.rules_signature.trim() || form.full_name.trim() }
    if (data.session) {
      try { await saveMyTenantProfile(entry); clearStash() } catch { stashRegistration(entry) } // the account page offers it again
    } else {
      stashRegistration(entry) // project requires email confirmation
      setNeedsConfirm(true)
    }
    setBusy(false)
  }

  if (needsConfirm) {
    return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="ok">Check your email to confirm your account, then <Link className="font-medium underline" to="/login">log in</Link>. Your registration form is kept and will be ready to submit.</Notice></div>
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 text-navy">
      <h1 className="text-2xl font-bold">Resident registration</h1>
      <p className="mt-1 text-sm text-slate-600">Fill in the YOLO Nest Coliving registration form to create your account.</p>
      <form onSubmit={submit} className="mt-6 space-y-6 rounded-2xl border border-navy/10 bg-white p-5">
        <section aria-label="Login details">
          <h3 className="mb-3 rounded-lg bg-navy px-3 py-1.5 text-sm font-semibold uppercase tracking-wide text-white">Login details</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name"><input className={inputCls} required autoComplete="name" value={form.full_name} onChange={set('full_name')} /></Field>
            <Field label="Mobile number"><input className={inputCls} required inputMode="tel" autoComplete="tel" pattern="[0-9+ \-]{10,15}" value={form.phone} onChange={set('phone')} /></Field>
            <Field label="Email"><input className={inputCls} type="email" required autoComplete="email" value={form.email} onChange={set('email')} /></Field>
            <Field label="Password (8+ characters)"><input className={inputCls} type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          </div>
        </section>
        <ResidentForm value={form} onChange={setForm} skip={['full_name', 'phone', 'email']} />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</Button>
        <p className="text-center text-xs text-slate-500">By signing up you accept our <Link className="underline" to="/terms">terms</Link> and <Link className="underline" to="/privacy">privacy policy</Link>.</p>
        <p className="text-center text-sm text-slate-600">Already have an account? <Link className="font-medium underline" to="/login">Log in</Link></p>
      </form>
    </div>
  )
}
