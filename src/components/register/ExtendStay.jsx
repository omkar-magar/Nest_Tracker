import { useState } from 'react'
import { ActionMsg, FormFields, Modal, useAction } from '../manage/kit'
import { Button } from '../ui'
import { formatDate, rupees } from '../../services/format'
import { extendStay } from '../../services/stay'

// Manager / owner: extend a guest's stay to a new check-out date, with an optional extra charge added to the rent
// and the rent status. Works for checked-out guests too (they come back as current guests).
export default function ExtendStay({ guest: g, request, onClose, onDone }) {
  const [v, setV] = useState({ until: request?.requested_until ?? '', charge: '', status: 'pending', note: '' })
  const a = useAction()
  const submit = async (e) => {
    e.preventDefault()
    if (await a.run(() => extendStay(g.id, v, request?.id ?? null), 'Stay extended')) onDone(v)
  }
  return (
    <Modal title={`Extend stay: ${g.name || g.guest || 'guest'}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        Room {g.room_no}{g.expected_checkout || g.current_until ? ` · check-out now ${formatDate(g.expected_checkout || g.current_until)}` : ''}
        {g.checked_out_on ? ` · checked out ${formatDate(g.checked_out_on)}` : ''}{g.rent != null ? ` · rent ${rupees(g.rent)}` : ''}
      </p>
      {request && <p className="mb-3 rounded-xl bg-cream p-2 text-sm">Asked to stay until {formatDate(request.requested_until)}{request.note ? `: “${request.note}”` : ''}</p>}
      <form onSubmit={submit} className="space-y-3">
        <FormFields value={v} onChange={setV} fields={[
          { key: 'until', label: 'New check-out date', type: 'date', required: true },
          { key: 'charge', label: 'Extra charge added to rent (₹)', type: 'number', min: 0 },
          { key: 'status', label: 'Rent status', type: 'select', required: true, options: [['paid', 'Paid'], ['partially_paid', 'Partly paid'], ['pending', 'Pending'], ['not_updated', 'Not updated']] },
          { key: 'note', label: 'Note', type: 'textarea' },
        ]} />
        {g.checked_out_on && <p className="text-sm text-slate-600">This guest has checked out. Extending brings them back as a current guest and opens their resident page again.</p>}
        <ActionMsg action={a} />
        <Button type="submit" disabled={a.busy}>Extend stay</Button>
      </form>
    </Modal>
  )
}
