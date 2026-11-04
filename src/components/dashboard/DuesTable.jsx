import { useState } from 'react'
import ContactButtons from './ContactButtons'
import { Badge, Empty, Table, inputCls } from '../ui'
import { formatDate, rupees } from '../../services/format'

const reminder = (c) =>
  c.days_overdue > 0
    ? `Hi ${c.full_name}, this is YOLO Nest. Your payment due on ${formatDate(c.next_due_date)} is overdue. Please pay from your dashboard. Thank you.`
    : `Hi ${c.full_name}, this is YOLO Nest. A reminder that your payment is due on ${formatDate(c.next_due_date)}. Thank you.`

const soon = (c) => {
  if (!c.next_due_date || c.days_overdue > 0) return false
  const days = (new Date(c.next_due_date) - new Date(new Date().toISOString().slice(0, 10))) / 86400000
  return days <= 7
}

// rows come from staff_customer_overview(): the database already trimmed what this user may see.
export default function DuesTable({ rows }) {
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const hasAmounts = rows.some((r) => r.next_due_amount != null)

  const shown = rows
    .filter((r) => filter === 'all' || (filter === 'overdue' ? r.days_overdue > 0 : soon(r)))
    .filter((r) => !q || r.full_name.toLowerCase().includes(q.toLowerCase()) || (r.room_no ?? '').includes(q))

  const overdue = rows.filter((r) => r.days_overdue > 0).length
  const upcoming = rows.filter(soon).length

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {[['all', `All (${rows.length})`], ['overdue', `Overdue (${overdue})`], ['soon', `Due in 7 days (${upcoming})`]].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
            className={`rounded-full border px-4 py-1 text-sm ${filter === k ? 'border-navy bg-navy text-white' : 'border-navy/20'}`}>{label}</button>
        ))}
        <input className={`${inputCls} ml-auto max-w-56`} type="search" placeholder="Search name or room" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mt-3">
        <Table
          head={['Customer', 'Room / bed', 'Next due', ...(hasAmounts ? ['Amount'] : []), 'Status', 'Contact']}
          empty={shown.length === 0 && <div className="p-4"><Empty title="Nobody matches">No customers in this view.</Empty></div>}
        >
          {shown.map((c) => (
            <tr key={c.customer_id}>
              <td className="px-4 py-3 font-medium">{c.full_name || '—'}</td>
              <td className="px-4 py-3">{c.room_no}{c.beds && ` · ${c.beds}`}</td>
              <td className="px-4 py-3">{formatDate(c.next_due_date)}</td>
              {hasAmounts && <td className="px-4 py-3">{c.next_due_amount != null ? rupees(c.next_due_amount) : '—'}</td>}
              <td className="px-4 py-3">
                {c.days_overdue > 0 ? <Badge tone="red">{c.days_overdue} days overdue</Badge>
                  : soon(c) ? <Badge tone="amber">Due soon</Badge>
                  : c.booking_status === 'pending' ? <Badge>Awaiting payment</Badge> : <Badge tone="green">Up to date</Badge>}
              </td>
              <td className="px-4 py-3"><ContactButtons phone={c.phone} message={c.next_due_date ? reminder(c) : ''} /></td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  )
}
