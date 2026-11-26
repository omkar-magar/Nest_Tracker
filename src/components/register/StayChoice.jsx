import useAsync from '../../hooks/useAsync'
import { Field, Notice, inputCls } from '../ui'
import { formatDate, rupees } from '../../services/format'
import { STAY_TYPES, dueDayFor, firstDue, isDaily, registrationRooms, stayQuote } from '../../services/registration'

const addDay = (ymd, n) => {
  if (!ymd) return ''
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

// Section 4 of the registration form: stay type, dates, a free room and the rent due day, with the price.
export default function StayChoice({ value: v, onChange }) {
  const set = (patch) => onChange({ ...v, ...patch })
  const daily = isDaily(v.stay_type)
  const rooms = useAsync(() => (v.property_id && v.stay_type ? registrationRooms(v.property_id, v.stay_type) : Promise.resolve([])),
    [v.property_id, v.stay_type])
  const datesOk = !daily || (v.move_in_date && v.checkout_date > v.move_in_date)
  const quote = useAsync(() => (v.stay_type && datesOk ? stayQuote(v.stay_type, v.move_in_date, daily ? v.checkout_date : null) : Promise.resolve(null)),
    [v.stay_type, v.move_in_date, v.checkout_date, datesOk])
  const joinDay = v.move_in_date ? Number(v.move_in_date.slice(8, 10)) : null
  const dueDay = dueDayFor(v.move_in_date, v.due_day)
  const due = firstDue(v.move_in_date, dueDay)
  const q = quote.data

  return (
    <section aria-label="4. Stay details" className="space-y-4">
      <h3 className="rounded-lg bg-navy px-3 py-1.5 text-sm font-semibold uppercase tracking-wide text-white">4. Stay details</h3>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">What kind of stay? *</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STAY_TYPES.map(([k, label]) => (
            <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm focus-within:outline-2 focus-within:outline-navy ${v.stay_type === k ? 'border-navy bg-navy/5 font-semibold' : 'border-navy/20'}`}>
              <input type="radio" name="stay_type" value={k} className="accent-navy" checked={v.stay_type === k}
                onChange={() => set({ stay_type: k, room_no: '' })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Move-in date *">
          <input type="date" className={inputCls} required min={todayIST()} value={v.move_in_date}
            onChange={(e) => set({ move_in_date: e.target.value })} />
        </Field>
        {daily && (
          <Field label="Check-out date *">
            <input type="date" className={inputCls} required min={addDay(v.move_in_date, 1) || undefined} value={v.checkout_date}
              onChange={(e) => set({ checkout_date: e.target.value })} />
          </Field>
        )}
        <Field label="Room *">
          <select className={inputCls} required value={v.room_no} onChange={(e) => set({ room_no: e.target.value })} disabled={!v.property_id}>
            <option value="">{!v.property_id ? 'Choose a property first' : rooms.loading ? 'Loading rooms…' : (rooms.data ?? []).length ? 'Choose a room' : 'No free rooms for this stay'}</option>
            {(rooms.data ?? []).map((r) => (
              <option key={r.room_no} value={r.room_no}>
                {r.room_no} · Floor {r.floor} · {v.stay_type?.startsWith('flat') ? 'whole flat' : `${r.free} of ${r.beds} beds free`}{r.ac_type ? ` · ${r.ac_type}` : ''}
              </option>
            ))}
          </select>
        </Field>
        {!daily && (
          <Field label="Rent due day *">
            <select className={inputCls} required value={dueDay ?? ''} disabled={joinDay !== null && joinDay <= 10}
              onChange={(e) => set({ due_day: e.target.value })}>
              <option value="">Choose 1 to 10</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} of every month</option>)}
            </select>
          </Field>
        )}
      </div>
      {rooms.error && <Notice tone="warn">Could not load the free rooms. Reload to try again.</Notice>}

      {!daily && (
        <p className="rounded-xl bg-cream p-3 text-sm">
          {joinDay !== null && joinDay <= 10
            ? <>You join on the {joinDay}{suffix(joinDay)}, so your rent is due on the {joinDay}{suffix(joinDay)} of every month.</>
            : <>Rent is due on the day you choose (1 to 10). You pay your first month when you register. The extra days between the end of that month and your due day are added to the bill on your first due date{due ? ` (${formatDate(due)})` : ''}. After that you pay the usual monthly rent.</>}
        </p>
      )}

      {q && (
        <div className="rounded-2xl border border-navy/10 bg-white p-4 text-sm" aria-live="polite">
          <h4 className="font-semibold">To pay when you register</h4>
          <dl className="mt-2 space-y-1">
            {q.daily
              ? <div className="flex justify-between"><dt>{q.nights} night{q.nights === 1 ? '' : 's'}{q.nights >= 30 ? ' (30 nights cost one month)' : ` × ${rupees(q.rate)}`}</dt><dd>{rupees(q.rent)}</dd></div>
              : <div className="flex justify-between"><dt>First month's rent</dt><dd>{rupees(q.rent)}</dd></div>}
            <div className="flex justify-between"><dt>Deposit</dt><dd>{rupees(q.deposit)}</dd></div>
            <div className="flex justify-between border-t border-navy/10 pt-1 font-semibold"><dt>Total</dt><dd>{rupees(q.amount)}</dd></div>
          </dl>
        </div>
      )}
    </section>
  )
}

const suffix = (n) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th')
