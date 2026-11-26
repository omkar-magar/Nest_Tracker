import { useState } from 'react'
import { Button, Card, Notice } from '../ui'
import { rupees } from '../../services/format'
import { payMyRegistration, registrationBalance } from '../../services/registration'

// Payment step of a sent registration. Online is the default; the manager may take it offline instead.
export default function RegistrationPay({ registration: r, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (r.state !== 'pending' || !r.stay_type || r.approval === 'rejected') return null
  if (r.payment_status === 'paid') return <Notice tone="ok">Payment of {rupees(r.amount_paid)} received. Your manager will approve your stay shortly.</Notice>
  if (r.payment_mode === 'offline') return <Notice>Your manager is taking this payment offline.</Notice>
  const due = registrationBalance(r)
  const pay = async (outcome) => {
    setBusy(true); setError('')
    try {
      const p = await payMyRegistration(outcome)
      if (p.status === 'succeeded') onChanged()
      else setError('Payment failed. Nothing was charged. Try again.')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <Card>
      <h2 className="text-lg font-bold">Payment · {rupees(due)}</h2>
      <p className="mt-1 text-sm text-slate-600">This is the price of the stay you chose{r.amount_paid > 0 ? ` (${rupees(r.amount_paid)} already paid)` : ''}.</p>
      <p className="mt-2 rounded-xl bg-cream p-3 text-sm">Ask your manager if you want to pay offline, or wait if you have already paid offline.</p>
      <div className="mt-3"><Notice tone="warn"><strong>Demo payment.</strong> No real money moves. Pick the outcome you want to test.</Notice></div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="sun" disabled={busy} onClick={() => pay('success')}>{busy ? 'Paying…' : `Pay ${rupees(due)} (demo success)`}</Button>
        <Button variant="outline" disabled={busy} onClick={() => pay('failure')}>Simulate a failed payment</Button>
      </div>
    </Card>
  )
}
