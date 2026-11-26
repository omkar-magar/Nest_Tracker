import { Button, Card, Notice } from '../ui'
import { formatDate, rupees } from '../../services/format'
import { isDaily, stayLabel } from '../../services/registration'

export function statusMessage(r) {
  if (r.state === 'active') return ['ok', 'Your registration is approved. Welcome to YOLO Nest!']
  if (r.state === 'ended') return ['warn', 'Thank you for staying with us! Your stay has ended. To stay with us again, use Register again below.']
  if (r.approval === 'rejected') return ['warn', 'Your registration needs attention. Please contact your manager.']
  if (r.state === 'pending' && r.stay_type && r.payment_mode === 'online' && r.payment_status !== 'paid') return ['warn', 'Waiting for payment. Your registration has been received.']
  if (r.state === 'pending' && r.payment_status === 'paid') return ['warn', 'Payment received. Waiting for manager’s approval.']
  return ['warn', 'Waiting for manager’s approval. Your registration has been received. Your manager will confirm your room, rent and due date.']
}

export default function RegistrationStatus({ registration, reload, children }) {
  const active = registration.state === 'active'
  const [tone, message] = statusMessage(registration)
  return <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 text-navy">
    <h1 className="text-2xl font-bold">Your stay at YOLO Nest</h1>
    <Notice tone={tone}>{message}</Notice>
    {registration.state === 'pending' && registration.stay_type && <ChosenStay r={registration} />}
    {children}
    {registration.payment?.status === 'succeeded' && <p className="text-sm">Registration payment: {rupees(registration.payment.amount)} paid on {formatDate(registration.payment.paid_at)}{registration.payment.is_simulated ? ' (demo)' : ''}.</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={reload}>Refresh status</Button>
      {(registration.state === 'ended' || registration.approval === 'rejected') && <Button variant="outline" to="/signup">Register again</Button>}
    </div>
    <h2 className="text-xl font-bold">{active ? 'Stay details and history' : 'Stay history'}</h2>
    {!(registration.stays ?? []).length && <p className="text-sm text-slate-600">Your stay details will appear after approval.</p>}
    {(registration.stays ?? []).map((s) => <Card key={s.id}>
      <p className="font-semibold">Room {s.room_no} · {s.removed ? 'Removed' : s.checked_out_on ? 'Checked out' : 'Staying'}</p>
      <p className="mt-2 text-sm">Rent: {rupees(s.rent)} · Deposit: {rupees(s.deposit)}</p>
      <p className="text-sm">Rent due date: {formatDate(s.due_date)}</p>
      <p className="text-sm">Check-in: {formatDate(s.check_in)} · Check-out: {formatDate(s.checked_out_on || s.expected_checkout)}</p>
    </Card>)}
  </div>
}

function ChosenStay({ r }) {
  return (
    <Card>
      <h2 className="font-semibold">Your registration</h2>
      <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        <div><dt className="inline text-slate-600">Stay: </dt><dd className="inline">{stayLabel(r.stay_type)}</dd></div>
        <div><dt className="inline text-slate-600">Room: </dt><dd className="inline">{r.room_no}</dd></div>
        <div><dt className="inline text-slate-600">Move-in: </dt><dd className="inline">{formatDate(r.move_in_date)}</dd></div>
        {isDaily(r.stay_type)
          ? <div><dt className="inline text-slate-600">Check-out: </dt><dd className="inline">{formatDate(r.checkout_date)}</dd></div>
          : <div><dt className="inline text-slate-600">Rent due: </dt><dd className="inline">{r.due_day} of every month{r.first_due ? ` (first on ${formatDate(r.first_due)})` : ''}</dd></div>}
        <div><dt className="inline text-slate-600">Amount: </dt><dd className="inline">{rupees(r.amount_due)}</dd></div>
      </dl>
    </Card>
  )
}
