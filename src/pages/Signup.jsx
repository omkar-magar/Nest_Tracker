import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, Field, Notice, inputCls } from '../components/ui'
import ResidentForm from '../components/manage/ResidentForm'
import StayChoice, { todayIST } from '../components/register/StayChoice'
import { tenantFormValue, validateTenant } from '../components/manage/tenantFields'
import useAsync from '../hooks/useAsync'
import {
  DEMO_EMAIL, demoEnabled, demoRegistration, demoSignIn, dueDayFor, isDaily, myRegistration, registrationProperties, submitRegistration, verifyEmailCode,
} from '../services/registration'

const STEPS = [['account', 'Verify (OTP)'], ['form', 'Registration form'], ['pay', 'Payment']]
const blankStay = () => ({ property_id: '', stay_type: 'pg', room_no: '', move_in_date: todayIST(), checkout_date: '', due_day: '' })

// Registration: 1 verify the email with an OTP (this creates the login; demo: any code opens the demo account),
// 2 fill the Resident Registration Form and choose the stay, 3 pay on the account page (or the manager records an
// offline payment), then the manager approves.
export default function Signup() {
  const { configured, user, role, profile, signUp } = useAuth()
  const [form, setForm] = useState({ ...tenantFormValue(), ...blankStay(), rules_accepted: false, rules_signature: '' })
  const [password, setPassword] = useState('')
  const [step, setStep] = useState(user ? 'form' : 'account')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [demo, setDemo] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const properties = useAsync(() => configured ? registrationProperties() : Promise.resolve([]), [configured])
  const existing = useAsync(() => (user && role === 'customer' ? myRegistration() : Promise.resolve(null)), [user?.id, role])
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // signed in already (email link, or back later): go to the form with their name and number
  useEffect(() => {
    if (!user) return
    setStep((s) => (s === 'account' ? 'form' : s))
    if (profile) setForm((f) => ({ ...f, full_name: f.full_name || profile.full_name || '', phone: f.phone || profile.phone || '', email: f.email || user.email || '' }))
  }, [user, profile])

  // the demo form starts on the first property, even if the list arrives after the OTP
  useEffect(() => {
    if (demo && step === 'form' && properties.data?.length) setForm((f) => (f.property_id ? f : { ...f, property_id: properties.data[0].id }))
  }, [demo, step, properties.data])

  if (!configured) {
    return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="warn">Accounts are not available until Supabase is configured. See docs/setup.md.</Notice></div>
  }
  if (sent) return <Navigate to="/account" replace />
  if (user && role && role !== 'customer') return <Navigate to="/account" replace />
  if (existing.data?.state === 'active') return <Navigate to="/account" replace />

  // step 1, real signups: create the login; Supabase emails the code (or signs straight in when confirmation is off)
  const sendCode = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    const { data, error } = await signUp(form.email.trim(), password, form.full_name.trim(), form.phone)
    setBusy(false)
    if (error) return setError(error.message)
    if (data?.session) return setStep('form')
    setCodeSent(true)
  }

  const verify = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      if (demo) {
        await demoSignIn(code)
        setForm((f) => ({ ...f, ...demoRegistration(), ...blankStay(), property_id: properties.data?.[0]?.id ?? '' }))
      } else await verifyEmailCode(form.email.trim(), code)
      setStep('form')
    } catch (x) { setError(x.message) } finally { setBusy(false) }
  }

  // step 2: the registration form with the stay choice
  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const bad = validateTenant(form) || (!form.rules_accepted ? 'Accept the rules and regulations to register' : '')
      || (!form.property_id ? 'Choose a property' : '') || (!form.room_no ? 'Choose a room' : '')
      || (isDaily(form.stay_type) && !(form.checkout_date > form.move_in_date) ? 'Choose a check-out date after the move-in date' : '')
      || (!isDaily(form.stay_type) && !dueDayFor(form.move_in_date, form.due_day) ? 'Choose a rent due day from 1 to 10' : '')
    if (bad) return setError(bad)
    setBusy(true)
    try {
      await submitRegistration({
        ...form, full_name: form.full_name.trim(), email: form.email.trim(),
        rules_signature: form.rules_signature.trim() || form.full_name.trim(),
        due_day: isDaily(form.stay_type) ? null : dueDayFor(form.move_in_date, form.due_day),
        checkout_date: isDaily(form.stay_type) ? form.checkout_date : null,
      })
      setSent(true)
    } catch (x) { setError(x.message) } finally { setBusy(false) }
  }

  const at = STEPS.findIndex(([k]) => k === step)
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 text-navy">
      <h1 className="text-2xl font-bold">Resident registration</h1>
      <p className="mt-1 text-sm text-slate-600">Verify your email, fill in the YOLO Nest Coliving registration form and choose your room, then pay. Your manager confirms your stay.</p>
      <ol aria-label="Registration steps" className="mt-4 flex flex-wrap gap-2 text-sm">
        {STEPS.map(([k, label], i) => (
          <li key={k} aria-current={i === at ? 'step' : undefined}
            className={`rounded-full px-3 py-1 ${i < at ? 'bg-navy/10' : i === at ? 'bg-navy font-semibold text-white' : 'bg-slate-100 text-slate-600'}`}>{i + 1}. {label}</li>
        ))}
      </ol>

      {step === 'account' && (
        <form onSubmit={codeSent || demo ? verify : sendCode} className="mt-6 space-y-4 rounded-2xl border border-navy/10 bg-white p-5">
          <h2 className="text-lg font-bold">Verify your email</h2>
          {demoEnabled && !demo && !codeSent && (
            <div className="space-y-1">
              <Button variant="outline" onClick={() => { setDemo(true); setError(''); setForm({ ...form, email: DEMO_EMAIL }) }}>Use the demo account</Button>
              <p className="text-xs text-slate-600">Demo testing uses {DEMO_EMAIL}. Any demo OTP is accepted.</p>
            </div>
          )}
          {demo ? (
            <>
              <Field label="Demo OTP"><input className={inputCls} required value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" /></Field>
              <p className="text-xs text-slate-600">Enter any key to continue with the demo account.</p>
            </>
          ) : !codeSent ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name"><input className={inputCls} required autoComplete="name" value={form.full_name} onChange={set('full_name')} /></Field>
              <Field label="Mobile number"><input className={inputCls} required inputMode="tel" autoComplete="tel" pattern="[0-9+ \-]{10,15}" value={form.phone} onChange={set('phone')} /></Field>
              <Field label="Email"><input className={inputCls} type="email" required autoComplete="email" value={form.email} onChange={set('email')} /></Field>
              <Field label="Password (8+ characters)"><input className={inputCls} type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-600">Enter the code we emailed to <strong>{form.email.trim()}</strong>. You can also click the link in that email and then log in.</p>
              <Field label="Email OTP"><input className={inputCls} required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            </>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Please wait…' : demo ? 'Verify demo OTP' : codeSent ? 'Verify and continue' : 'Send verification code'}
          </Button>
          <p className="text-center text-xs text-slate-500">By signing up you accept our <Link className="underline" to="/terms">terms</Link> and <Link className="underline" to="/privacy">privacy policy</Link>.</p>
          <p className="text-center text-sm text-slate-600">Already have an account? <Link className="font-medium underline" to="/login">Log in</Link></p>
        </form>
      )}

      {step === 'form' && (
        <form onSubmit={submit} className="mt-6 space-y-6 rounded-2xl border border-navy/10 bg-white p-5">
          {existing.data?.state === 'pending' && <Notice>You already sent a registration. Sending this form again replaces it.</Notice>}
          <Field label="Property"><select className={inputCls} required value={form.property_id ?? ''} onChange={(e) => setForm({ ...form, property_id: e.target.value, room_no: '' })}>
            <option value="">Choose a property</option>
            {(properties.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></Field>
          {properties.error && <Notice tone="warn">Could not load properties. Reload to try again.</Notice>}
          <ResidentForm value={form} onChange={setForm} skip={['email']}
            slots={{ '4. Stay details': <StayChoice value={form} onChange={setForm} /> }} />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending…' : 'Send registration and continue to payment'}</Button>
        </form>
      )}
    </div>
  )
}
