import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, Field, Notice, inputCls } from '../components/ui'
import ResidentForm from '../components/manage/ResidentForm'
import { clearStash, stashRegistration, tenantFormValue, validateTenant } from '../components/manage/tenantFields'
import useAsync from '../hooks/useAsync'
import { DEMO_EMAIL, demoEnabled, demoRegistration, demoSignIn, registrationProperties, submitRegistration } from '../services/registration'

// Registration = the YOLO Nest Resident Registration Form: login details first, then the form's sections.
export default function Signup() {
  const { configured, user, role, signUp } = useAuth()
  const [form, setForm] = useState({ ...tenantFormValue(), rules_accepted: false, rules_signature: '' })
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [demo, setDemo] = useState(false)
  const [demoStep, setDemoStep] = useState(false)
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const properties = useAsync(() => configured ? registrationProperties() : Promise.resolve([]), [configured])
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  if (!configured) {
    return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="warn">Accounts are not available until Supabase is configured. See docs/setup.md.</Notice></div>
  }
  if (user && role && !busy && (!demo || saved)) return <Navigate to="/account" replace />

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const bad = validateTenant(form) || (!form.rules_accepted ? 'Accept the rules and regulations to register' : '')
    if (bad) return setError(bad)
    if (!form.property_id) return setError('Choose a property')
    if (demo && form.email.trim().toLowerCase() !== DEMO_EMAIL) return setError('Demo mode uses customer@yolonest.test only')
    if (demo && !demoStep) { setDemoStep(true); return }
    setBusy(true)
    if (demo) {
      try {
        await demoSignIn(code)
        await submitRegistration(form)
        clearStash()
        setSaved(true)
      } catch (e) { stashRegistration(form); setError(e.message) }
      setBusy(false)
      return
    }
    const { data, error } = await signUp(form.email.trim(), password, form.full_name.trim(), form.phone)
    if (error) { setBusy(false); return setError(error.message) }
    const entry = { ...form, full_name: form.full_name.trim(), email: form.email.trim(), rules_signature: form.rules_signature.trim() || form.full_name.trim() }
    if (data.session) {
      try { await submitRegistration(entry); clearStash() } catch { stashRegistration(entry) } // the account page offers it again
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
      {demoEnabled && <div className="mt-4 space-y-2"><Button variant="outline" onClick={() => {
        setForm({ ...demoRegistration(), property_id: properties.data?.[0]?.id ?? '' })
        setPassword('DemoOnly123!'); setDemo(true); setDemoStep(false); setError('')
      }}>Fill demo registration</Button><p className="text-xs text-slate-600">Demo testing uses customer@yolonest.test. Any non-empty demo OTP is accepted.</p></div>}
      <form onSubmit={submit} className="mt-6 space-y-6 rounded-2xl border border-navy/10 bg-white p-5">
        <Field label="Property"><select className={inputCls} required value={form.property_id ?? ''} onChange={set('property_id')}>
          <option value="">Choose a property</option>
          {(properties.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></Field>
        {properties.error && <Notice tone="warn">Could not load properties. Reload to try again.</Notice>}
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
        {demoStep && <div><Field label="Demo OTP"><input className={inputCls} required value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></Field><p className="text-xs text-slate-600">Enter any key to continue with the demo account.</p></div>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Creating…' : demoStep ? 'Verify demo OTP and register' : 'Create account'}</Button>
        <p className="text-center text-xs text-slate-500">By signing up you accept our <Link className="underline" to="/terms">terms</Link> and <Link className="underline" to="/privacy">privacy policy</Link>.</p>
        <p className="text-center text-sm text-slate-600">Already have an account? <Link className="font-medium underline" to="/login">Log in</Link></p>
      </form>
    </div>
  )
}
