import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ActionMsg, Load, useAction } from '../../components/manage/kit'
import { Button, Card, Empty, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { formatDateTime } from '../../services/format'
import { label } from '../../services/pg'

// New self-registrations (sign-up form) waiting for a manager. Approving opens the resident's dashboard.
export default function Registrations() {
  return (
    <Load loader={() => m.loadTenants('').then((list) => list.filter((t) => t.tenant_profiles?.approval_status === 'pending' && t.tenant_profiles?.rules_accepted_at))}>
      {(list, reload) => (
        <div className="space-y-4">
          <h2 className="text-xl font-bold">New registrations ({list.length})</h2>
          {list.length === 0 ? <Empty title="No registrations waiting">New sign-ups will appear here for approval.</Empty>
            : list.map((t) => <Pending key={t.id} t={t} onDone={reload} />)}
        </div>
      )}
    </Load>
  )
}

function Pending({ t, onDone }) {
  const tp = t.tenant_profiles
  const [note, setNote] = useState('')
  const a = useAction()
  const decide = async (status, ok) => { if (await a.run(() => m.setApproval(t.id, status, note), ok)) onDone() }
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{t.full_name}</h3>
          <p className="text-sm text-slate-600">{t.phone}{tp.email && ` · ${tp.email}`}</p>
          <p className="text-sm text-slate-600">
            {tp.room_type_pref ? label(tp.room_type_pref) : 'No room preference'}{tp.move_in_date && ` · move in ${tp.move_in_date}`}{tp.stay_duration && ` · ${tp.stay_duration}`}
          </p>
          <p className="mt-1 text-xs text-slate-500">Registered {formatDateTime(tp.rules_accepted_at)}</p>
        </div>
        <Link className="text-sm font-medium underline" to={`/admin/tenants/${t.id}`}>View full form</Link>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <input className={`${inputCls} !w-64`} placeholder="Note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Note for ${t.full_name}`} />
        <Button onClick={() => decide('approved', 'Approved')} disabled={a.busy}>Approve</Button>
        <Button variant="danger" onClick={() => decide('rejected', 'Rejected')} disabled={a.busy}>Reject</Button>
      </div>
      <ActionMsg action={a} />
    </Card>
  )
}
