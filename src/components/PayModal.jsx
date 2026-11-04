import { useEffect, useRef, useState } from 'react'
import { Button } from './ui'
import { payBill, paymentProvider } from '../services/payments'
import { rupees } from '../services/format'

// The result message is built from the payment row the database returns, not from the button clicked.
export default function PayModal({ bill, onClose, onFinished }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const ref = useRef(null)

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
      const payment = await payBill(bill, { chooseOutcome: async () => outcome })
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
        <h2 id="pay-title" className="text-lg font-bold">Pay {rupees(bill.amount)}</h2>
        <p className="text-sm text-slate-600">{bill.description}</p>

        {paymentProvider.isSimulated && (
          <p className="mt-4 rounded-xl border border-gold/40 bg-sun/20 p-3 text-sm">
            <strong>Demo payment.</strong> No real money moves. Pick the outcome you want to test.
          </p>
        )}

        {result ? (
          <div role="status" className="mt-4">
            {result.status === 'succeeded'
              ? <p className="font-semibold text-green-800">Payment recorded{result.is_simulated ? ' (simulated)' : ''}. Your bill is now paid.</p>
              : <p className="font-semibold text-red-700">Payment failed{result.failure_reason ? `: ${result.failure_reason}` : ''}. Your bill is still unpaid.</p>}
            <Button className="mt-4 w-full" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <Button className="w-full" variant="primary" disabled={busy} onClick={() => pay('success')}>{busy ? 'Processing…' : 'Simulate successful payment'}</Button>
            <Button className="w-full" variant="danger" disabled={busy} onClick={() => pay('failure')}>Simulate failed payment</Button>
            <Button className="w-full" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          </div>
        )}
      </div>
    </div>
  )
}
