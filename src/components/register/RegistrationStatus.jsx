import { Button, Card, Notice } from '../ui'
import { formatDate, rupees } from '../../services/format'

export default function RegistrationStatus({ registration, reload, children }) {
  const active = registration.state === 'active'
  return <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 text-navy">
    <h1 className="text-2xl font-bold">Your stay at YOLO Nest</h1>
    <Notice tone={active ? 'ok' : 'warn'}>{active ? 'Your registration is approved. Welcome to YOLO Nest!' : registration.state === 'ended'
      ? 'Thank you for staying with us! Your stay has ended. To extend your stay or return, please get help from your manager.'
      : registration.approval === 'rejected' ? 'Your registration needs attention. Please contact your manager.'
        : 'Waiting for manager’s approval. Your registration has been received. Your manager will confirm your room, rent and due date.'}</Notice>
    {registration.payment?.status === 'succeeded' && <p className="text-sm">Registration payment: {rupees(registration.payment.amount)} paid on {formatDate(registration.payment.paid_at)}{registration.payment.is_simulated ? ' (demo)' : ''}.</p>}
    <Button variant="outline" onClick={reload}>Refresh status</Button>
    <h2 className="text-xl font-bold">{active ? 'Stay details and history' : 'Stay history'}</h2>
    {!(registration.stays ?? []).length && <p className="text-sm text-slate-600">Your stay details will appear after approval.</p>}
    {(registration.stays ?? []).map((s) => <Card key={s.id}>
      <p className="font-semibold">Room {s.room_no} · {s.removed ? 'Removed' : s.checked_out_on ? 'Checked out' : 'Staying'}</p>
      <p className="mt-2 text-sm">Rent: {rupees(s.rent)} · Deposit: {rupees(s.deposit)}</p>
      <p className="text-sm">Rent due date: {formatDate(s.due_date)}</p>
      <p className="text-sm">Check-in: {formatDate(s.check_in)} · Check-out: {formatDate(s.checked_out_on || s.expected_checkout)}</p>
    </Card>)}
    {children}
  </div>
}
