import { useState } from 'react'
import useAsync from '../../hooks/useAsync'
import { ActionMsg, Small, useAction, useScope } from './kit'
import { Badge, Button, Empty, ErrorBox, TableSkeleton } from '../ui'
import { formatDate } from '../../services/format'
import { couponMessage, couponValue, couponWhatsapp, couponsList, setCouponActive } from '../../services/coupons'
import CouponForm from './CouponForm'

// Coupons for exclusive offers. Managers see their wings' coupons; the owner sees every coupon, with who made it.
export default function Coupons() {
  const { property } = useScope()
  const q = useAsync(couponsList, [])
  const [adding, setAdding] = useState(false)
  const [copied, setCopied] = useState('')
  const a = useAction()
  if (q.loading) return <TableSkeleton />
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />
  const list = (q.data ?? []).filter((c) => !property || !c.property_id || c.property_id === property)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const copy = async (c) => {
    try { await navigator.clipboard.writeText(couponMessage(c)); setCopied(c.code) } catch { setCopied('') }
  }
  const toggle = async (c) => {
    if (await a.run(() => setCouponActive(c.code, !c.is_active), c.is_active ? 'Coupon switched off' : 'Coupon switched on')) q.reload()
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setAdding(true)}>New coupon</Button>
        <p className="text-sm text-slate-600">Guests type the code on their registration payment page.</p>
      </div>
      <ActionMsg action={a} />
      {list.length === 0 ? <Empty title="No coupons yet" /> : (
        <ul className="space-y-2">
          {list.map((c) => {
            const usedUp = c.max_uses != null && c.used_count >= c.max_uses
            const expired = Boolean(c.valid_to && c.valid_to < today)
            const facts = [c.description, c.property_id && `Wing ${c.property_id}`, c.phone && `only ${c.phone}`, c.enquiry_name && `for enquiry ${c.enquiry_name}`,
              c.valid_to && `until ${formatDate(c.valid_to)}`, `used ${c.used_count}${c.max_uses != null ? ` of ${c.max_uses}` : ''}`,
              c.applied_waiting > 0 && `${c.applied_waiting} applied, waiting`, c.created_by_name && `by ${c.created_by_name}`].filter(Boolean)
            return (
              <li key={c.code} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-navy/10 bg-white p-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    <span className="font-mono">{c.code}</span> · {couponValue(c)}{' '}
                    <Badge tone={!c.is_active || usedUp || expired ? 'gray' : 'green'}>{!c.is_active ? 'Off' : usedUp ? 'Used up' : expired ? 'Expired' : 'Active'}</Badge>
                  </p>
                  <p className="text-xs text-slate-600">{facts.join(' · ')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Small href={couponWhatsapp(c)} target="_blank" rel="noopener">Share on WhatsApp</Small>
                  <Small onClick={() => copy(c)}>{copied === c.code ? 'Copied' : 'Copy message'}</Small>
                  <Small disabled={a.busy} onClick={() => toggle(c)}>{c.is_active ? 'Switch off' : 'Switch on'}</Small>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {adding && <CouponForm onClose={() => setAdding(false)} onDone={() => { setAdding(false); q.reload() }} />}
    </div>
  )
}
