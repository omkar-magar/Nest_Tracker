import { useState } from 'react'
import { Button, Notice } from '../ui'
import { rupees } from '../../services/format'
import { payRegistration } from '../../services/registration'

// Registration payment step (before the OTP). Demo only: the payer picks the outcome, the database records it,
// and the message comes from the row the database returns.
export default function RegistrationPayment({ amount, email, phone, propertyId, onPaid }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pay = async (outcome) => {
    setBusy(true); setError('')
    try {
      const r = await payRegistration({ email, phone, propertyId }, outcome)
      if (r.status === 'succeeded') onPaid(r)
      else setError('Payment failed. Nothing was charged. Try again.')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <section aria-labelledby="reg-pay" className="space-y-3 rounded-2xl border border-navy/10 bg-white p-5">
      <h2 id="reg-pay" className="text-lg font-bold">Registration payment · {rupees(amount)}</h2>
      <p className="text-sm text-slate-600">Pay the registration amount to continue. After payment you verify your email with a code, and then your manager approves your room.</p>
      <Notice tone="warn"><strong>Demo payment.</strong> No real money moves. Pick the outcome you want to test.</Notice>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="sun" disabled={busy} onClick={() => pay('success')}>{busy ? 'Paying…' : `Pay ${rupees(amount)} (demo success)`}</Button>
        <Button variant="outline" disabled={busy} onClick={() => pay('failure')}>Simulate a failed payment</Button>
      </div>
    </section>
  )
}
