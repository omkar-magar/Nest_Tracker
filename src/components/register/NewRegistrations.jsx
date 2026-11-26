import { useState } from 'react'
import useAsync from '../../hooks/useAsync'
import { approveRegistration, firstDue, isDaily, newRegistrations, registrationStayError, stayLabel } from '../../services/registration'
import { loadRegisterRooms } from '../../services/register'
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
    <p className="text-sm">{stayLabel(r.stay_type)} · room {r.room_no} · from {formatDate(r.move_in_date)}{isDaily(r.stay_type) ? ` to ${formatDate(r.checkout_date)}` : ` · due day ${r.due_day}`} · {rupees(r.amount_due)}</p>
    <p className="mt-1"><Badge tone={tone}>{label}</Badge> <span className="text-xs text-slate-600">{r.payment_mode === 'offline' ? 'Offline' : 'Online'}</span></p>
  </>
}

// payment made with the earlier registration-fee flow, if any
const PaidLine = ({ pay }) => (pay
  ? <p className="text-sm text-green-800">Registration payment {rupees(pay.amount)} paid{pay.is_simulated ? ' (demo)' : ''}{pay.completed_at ? ` on ${formatDate(pay.completed_at)}` : ''}</p>
  : null)

function Approval({ registration: r, onClose, onDone }) {
  const rooms = useAsync(() => loadRegisterRooms(r.property_id), [r.property_id])
  const [v, setV] = useState({ room_no: r.room_no || '', rent: '', deposit: '', due_date: isDaily(r.stay_type) ? (r.move_in_date || '') : (firstDue(r.move_in_date, r.due_day) || ''),
    check_in: r.move_in_date || ymd(), expected_checkout: r.checkout_date || '', room_type: r.stay_type?.startsWith('flat') ? 'rented' : 'pg', notes: '' })
  const a = useAction()
  const dateError = registrationStayError(v)
  const submit = async (e) => { e.preventDefault(); if (await a.run(() => approveRegistration(r.user_id, v))) onDone() }
  return <Modal title={`Approve ${r.profiles?.full_name || 'registration'}`} onClose={onClose} wide>
    <div className="mb-3"><StayLine r={r} /><PaidLine pay={r.registration_payment} /></div>
    <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
      {TENANT_SECTIONS.flatMap((s) => s.fields).filter((f) => !['full_name', 'phone'].includes(f.key)).map((f) => <div key={f.key}><dt className="text-slate-600">{f.label}</dt><dd className="break-words">{typeof r[f.key] === 'boolean' ? (r[f.key] ? 'Yes' : 'No') : r[f.key] || '—'}</dd></div>)}
      <div><dt>Rules accepted</dt><dd>{r.rules_signature || '—'}</dd></div>
    </dl>
    {rooms.error ? <ErrorBox error={rooms.error} onRetry={rooms.reload} /> : <form onSubmit={submit} className="space-y-4">
      <FormFields value={v} onChange={setV} fields={[
        { key: 'room_no', label: 'Room', type: 'select', required: true, options: [['', 'Choose a room'], ...(rooms.data ?? []).map((x) => x.room_no)] },
        { key: 'rent', label: 'Monthly rent (₹)', type: 'number', required: true, min: 0 },
        { key: 'deposit', label: 'Deposit (₹)', type: 'number', required: true, min: 0 },
        { key: 'due_date', label: 'Rent due date', type: 'date', required: true },
        { key: 'check_in', label: 'Check-in', type: 'date', required: true },
        { key: 'expected_checkout', label: 'Expected check-out', type: 'date', min: v.check_in || undefined },
        { key: 'room_type', label: 'Room type', type: 'select', required: true, options: [['pg', 'PG'], ['rented', 'Rented']] },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ]} />
      {dateError && <p role="alert" className="text-sm text-red-700">{dateError}</p>}
      <ActionMsg action={a} /><Button type="submit" disabled={a.busy || rooms.loading || Boolean(dateError)}>Approve and add to guest register</Button>
    </form>}
  </Modal>
}
