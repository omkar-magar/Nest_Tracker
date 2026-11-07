import { useState } from 'react'
import { Button, Field, Notice, inputCls } from './ui'
import { categories, visitSlots, visitTypes } from '../data/site'
import { todayInput, visitMessage, whatsappUrl } from '../services/contact'

const NOT_SURE = 'Not sure yet'

// Nothing is stored: the request opens in WhatsApp, and the visitor sends it from their own number.
export default function VisitForm() {
  const [form, setForm] = useState({ name: '', visitType: visitTypes[0], date: '', slot: '', stay: NOT_SURE })
  const [opened, setOpened] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    window.open(whatsappUrl(visitMessage(form)), '_blank', 'noopener')
    setOpened(true)
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-navy/10 bg-white p-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Your name">
          <input className={inputCls} value={form.name} onChange={set('name')} autoComplete="name" required />
        </Field>
      </div>
      <Field label="Visit type">
        <select className={inputCls} value={form.visitType} onChange={set('visitType')}>
          {visitTypes.map((t) => <option key={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Interested in">
        <select className={inputCls} value={form.stay} onChange={set('stay')}>
          <option>{NOT_SURE}</option>
          {categories.map((c) => <option key={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Preferred date">
        <input type="date" className={inputCls} value={form.date} onChange={set('date')} min={todayInput()} required />
      </Field>
      <Field label="Preferred time">
        <select className={inputCls} value={form.slot} onChange={set('slot')} required>
          <option value="">Choose a time</option>
          {visitSlots.map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="sun" className="w-full px-6 py-3 sm:w-auto">Request visit on WhatsApp</Button>
      </div>
      {opened && (
        <div className="sm:col-span-2">
          <Notice tone="ok">Your request is ready in WhatsApp. Press send there to confirm it with us. If WhatsApp did not open, please call us instead.</Notice>
        </div>
      )}
    </form>
  )
}
