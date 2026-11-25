import { useState } from 'react'
import { ActionMsg, Load, useAction } from '../../components/manage/kit'
import { Badge, Button, Card, Field, Notice, Stat, inputCls } from '../../components/ui'
import { formatDate, rupees } from '../../services/format'
import { INVENTORY_ITEMS } from '../../services/inventory'
import { ADDON_STATUS, addonLabel, cancelAddon, monthName, myStay, requestAddon } from '../../services/stay'
import { useAuth } from '../../context/AuthContext'

const STATUS = { paid: ['Paid', 'green'], pending: ['Due', 'amber'], partially_paid: ['Part paid', 'amber'], not_updated: ['Due', 'amber'], not_applicable: ['Not applicable', 'gray'], upcoming: ['Upcoming', 'gray'] }
const addonTone = { requested: 'amber', approved: 'green', rejected: 'red', cancelled: 'gray' }

// The approved resident's stay from the guest register (rent, this month and next, room items, extras).
export default function MyStay() {
  const { user } = useAuth()
  return (
    <Load loader={myStay} deps={[user.id]}>
      {(s, reload) => (!s ? <Notice>Your room and rent show here once your manager approves your registration.</Notice> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Room" value={s.room_no} hint={s.property_name} />
            <Stat label="Monthly rent" value={rupees(s.rent)} />
            <Stat label="Deposit" value={rupees(s.deposit)} hint={STATUS[s.deposit_status]?.[0] === 'Paid' ? 'Paid' : undefined} />
            <Stat label="Checked in" value={formatDate(s.check_in)} hint={s.expected_checkout ? `Until ${formatDate(s.expected_checkout)}` : undefined} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {(s.months ?? []).map((m, i) => <MonthCard key={m.month} m={m} title={i === 0 ? 'This month' : 'Next rent'} />)}
          </div>
          <RoomItems s={s} onChanged={reload} />
        </div>
      ))}
    </Load>
  )
}

function MonthCard({ m, title }) {
  const [label, tone] = STATUS[m.status] ?? STATUS.not_updated
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{title} · {monthName(m.month)}</h3>
          <p className="text-sm text-slate-600">{m.due_date ? `Due ${formatDate(m.due_date)}` : 'No rent due this month'}</p>
        </div>
        {m.due_date && <Badge tone={tone}>{label}</Badge>}
      </div>
      {m.due_date && (
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between"><dt>Rent</dt><dd>{rupees(m.rent)}</dd></div>
          {m.extras.map((x, i) => <div key={i} className="flex justify-between"><dt>{x.qty} × {addonLabel(x.item)} (extra)</dt><dd>{rupees(x.amount)}</dd></div>)}
          <div className="flex justify-between border-t border-navy/10 pt-1 font-semibold"><dt>Total</dt><dd>{rupees(m.total)}</dd></div>
        </dl>
      )}
    </Card>
  )
}

function RoomItems({ s, onChanged }) {
  const prices = Object.entries(s.addon_prices ?? {}).filter(([, p]) => typeof p === 'number')
  const [item, setItem] = useState(prices[0]?.[0] ?? '')
  const [qty, setQty] = useState('1')
  const a = useAction()
  const known = INVENTORY_ITEMS.filter(([k]) => s.inventory?.[k] > 0)
  const other = Object.keys(s.inventory ?? {}).filter((k) => !INVENTORY_ITEMS.some(([x]) => x === k))
  const price = s.addon_prices?.[item] ?? 0
  const submit = async (e) => {
    e.preventDefault()
    if (await a.run(() => requestAddon(item, qty), 'Request sent. Your manager will confirm it.')) onChanged()
  }
  return (
    <Card>
      <h3 className="font-semibold">In your room ({s.room_no})</h3>
      {known.length + other.length === 0 ? <p className="mt-1 text-sm text-slate-600">The office has not listed the furniture in your room yet.</p> : (
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {known.map(([k, text]) => <li key={k} className="rounded-xl bg-cream px-3 py-2 text-sm"><span className="block text-lg font-bold">{s.inventory[k]}</span>{text}</li>)}
          {other.map((k) => <li key={k} className="rounded-xl bg-cream px-3 py-2 text-sm"><span className="block text-lg font-bold">{s.inventory[k]}</span>{addonLabel(k)}</li>)}
        </ul>
      )}
      <p className="mt-1 text-xs text-slate-500">Counts are for the whole room, shared with your roommates.</p>

      {prices.length > 0 && (
        <form onSubmit={submit} className="mt-5 border-t border-navy/10 pt-4">
          <h4 className="font-semibold">Need something extra?</h4>
          <p className="text-sm text-slate-600">Ask for an extra item. Once your manager approves it, the charge is added to your next rent.</p>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {prices.map(([k, p]) => <li key={k} className="rounded-full border border-navy/10 px-3 py-1">{addonLabel(k)} · {rupees(p)}</li>)}
          </ul>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Item">
              <select className={inputCls} value={item} onChange={(e) => setItem(e.target.value)}>
                {prices.map(([k, p]) => <option key={k} value={k}>{addonLabel(k)} ({rupees(p)} each)</option>)}
              </select>
            </Field>
            <Field label="How many">
              <select className={`${inputCls} !w-24`} value={qty} onChange={(e) => setQty(e.target.value)}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Button type="submit" disabled={a.busy || !item}>Request · {rupees(price * Number(qty))}</Button>
          </div>
          <div className="mt-2"><ActionMsg action={a} /></div>
        </form>
      )}

      {s.addons?.length > 0 && (
        <div className="mt-5 border-t border-navy/10 pt-4">
          <h4 className="font-semibold">Your extras</h4>
          <ul className="mt-2 divide-y divide-navy/5">
            {s.addons.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {x.qty} × {addonLabel(x.item)} · {rupees(x.qty * x.unit_price)}
                  {x.status === 'approved' && x.charge_month && <span className="block text-xs text-slate-600">Added to the rent for {monthName(x.charge_month)}</span>}
                  {x.note && <span className="block text-xs text-slate-600">{x.note}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={addonTone[x.status]}>{ADDON_STATUS[x.status]}</Badge>
                  {x.status === 'requested' && <button className="text-xs font-medium underline focus-visible:outline-2 focus-visible:outline-navy"
                    onClick={async () => (await a.run(() => cancelAddon(x.id), 'Request cancelled')) && onChanged()}>Cancel</button>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
