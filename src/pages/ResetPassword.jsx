import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'
import { Button, Field, Notice, inputCls } from '../components/ui'

// PRD 2.1 password reset. "request" emails a link; the link signs the user in on /reset-password ("update").
export default function ResetPassword({ mode }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [state, setState] = useState({ busy: false, done: false, error: '' })
  if (!isConfigured) return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="warn">Accounts are not available until Supabase is configured.</Notice></div>

  const submit = async (e) => {
    e.preventDefault()
    setState({ busy: true, done: false, error: '' })
    const { error } = mode === 'request'
      ? await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` })
      : await supabase.auth.updateUser({ password: pw })
    setState({ busy: false, done: !error, error: error?.message ?? '' })
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 text-navy">
      <h1 className="text-2xl font-bold">{mode === 'request' ? 'Forgot password' : 'Choose a new password'}</h1>
      {state.done ? (
        <div className="mt-6"><Notice tone="ok">{mode === 'request' ? 'If that email has an account, a reset link is on its way. Open it on this device.' : <>Password changed. <Link className="underline" to="/login">Log in</Link></>}</Notice></div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-navy/10 bg-white p-5">
          {mode === 'request'
            ? <Field label="Email"><input className={inputCls} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            : <Field label="New password (8+ characters)"><input className={inputCls} type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>}
          {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
          <Button type="submit" className="w-full" disabled={state.busy}>{state.busy ? 'Please wait…' : mode === 'request' ? 'Send reset link' : 'Save password'}</Button>
        </form>
      )}
    </div>
  )
}
