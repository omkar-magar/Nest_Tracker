import { useEffect, useState } from 'react'
import { Field, inputCls } from './ui'
import { isConfigured } from '../lib/supabase'
import { submitEnquiry } from '../services/manage'
import { campaignCode } from '../hooks/useCampaignTracking'
import { BUDGETS, OPEN_WHATSAPP_EVENT, leadMessage, whatsappUrl } from '../services/contact'

const empty = { name: '', phone: '', budget: '' }

// Opened by every WhatsApp button. Collects name, number and budget, saves them as a website enquiry, then opens WhatsApp.
export default function WhatsAppLeadModal() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)

  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(OPEN_WHATSAPP_EVENT, show)
    return () => window.removeEventListener(OPEN_WHATSAPP_EVENT, show)
  }, [])

  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  const submit = (e) => {
    e.preventDefault()
    // Open first so the browser does not treat it as a blocked popup; saving the enquiry must not hold it up.
    window.open(whatsappUrl(leadMessage(form)), '_blank', 'noopener')
    if (isConfigured) {
      submitEnquiry({
        name: form.name.trim(), phone: form.phone, room_type: null, move_in: null,
        source: 'website', campaign_code: campaignCode(),
        message: `WhatsApp chat request, budget ${form.budget}`,
      }).catch(() => {})
    }
    setForm(empty)
    close()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/60 p-0 sm:items-center sm:p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="wa-title" onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-6 text-navy sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="wa-title" className="text-2xl font-bold text-gold-deep">Message us</h2>
            <p className="mt-1 text-slate-700">Fill details to chat with us on WhatsApp</p>
          </div>
          <button onClick={close} aria-label="Close" className="rounded-lg p-1 focus-visible:outline-2 focus-visible:outline-navy">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <form onSubmit={submit} className="mt-5 grid gap-4">
          <Field label="Name *"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" required /></Field>
          <Field label="WhatsApp number *">
            <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" inputMode="tel" pattern="[+0-9 ]{10,15}" placeholder="+91" required />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Select your comfortable budget range *</legend>
            <div className="grid gap-2">
              {BUDGETS.map((b) => (
                <label key={b} className="flex cursor-pointer items-center gap-3 rounded-xl border border-navy/10 px-3 py-2 text-sm has-[:checked]:border-navy has-[:checked]:bg-navy/5">
                  <input type="radio" name="budget" value={b} checked={form.budget === b} onChange={() => setForm({ ...form, budget: b })} required className="h-4 w-4 accent-navy" />
                  {b}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className="w-full rounded-full bg-sun px-8 py-3 font-semibold text-navy transition-colors hover:bg-sun/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy">
            Continue to WhatsApp
          </button>
        </form>
      </div>
    </div>
  )
}
