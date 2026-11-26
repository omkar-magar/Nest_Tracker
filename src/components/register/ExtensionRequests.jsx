import { useState } from 'react'
import useAsync from '../../hooks/useAsync'
import { ActionMsg, Small, useAction } from '../manage/kit'
import { Badge } from '../ui'
import { formatDate } from '../../services/format'
import { EXTENSION_STATUS, declineExtension, extensionRequests } from '../../services/stay'
import ExtendStay from './ExtendStay'

// Guests on daily stays asking to stay longer. Approve opens the extension form with the asked date.
export default function ExtensionRequests({ pid, onChanged }) {
  const q = useAsync(() => extensionRequests(pid), [pid])
  const [open, setOpen] = useState(null)
  const a = useAction()
  const list = q.data ?? []
  if (!list.length) return null
  return (
    <section aria-label="Extension requests" className="rounded-2xl border border-gold/40 bg-sun/10 p-4">
      <h3 className="font-bold">Extension requests ({list.filter((x) => x.open).length} waiting)</h3>
      <ActionMsg action={a} />
      <ul className="mt-2 divide-y divide-navy/5 text-sm">
        {list.map((x) => {
          const [label, tone] = EXTENSION_STATUS[x.status]
          return (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{x.guest}</span> · room {x.room_no} · until {formatDate(x.current_until)} → asks {formatDate(x.requested_until)}
                {x.note && <span className="block text-xs text-slate-600">“{x.note}”</span>}
                {x.answer && !x.open && <span className="block text-xs text-slate-600">{x.answer}</span>}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={tone}>{x.status === 'requested' ? 'Waiting' : label}</Badge>
                {x.open && <>
                  <Small onClick={() => setOpen(x)}>Approve</Small>
                  <Small disabled={a.busy} onClick={async () => {
                    const note = window.prompt('Reason (optional)') ?? null
                    if (note !== null && await a.run(() => declineExtension(x.id, note), 'Declined')) q.reload()
                  }}>Decline</Small>
                </>}
              </span>
            </li>
          )
        })}
      </ul>
      {open && <ExtendStay guest={{ id: open.guest_id, name: open.guest, room_no: open.room_no, current_until: open.current_until, rent: open.rent }} request={open}
        onClose={() => setOpen(null)} onDone={() => { setOpen(null); q.reload(); onChanged?.() }} />}
    </section>
  )
}
