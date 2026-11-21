import { useEffect, useRef, useState } from 'react'
import { Button, inputCls } from './ui'
import { payBill, paymentProvider } from '../services/payments'
import { rupees } from '../services/format'

// The result message is built from the payment row the database returns, not from the button clicked.
export default function PayModal({ bill, onClose, onFinished }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const ref = useRef(null)
  const owed = bill.amount - (bill.amount_paid || 0)
  const [amount, setAmount] = useState(String(owed))
  // less than what is owed = a part payment; the backend refuses more than what is owed
  const part = Number(amount) >= 1 && Number(amount) < owed ? Math.floor(Number(amount)) : undefined
  const bad = !(Number(amount) >= 1 && Number(amount) <= owed)

  useEffect(() => {
    ref.current?.focus()
    const esc = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [busy, onClose])

  const pay = async (outcome) => {
    setBusy(true)
    setError('')
    try {
      const ui = { chooseOutcome: async () => outcome }
      const payment = await (part ? payBill(bill, ui, part) : payBill(bill, ui))
      setResult(payment)
      onFinished()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/50 p-4 sm:items-center" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="pay-title" ref={ref} tabIndex={-1} className="w-full max-w-md rounded-2xl bg-white p-6 text-navy outline-none">
        <h2 id="pay-title" className="text-lg font-bold">Pay {rupees(owed)}</h2>
        <p className="text-sm text-slate-600">{bill.description}</p>

        {paymentProvider.isSimulated && (
          <p className="mt-4 rounded-xl border border-gold/40 bg-sun/20 p-3 text-sm">
            <strong>Demo payment.</strong> No real money moves. Pick the outcome you want to test.
          </p>
        )}

        {result ? (
          <div role="status" className="mt-4">
            {result.status === 'succeeded' ? (
              <p className="font-semibold text-green-800">Payment recorded{result.is_simulated ? ' (simulated)' : ''}. {part ? 'The rest of this bill is still due.' : 'Your bill is now paid.'}</p>
            ) : result.status === 'created' ? (
              <p className="font-semibold text-slate-700">No payment received yet. If money was deducted, your bill will update within a few minutes.</p>
            ) : (
              <p className="font-semibold text-red-700">Payment failed{result.failure_reason ? `: ${result.failure_reason}` : ''}. Your bill is still unpaid.</p>
            )}
            <Button className="mt-4 w-full" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <label className="block text-sm font-medium">Amount to pay now (you can pay part of it)
              <input type="number" min="1" max={owed} className={`${inputCls} mt-1`} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {paymentProvider.isSimulated ? (
              <>
                <Button className="w-full" variant="primary" disabled={busy || bad} onClick={() => pay('success')}>{busy ? 'Processing…' : 'Simulate successful payment'}</Button>
                <Button className="w-full" variant="danger" disabled={busy} onClick={() => pay('failure')}>Simulate failed payment</Button>
              </>
            ) : (
              <Button className="w-full" variant="primary" disabled={busy || bad} onClick={() => pay()}>{busy ? 'Processing…' : `Pay ${rupees(part ?? owed)}`}</Button>
            )}
            <Button className="w-full" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          </div>
        )}
      </div>
    </div>
  )
}
