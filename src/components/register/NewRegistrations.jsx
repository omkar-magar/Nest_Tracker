import { useEffect, useState } from 'react'
import useAsync from '../../hooks/useAsync'
import { approveRegistration, firstDue, isDaily, newRegistrations, registrationStayError, stayLabel, stayQuote } from '../../services/registration'
import { loadRegisterRooms } from '../../services/register'
import ExtensionRequests from './ExtensionRequests'
import { ActionMsg, FormFields, Modal, useAction } from '../manage/kit'
import { Badge, Button, Empty, ErrorBox, Spinner } from '../ui'
import { TENANT_SECTIONS } from '../manage/tenantFields'
import { ymd } from '../../services/pg'
import { formatDate, rupees } from '../../services/format'

export default function NewRegistrations({ pid, onApproved }) {
  const q = useAsync(() => newRegistrations(pid), [pid])
  const [selected, setSelected] = useState(null)
  if (q.loading) return <Spinner />
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />
  return <div className="space-y-3">
    <ExtensionRequests pid={pid} />
    <Button variant="outline" onClick={q.reload}>Refresh registrations</Button>
    {!q.data?.length && <Empty title="No new registrations" />}
    {(q.data ?? []).map((r) => <div key={r.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-navy/10 p-4">
      <div><p className="font-semibold">{r.profiles?.full_name}</p><p className="text-sm text-slate-600">{r.email} · {r.profiles?.phone}</p><StayLine r={r} /><PaidLine pay={r.registration_payment} /></div>
      <Button onClick={() => setSelected(r)}>Review and approve</Button>
    </div>)}
    {selected && <Approval registration={selected} onClose={() => setSelected(null)} onDone={() => { setSelected(null); q.reload(); onApproved() }} />}
  </div>
}

export const PAYMENT_STATE = { waiting: ['Waiting for payment', 'amber'], paid: ['Paid', 'green'], partially_paid: ['Partly paid', 'amber'], pending: ['Payment pending', 'red'] }

function StayLine({ r }) {
  if (!r.stay_type) return null
  const [label, tone] = PAYMENT_STATE[r.payment_status] ?? PAYMENT_STATE.waiting
  return <>
    <p className="text-sm">{stayLabel(r.stay_type)} · room {r.room_no} · from {formatDate(r.move_in_date)}{isDaily(r.stay_type) ? ` to ${formatDate(r.checkout_date)}` : ` · due day ${r.due_day}`} · {rupees(r.amount_due)}
      {r.discount > 0 && ` · coupon ${r.coupon_code} −${rupees(r.discount)}`}{r.amount_paid > 0 && ` · paid ${rupees(r.amount_paid)}`}</p>
    <p className="mt-1"><Badge tone={tone}>{label}</Badge> <span className="text-xs text-slate-600">{r.payment_mode === 'offline' ? 'Offline' : 'Online'}</span></p>
  </>
}

// payment made with the earlier registration-fee flow, if any
const PaidLine = ({ pay }) => (pay
  ? <p className="text-sm text-green-800">Registration payment {rupees(pay.amount)} paid{pay.is_simulated ? ' (demo)' : ''}{pay.completed_at ? ` on ${formatDate(pay.completed_at)}` : ''}</p>
  : null)

function Approval({ registration: r, onClose, onDone }) {
  const rooms = useAsync(() => loadRegisterRooms(r.property_id), [r.property_id])
  const daily = isDaily(r.stay_type)
  const [v, setV] = useState({ room_no: r.room_no || '', rent: '', deposit: '', due_date: daily ? (r.move_in_date || '') : (firstDue(r.move_in_date, r.due_day) || ''),
    check_in: r.move_in_date || ymd(), expected_checkout: r.checkout_date || '', room_type: r.stay_type?.startsWith('flat') ? 'rented' : 'pg', notes: '',
    payment_mode: r.payment_mode || 'online', payment_status: 'paid', amount_paid: String(Math.max((r.amount_due ?? 0) - (r.discount ?? 0), 0)) })
  // rent and deposit start from the prices of the stay the guest chose
  const quote = useAsync(() => (r.stay_type ? stayQuote(r.stay_type, r.move_in_date, r.checkout_date) : Promise.resolve(null)), [r.user_id])
  useEffect(() => {
    if (quote.data) setV((x) => (x.rent === '' && x.deposit === '' ? { ...x, rent: String(quote.data.rent), deposit: String(quote.data.deposit) } : x))
  }, [quote.data])
  const a = useAction()
  const dateError = registrationStayError(v)
  const offline = v.payment_mode === 'offline'
  const waitingOnline = Boolean(r.stay_type) && !offline && r.payment_status !== 'paid'
  const submit = async (e) => {
    e.preventDefault()
    const p = { ...v, amount_paid: offline && v.payment_status !== 'pending' ? v.amount_paid : '' }
    if (await a.run(() => approveRegistration(r.user_id, p))) onDone()
  }
  return <Modal title={`Approve ${r.profiles?.full_name || 'registration'}`} onClose={onClose} wide>
    <div className="mb-3"><StayLine r={r} /><PaidLine pay={r.registration_payment} /></div>
    <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
      {TENANT_SECTIONS.flatMap((s) => s.fields).filter((f) => !['full_name', 'phone'].includes(f.key)).map((f) => <div key={f.key}><dt className="text-slate-600">{f.label}</dt><dd className="break-words">{typeof r[f.key] === 'boolean' ? (r[f.key] ? 'Yes' : 'No') : r[f.key] || '—'}</dd></div>)}
      <div><dt>Rules accepted</dt><dd>{r.rules_signature || '—'}</dd></div>
    </dl>
    {rooms.error ? <ErrorBox error={rooms.error} onRetry={rooms.reload} /> : <form onSubmit={submit} className="space-y-4">
      <FormFields value={v} onChange={setV} fields={[
        { key: 'room_no', label: 'Room', type: 'select', required: true, options: [['', 'Choose a room'], ...(rooms.data ?? []).map((x) => x.room_no)] },
        { key: 'rent', label: daily ? 'Stay charge for all nights (₹)' : 'Monthly rent (₹)', type: 'number', required: true, min: 0 },
        { key: 'deposit', label: 'Deposit (₹)', type: 'number', required: true, min: 0 },
        { key: 'due_date', label: daily ? 'Pay by' : 'First rent due date', type: 'date', required: true },
        { key: 'check_in', label: 'Check-in', type: 'date', required: true },
        { key: 'expected_checkout', label: 'Expected check-out', type: 'date', min: v.check_in || undefined },
        { key: 'room_type', label: 'Room type', type: 'select', required: true, options: [['pg', 'PG'], ['rented', 'Rented']] },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ]} />
      {r.stay_type && (
        <fieldset className="rounded-2xl border border-navy/10 p-4">
          <legend className="px-1 text-sm font-semibold">Payment</legend>
          <FormFields value={v} onChange={setV} fields={[
            { key: 'payment_mode', label: 'Payment', type: 'select', required: true, options: [['online', 'Online (guest pays on their page)'], ['offline', 'Offline (cash, UPI to office…)']] },
            ...(offline ? [{ key: 'payment_status', label: 'Collected', type: 'select', required: true, options: [['paid', 'Paid in full'], ['partially_paid', 'Partly paid'], ['pending', 'Pending (pay later)']] }] : []),
            ...(offline && v.payment_status !== 'pending' ? [{ key: 'amount_paid', label: 'Amount received (₹)', type: 'number', required: true, min: 0 }] : []),
          ]} />
          {waitingOnline && <p className="mt-2 text-sm text-gold-deep">Waiting for the online payment. Switch to Offline to approve now.</p>}
          {offline && v.payment_status !== 'paid' && <p className="mt-2 text-sm text-slate-600">What is still owed is added to the guest's first rent.</p>}
        </fieldset>
      )}
      {dateError && <p role="alert" className="text-sm text-red-700">{dateError}</p>}
      <ActionMsg action={a} /><Button type="submit" disabled={a.busy || rooms.loading || Boolean(dateError) || waitingOnline}>Approve and add to guest register</Button>
    </form>}
  </Modal>
}
