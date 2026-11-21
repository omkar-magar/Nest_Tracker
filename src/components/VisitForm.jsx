import { useState } from 'react'
import { Button, Field, Notice, inputCls } from './ui'
import { categories, visitSlots, visitTypes } from '../data/site'
import { todayInput, visitMessage, whatsappUrl } from '../services/contact'
import { isConfigured } from '../lib/supabase'
import { submitEnquiry } from '../services/manage'
import { campaignCode } from '../hooks/useCampaignTracking'

const NOT_SURE = 'Not sure yet'

// The request opens in WhatsApp, and the visitor sends it from their own number. With a mobile number it is also
// saved as an enquiry (PRD 8.1 website form), so the sales team can follow up even if WhatsApp is never sent.
export default function VisitForm() {
  const [form, setForm] = useState({ name: '', phone: '', visitType: visitTypes[0], date: '', slot: '', stay: NOT_SURE })
  const [opened, setOpened] = useState(false)
  const [saved, setSaved] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    window.open(whatsappUrl(visitMessage(form)), '_blank', 'noopener')
    setOpened(true)
    if (isConfigured && form.phone.replace(/\D/g, '').length >= 10) {
      submitEnquiry({
        name: form.name.trim(), phone: form.phone, room_type: form.stay === NOT_SURE ? '' : form.stay, move_in: form.date || null,
        source: 'website', campaign_code: campaignCode(), message: `${form.visitType}, ${form.date} ${form.slot}`,
      }).then(() => setSaved(true)).catch(() => {})
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-navy/10 bg-white p-5 sm:grid-cols-2">
      <Field label="Your name">
        <input className={inputCls} value={form.name} onChange={set('name')} autoComplete="name" required />
      </Field>
      <Field label="Mobile number (optional)">
        <input className={inputCls} value={form.phone} onChange={set('phone')} autoComplete="tel" inputMode="tel" pattern="[+0-9 ]{10,15}" />
      </Field>
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
          <Notice tone="ok">Your request is ready in WhatsApp. Press send there to confirm it with us. If WhatsApp did not open, please call us instead.{saved && ' We have also noted your number and will call you back.'}</Notice>
        </div>
      )}
    </form>
  )
}
