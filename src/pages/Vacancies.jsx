import { useState } from 'react'
import useCatalog from '../hooks/useCatalog'
import { availability, priceLabel } from '../services/catalog'
import Img from '../components/Img'
import { Badge, Button, CardGridSkeleton, ErrorBox, Field, Notice, PageHeader, inputCls } from '../components/ui'
import { isConfigured } from '../lib/supabase'
import { submitEnquiry } from '../services/manage'
import { campaignCode } from '../hooks/useCampaignTracking'
import { todayInput, whatsappUrl } from '../services/contact'

// PRD 9.4 public vacancy page: live free beds with photos, rent and amenities, and an
// "Enquire / book a visit" form that goes straight into the enquiry list.
export default function Vacancies() {
  const { data, error, loading, reload } = useCatalog()
  const [room, setRoom] = useState(null)
  const rooms = (data?.rooms ?? []).map((r) => ({ r, a: availability(r) })).filter(({ a }) => a.status === 'unknown' || a.bookable)
  return (
    <>
      <PageHeader title="Beds available now" intro="Live availability. Pick a room to enquire or book a visit; we usually call back within a few hours." />
      <div className="mx-auto w-full max-w-6xl px-4 py-10 text-navy">
        {loading ? <CardGridSkeleton /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
          <>
            {rooms.length === 0 && <Notice>We are full right now. Leave your details below and we will tell you when a bed frees up.</Notice>}
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.map(({ r, a }) => (
                <li key={r.id} className="overflow-hidden rounded-2xl border border-navy/10 bg-white">
                  <Img src={r.image} alt={`Room ${r.no}`} className="h-44 w-full object-cover" />
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-semibold">Room {r.no} · {r.type}</h2>
                      {a.free != null && <Badge tone="green">{a.free} bed{a.free === 1 ? '' : 's'} free</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{priceLabel(r)}{r.deposit ? ` · deposit ₹${r.deposit.toLocaleString('en-IN')}` : ''}</p>
                    {r.features.length > 0 && <p className="mt-1 text-xs text-slate-500">{r.features.join(' · ')}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="sun" onClick={() => setRoom(r)}>Enquire / book a visit</Button>
                      <Button variant="outline" to={`/book/${r.id}`}>Book online</Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <section id="enquire" className="mt-10 scroll-mt-16">
          <h2 className="text-xl font-bold">{room ? `Enquire about room ${room.no}` : 'Send an enquiry'}</h2>
          <EnquiryForm room={room} />
        </section>
      </div>
    </>
  )
}

function EnquiryForm({ room }) {
  const [v, setV] = useState({ name: '', phone: '', email: '', move_in: '', budget: '', message: '' })
  const [state, setState] = useState({ busy: false, done: false, error: '' })
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    if (!isConfigured) { window.open(whatsappUrl(`Hi, I am ${v.name}. ${v.message}`), '_blank', 'noopener'); return }
    setState({ busy: true, done: false, error: '' })
    try {
      await submitEnquiry({ ...v, room_type: room ? `Room ${room.no} (${room.type})` : '', source: 'website', campaign_code: campaignCode() })
      setState({ busy: false, done: true, error: '' })
    } catch (x) { setState({ busy: false, done: false, error: x.message }) }
  }
  if (state.done) return <div className="mt-4"><Notice tone="ok">Thanks {v.name}! We have your enquiry and will call you on {v.phone} soon.</Notice></div>
  return (
    <form onSubmit={submit} className="mt-4 grid gap-4 rounded-2xl border border-navy/10 bg-white p-5 sm:grid-cols-2">
      <Field label="Your name"><input className={inputCls} required value={v.name} onChange={set('name')} autoComplete="name" /></Field>
      <Field label="Mobile number"><input className={inputCls} required inputMode="tel" pattern="[+0-9 ]{10,15}" value={v.phone} onChange={set('phone')} autoComplete="tel" /></Field>
      <Field label="Email (optional)"><input type="email" className={inputCls} value={v.email} onChange={set('email')} autoComplete="email" /></Field>
      <Field label="Move-in date"><input type="date" min={todayInput()} className={inputCls} value={v.move_in} onChange={set('move_in')} /></Field>
      <Field label="Budget per month (₹, optional)"><input inputMode="numeric" className={inputCls} value={v.budget} onChange={set('budget')} /></Field>
      <div className="sm:col-span-2"><Field label="Anything else? (preferred visit time, food, AC…)"><textarea className={inputCls} rows={3} maxLength={2000} value={v.message} onChange={set('message')} /></Field></div>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2"><Button type="submit" variant="sun" disabled={state.busy}>{state.busy ? 'Sending…' : 'Send enquiry'}</Button></div>
    </form>
  )
}
