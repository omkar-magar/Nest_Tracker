import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { Field, Notice, inputCls } from './ui'
import { categories } from '../data/site'
import { isConfigured } from '../lib/supabase'
import { submitEnquiry } from '../services/manage'
import { campaignCode } from '../hooks/useCampaignTracking'

const empty = { name: '', email: '', phone: '', stay: '' }

// "Request a call back" popup opened from the navbar. Saved as a website enquiry for the sales team.
export default function EnquiryModal({ onClose }) {
  const [form, setForm] = useState(empty)
  const [state, setState] = useState('idle') // idle | sending | done | error
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const submit = async (e) => {
    e.preventDefault()
    setState('sending')
    try {
      if (isConfigured) {
        await submitEnquiry({
          name: form.name.trim(), phone: form.phone, room_type: form.stay, move_in: null,
          source: 'website', campaign_code: campaignCode(),
          message: `Call back request${form.email ? `, email ${form.email.trim()}` : ''}`,
        })
      }
      setState('done')
    } catch {
      setState('error')
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="enquiry-title" onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-6 text-navy sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="enquiry-title" className="text-2xl font-bold text-gold-deep">Request a call back</h2>
            <p className="mt-1 text-slate-700">We will call you back within 24 hours</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 focus-visible:outline-2 focus-visible:outline-navy">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {state === 'done' ? (
          <div className="mt-5"><Notice tone="ok">Thank you, {form.name.trim()}. We have your details and will call you back soon.</Notice></div>
        ) : (
          <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Name *"><input className={inputCls} value={form.name} onChange={set('name')} autoComplete="name" required /></Field>
            <Field label="Email"><input type="email" className={inputCls} value={form.email} onChange={set('email')} autoComplete="email" /></Field>
            <Field label="WhatsApp number *">
              <input className={inputCls} value={form.phone} onChange={set('phone')} autoComplete="tel" inputMode="tel" pattern="[+0-9 ]{10,15}" required />
            </Field>
            <Field label="Interested in">
              <select className={inputCls} value={form.stay} onChange={set('stay')}>
                <option value="">Not sure yet</option>
                {categories.map((c) => <option key={c.id}>{c.name}</option>)}
              </select>
            </Field>
            {state === 'error' && <div className="sm:col-span-2"><Notice tone="warn">Could not send. Please try again or call us.</Notice></div>}
            <div className="flex justify-center sm:col-span-2">
              <button type="submit" disabled={state === 'sending'}
                className="w-full rounded-full bg-navy px-8 py-3 font-semibold text-white transition-colors hover:bg-navy/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-60 sm:w-auto">
                {state === 'sending' ? 'Sending…' : 'Submit Details'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
