import { useRef, useState } from 'react'
import { Button, Card, Field, Notice, inputCls } from '../ui'
import { rupees } from '../../services/format'
import { payMyRegistration, registrationBalance } from '../../services/registration'
import { applyCoupon, removeCoupon } from '../../services/coupons'
import { paymentProvider } from '../../services/payments'

// Payment step of a sent registration. Online is the default; the manager may take it offline instead.
// A coupon code from the office comes off the price before paying.
export default function RegistrationPay({ registration: r, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const running = useRef(false) // blocks a second click before the button re-renders as disabled
  if (r.state !== 'pending' || !r.stay_type || r.approval === 'rejected') return null
  if (r.payment_status === 'paid') return <Notice tone="ok">Payment of {rupees(r.amount_paid)} received. Your manager will approve your stay shortly.</Notice>
  if (r.payment_mode === 'offline') return <Notice>Your manager is taking this payment offline.</Notice>
  const due = r.to_pay ?? registrationBalance(r)
  const simulated = paymentProvider.isSimulated
  const run = async (fn) => {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try { return await fn() } catch (e) { setError(e.message) } finally { running.current = false; setBusy(false) }
  }
  const pay = (outcome) => run(async () => {
    const p = await payMyRegistration(outcome)
    if (p.status === 'succeeded') onChanged()
    else if (p.status === 'created') setError('Payment not completed. If money was taken it will show here in a few minutes.')
    else setError('Payment failed. Nothing was charged. Try again.')
  })
  const apply = (e) => {
    e.preventDefault()
    run(async () => { await applyCoupon(code.trim()); setCode(''); onChanged() })
  }
  return (
    <Card>
      <h2 className="text-lg font-bold">Payment · {rupees(due)}</h2>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between"><dt>Price of the stay you chose</dt><dd>{rupees(r.amount_due)}</dd></div>
        {r.discount > 0 && (
          <div className="flex justify-between text-green-800">
            <dt>Coupon {r.coupon_code}{r.coupon_description ? ` (${r.coupon_description})` : ''}{' '}
              {!r.amount_paid && <button type="button" className="text-xs font-medium text-navy underline focus-visible:outline-2 focus-visible:outline-navy" disabled={busy}
                onClick={() => run(async () => { await removeCoupon(); onChanged() })}>Remove</button>}
            </dt>
            <dd>−{rupees(r.discount)}</dd>
          </div>
        )}
        {r.amount_paid > 0 && <div className="flex justify-between"><dt>Already paid</dt><dd>−{rupees(r.amount_paid)}</dd></div>}
        <div className="flex justify-between border-t border-navy/10 pt-1 font-semibold"><dt>To pay</dt><dd>{rupees(due)}</dd></div>
      </dl>
      {!r.amount_paid && (
        <form onSubmit={apply} className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Coupon code"><input className={`${inputCls} uppercase`} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></Field>
          <Button type="submit" variant="outline" disabled={busy || !code.trim()}>Apply</Button>
        </form>
      )}
      <p className="mt-3 rounded-xl bg-cream p-3 text-sm">Ask your manager if you want to pay offline, or wait if you have already paid offline.</p>
      {simulated && <div className="mt-3"><Notice tone="warn"><strong>Demo payment.</strong> No real money moves. Pick the outcome you want to test.</Notice></div>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {simulated ? (
          <>
            <Button variant="sun" disabled={busy} onClick={() => pay('success')}>{busy ? 'Please wait…' : `Pay ${rupees(due)} (demo success)`}</Button>
            <Button variant="outline" disabled={busy} onClick={() => pay('failure')}>Simulate a failed payment</Button>
          </>
        ) : (
          <Button variant="sun" disabled={busy} onClick={() => pay()}>{busy ? 'Please wait…' : `Pay ${rupees(due)} online`}</Button>
        )}
      </div>
    </Card>
  )
}
