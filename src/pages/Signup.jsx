import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate } from 'react-router-dom'
import { sendOtp, verifyOtp } from '../services/otp'
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
  const [otpModal, setOtpModal] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  if (!configured) {
    return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="warn">Accounts are not available until Supabase is configured. See docs/setup.md.</Notice></div>
  }
  if (user && role && !otpModal) return <Navigate to="/account" replace />

  // Step 1: validate the form and send the OTP; the popup opens to take the code.
  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const bad = validateTenant(form) || (!form.rules_accepted ? 'Accept the rules and regulations to register' : '')
    if (bad) return setError(bad)
    setBusy(true)
    try {
      const { demoCode } = await sendOtp(form.phone)
      setOtpModal({ demoCode })
    } catch (err) {
      setError(err.message || 'Could not send the OTP')
    }
    setBusy(false)
  }

  // Step 2: the code was right, so create the account.
  const createAccount = async () => {
    const { data, error } = await signUp(form.email.trim(), password, form.full_name.trim(), form.phone)
    if (error) return { error: error.message }
    const entry = { ...form, full_name: form.full_name.trim(), email: form.email.trim(), rules_signature: form.rules_signature.trim() || form.full_name.trim() }
    if (data.session) {
      try { await saveMyTenantProfile(entry); clearStash() } catch { stashRegistration(entry) } // the account page offers it again
    } else {
      stashRegistration(entry) // project requires email confirmation
      setNeedsConfirm(true)
    }
    return {}
  }

  const closeModal = () => setOtpModal(null)

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
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending…' : 'Send OTP'}</Button>
        <p className="text-center text-xs text-slate-500">By signing up you accept our <Link className="underline" to="/terms">terms</Link> and <Link className="underline" to="/privacy">privacy policy</Link>.</p>
        <p className="text-center text-sm text-slate-600">Already have an account? <Link className="font-medium underline" to="/login">Log in</Link></p>
      </form>
      {otpModal && <OtpModal phone={form.phone} demoCode={otpModal.demoCode} needsConfirm={needsConfirm} onCreate={createAccount} onClose={closeModal} />}
    </div>
  )
}

// Popup: enter the OTP; when it is right the account is created and the popup says so.
function OtpModal({ phone, demoCode, needsConfirm, onCreate, onClose }) {
  const [code, setCode] = useState('')
  const [state, setState] = useState({ busy: false, error: '', done: false })
  const [shownCode, setShownCode] = useState(demoCode)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !state.done && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, state.done])

  const verify = async (e) => {
    e.preventDefault()
    setState({ busy: true, error: '', done: false })
    if (!(await verifyOtp(phone, code))) return setState({ busy: false, error: 'Incorrect OTP. Please check the code and try again.', done: false })
    const { error } = await onCreate()
    setState(error ? { busy: false, error, done: false } : { busy: false, error: '', done: true })
  }
  const resend = async () => {
    const r = await sendOtp(phone)
    setShownCode(r.demoCode)
    setCode('')
    setState({ busy: false, error: '', done: false })
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/60 p-0 sm:items-center sm:p-4" onClick={state.done ? undefined : onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="otp-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-white p-6 text-navy sm:rounded-3xl">
        {state.done ? (
          <div className="text-center">
            <h2 id="otp-title" className="text-2xl font-bold text-gold-deep">Account has been created</h2>
            <p className="mt-2 text-sm text-slate-700">
              {needsConfirm ? 'Check your email to confirm your account, then log in. Your registration form is kept and will be ready to submit.' : 'Welcome to YOLO Nest Co-Living.'}
            </p>
            <Button to={needsConfirm ? '/login' : '/account'} className="mt-5 w-full">{needsConfirm ? 'Go to log in' : 'Go to my account'}</Button>
          </div>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <div>
              <h2 id="otp-title" className="text-2xl font-bold text-gold-deep">Verify your mobile number</h2>
              <p className="mt-1 text-sm text-slate-700">Enter the 6-digit OTP sent to {phone}.</p>
              {shownCode && <p className="mt-1 text-xs text-slate-600">Demo mode: your OTP is <strong>{shownCode}</strong></p>}
            </div>
            <Field label="OTP">
              <input className={inputCls} inputMode="numeric" autoComplete="one-time-code" required autoFocus pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
            <Button type="submit" className="w-full" disabled={state.busy}>{state.busy ? 'Verifying…' : 'Verify OTP'}</Button>
            <div className="flex justify-between text-sm">
              <button type="button" className="font-medium underline" onClick={resend}>Resend OTP</button>
              <button type="button" className="font-medium underline" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
