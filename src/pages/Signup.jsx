import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, Field, Notice, inputCls } from '../components/ui'
import ResidentForm from '../components/manage/ResidentForm'
import RegistrationPayment from '../components/register/RegistrationPayment'
import { clearStash, stashRegistration, tenantFormValue, validateTenant } from '../components/manage/tenantFields'
import useAsync from '../hooks/useAsync'
import { rupees } from '../services/format'
import {
  DEMO_EMAIL, demoEnabled, demoRegistration, demoSignIn, registrationFee, registrationProperties, submitRegistration, verifyEmailCode,
} from '../services/registration'

const STEPS = [['form', 'Details'], ['pay', 'Payment'], ['verify', 'Verify OTP']]

// Registration = the YOLO Nest Resident Registration Form. Demo and real signups take the same steps:
// 1 form, 2 registration payment, 3 OTP (real: the code Supabase emails; demo: any key), then the manager approves.
export default function Signup() {
  const { configured, user, role, signUp } = useAuth()
  const [form, setForm] = useState({ ...tenantFormValue(), rules_accepted: false, rules_signature: '' })
  const [password, setPassword] = useState('')
  const [step, setStep] = useState('form')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [demo, setDemo] = useState(false)
  const [payment, setPayment] = useState(null)
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const properties = useAsync(() => configured ? registrationProperties() : Promise.resolve([]), [configured])
  const fee = useAsync(() => configured ? registrationFee() : Promise.resolve(0), [configured])
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  if (!configured) {
    return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="warn">Accounts are not available until Supabase is configured. See docs/setup.md.</Notice></div>
  }
  if (user && role && !busy && (saved || (step === 'form' && !demo))) return <Navigate to="/account" replace />

  const entry = () => ({
    ...form, full_name: form.full_name.trim(), email: form.email.trim(),
    rules_signature: form.rules_signature.trim() || form.full_name.trim(), payment_id: payment?.id ?? '',
  })

  // step 1 -> 2 (or straight to 3 when no registration payment is set)
  const next = (e) => {
    e.preventDefault()
    setError('')
    const bad = validateTenant(form) || (!form.rules_accepted ? 'Accept the rules and regulations to register' : '')
    if (bad) return setError(bad)
    if (!form.property_id) return setError('Choose a property')
    if (demo && form.email.trim().toLowerCase() !== DEMO_EMAIL) return setError('Demo mode uses customer@yolonest.test only')
    setStep(fee.data > 0 ? 'pay' : 'verify')
  }

  // real signups: create the login now; Supabase emails the code (or signs straight in when confirmation is off)
  const sendCode = async () => {
    setBusy(true); setError('')
    const { data, error } = await signUp(form.email.trim(), password, form.full_name.trim(), form.phone)
    if (error) { setBusy(false); return setError(error.message) }
    stashRegistration(entry()) // kept in case they use the email link instead of the code
    if (data.session) return finish()
    setCodeSent(true); setBusy(false)
  }

  const finish = async () => {
    try { await submitRegistration(entry()); clearStash() } catch { stashRegistration(entry()) } // the account page offers it again
    setSaved(true); setBusy(false)
  }

  const verify = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      if (demo) await demoSignIn(code)
      else await verifyEmailCode(form.email.trim(), code)
    } catch (x) { setBusy(false); return setError(x.message) }
    await finish()
  }

  const at = STEPS.findIndex(([k]) => k === step)
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 text-navy">
      <h1 className="text-2xl font-bold">Resident registration</h1>
      <p className="mt-1 text-sm text-slate-600">Fill in the YOLO Nest Coliving registration form{fee.data > 0 ? `, pay the registration amount (${rupees(fee.data)})` : ''} and verify your email. Your manager then confirms your room.</p>
      <ol aria-label="Registration steps" className="mt-4 flex flex-wrap gap-2 text-sm">
        {STEPS.filter(([k]) => k !== 'pay' || fee.data > 0).map(([k, label], i) => {
          const idx = STEPS.findIndex(([x]) => x === k)
          return <li key={k} aria-current={idx === at ? 'step' : undefined}
            className={`rounded-full px-3 py-1 ${idx < at ? 'bg-navy/10' : idx === at ? 'bg-navy font-semibold text-white' : 'bg-slate-100 text-slate-600'}`}>{i + 1}. {label}</li>
        })}
      </ol>

      {step === 'form' && (
        <>
          {demoEnabled && <div className="mt-4 space-y-2"><Button variant="outline" onClick={() => {
            setForm({ ...demoRegistration(), property_id: properties.data?.[0]?.id ?? '' })
            setPassword('DemoOnly123!'); setDemo(true); setError('')
          }}>Fill demo registration</Button><p className="text-xs text-slate-600">Demo testing uses customer@yolonest.test. Any non-empty demo OTP is accepted.</p></div>}
          <form onSubmit={next} className="mt-6 space-y-6 rounded-2xl border border-navy/10 bg-white p-5">
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
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <Button type="submit" className="w-full" disabled={fee.loading}>{fee.data > 0 ? 'Continue to payment' : 'Continue to verification'}</Button>
            <p className="text-center text-xs text-slate-500">By signing up you accept our <Link className="underline" to="/terms">terms</Link> and <Link className="underline" to="/privacy">privacy policy</Link>.</p>
            <p className="text-center text-sm text-slate-600">Already have an account? <Link className="font-medium underline" to="/login">Log in</Link></p>
          </form>
        </>
      )}

      {step === 'pay' && (
        <div className="mt-6 space-y-3">
          <RegistrationPayment amount={fee.data} email={form.email.trim()} phone={form.phone} propertyId={form.property_id}
            onPaid={(p) => { setPayment(p); setStep('verify') }} />
          <Button variant="outline" onClick={() => setStep('form')}>Back to the form</Button>
        </div>
      )}

      {step === 'verify' && (
        <form onSubmit={verify} className="mt-6 space-y-4 rounded-2xl border border-navy/10 bg-white p-5">
          {payment && <Notice tone="ok">Registration payment of {rupees(payment.amount)} received{payment.is_simulated ? ' (demo)' : ''}.</Notice>}
          <h2 className="text-lg font-bold">Verify your email</h2>
          {demo ? (
            <>
              <Field label="Demo OTP"><input className={inputCls} required value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" /></Field>
              <p className="text-xs text-slate-600">Enter any key to continue with the demo account.</p>
            </>
          ) : !codeSent ? (
            <>
              <p className="text-sm text-slate-600">We will create your account and email a verification code to <strong>{form.email.trim()}</strong>.</p>
              <Button disabled={busy} onClick={sendCode}>{busy ? 'Sending…' : 'Send verification code'}</Button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600">Enter the code we emailed to <strong>{form.email.trim()}</strong>. You can also click the link in that email and then log in: your form and payment are kept.</p>
              <Field label="Email OTP"><input className={inputCls} required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            </>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {(demo || codeSent) && <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Verifying…' : demo ? 'Verify demo OTP and register' : 'Verify and register'}</Button>}
        </form>
      )}
    </div>
  )
}
