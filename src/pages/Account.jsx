import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import useAsync from '../hooks/useAsync'
import PayModal from '../components/PayModal'
import { Badge, Button, Card, Empty, ErrorBox, Field, Notice, Spinner, Stat, Table, inputCls } from '../components/ui'
import { billLabel, daysOverdue, summarize } from '../services/billing'
import { cancelBooking, deleteDocument, documentUrl, loadMyAccount, submitReview, updateMyProfile, uploadDocument } from '../services/api'
import { formatDate, formatDateTime, rupees } from '../services/format'

const DOC_TYPES = { id_proof: 'ID proof', address_proof: 'Address proof', photo: 'Photo', agreement: 'Agreement', other: 'Other' }
const billTone = { Paid: 'green', Due: 'amber', Overdue: 'red', Void: 'gray' }

function BookingCard({ booking, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const beds = booking.booking_beds.filter((b) => b.active).map((b) => b.beds.label).join(', ')
  const cancel = async () => {
    if (!window.confirm('Cancel this booking? Unpaid bills will be voided.')) return
    setBusy(true)
    try { await cancelBooking(booking.id); onChanged() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">Room {booking.rooms.room_no} · Floor {booking.rooms.floor}</h3>
          <p className="text-sm text-slate-600">{booking.rooms.ac_type}{beds && ` · Bed ${beds}`}</p>
        </div>
        <Badge tone={booking.status === 'active' ? 'green' : booking.status === 'pending' ? 'amber' : 'gray'}>{booking.status}</Badge>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {formatDate(booking.check_in)}{booking.check_out ? ` to ${formatDate(booking.check_out)}` : ' onwards'} · {rupees(booking.rate)} per {booking.billing_period}
      </p>
      {booking.status === 'pending' && booking.hold_expires_at && (
        <p className="mt-2 text-sm text-gold-deep">Beds held until {formatDateTime(booking.hold_expires_at)}. Pay the bills below to confirm.</p>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
      {booking.status === 'pending' && <Button variant="danger" className="mt-3" onClick={cancel} disabled={busy}>Cancel booking</Button>}
    </Card>
  )
}

function Documents({ docs, userId, bookingId, onChanged }) {
  const [type, setType] = useState('id_proof')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const upload = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setErr('')
    try { await uploadDocument(userId, file, type, bookingId); onChanged() } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const open = async (d) => {
    try { window.open(await documentUrl(d.file_path), '_blank', 'noopener') } catch (x) { setErr(x.message) }
  }
  const remove = async (d) => {
    if (!window.confirm(`Delete ${d.file_name}?`)) return
    try { await deleteDocument(d); onChanged() } catch (x) { setErr(x.message) }
  }
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Document type">
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <label className={`inline-flex cursor-pointer items-center rounded-full bg-navy px-5 py-2 text-sm font-semibold text-white focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy ${busy ? 'opacity-50' : ''}`}>
          {busy ? 'Uploading…' : 'Upload file'}
          <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={upload} disabled={busy} />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500">JPG, PNG, WebP or PDF, up to 5 MB. Only you and the owner can open these.</p>
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
      {docs.length === 0 ? <p className="mt-4 text-sm text-slate-600">No documents uploaded yet.</p> : (
        <ul className="mt-4 divide-y divide-navy/5">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span><Badge>{DOC_TYPES[d.doc_type]}</Badge> {d.file_name}</span>
              <span className="flex gap-2">
                <button className="font-medium underline" onClick={() => open(d)}>View</button>
                <button className="font-medium text-red-700 underline" onClick={() => remove(d)}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ReviewBox({ existing, hasStay, userId, name, onChanged }) {
  const [rating, setRating] = useState(5)
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')
  if (existing) {
    return <Notice tone="ok">Thanks for your review. {existing.status === 'published' ? 'It is live on the site.' : existing.status === 'rejected' ? 'It was not published.' : 'It will appear once the owner approves it.'}</Notice>
  }
  if (!hasStay) return <Notice>You can leave a review once your stay has started.</Notice>
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    try { await submitReview(userId, name, rating, body.trim()); onChanged() } catch (x) { setErr(x.message) }
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-navy/10 bg-white p-5">
      <Field label="Rating">
        <select className={inputCls} value={rating} onChange={(e) => setRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 && 's'}</option>)}
        </select>
      </Field>
      <Field label="Your review"><textarea className={inputCls} rows={3} required minLength={10} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <Button type="submit">Submit review</Button>
    </form>
  )
}

function ProfileForm({ profile, onSaved }) {
  const [name, setName] = useState(profile.full_name)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [msg, setMsg] = useState('')
  const save = async (e) => {
    e.preventDefault()
    try { await updateMyProfile(profile.id, { full_name: name.trim(), phone }); setMsg('Saved'); onSaved() } catch (x) { setMsg(x.message) }
  }
  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <Field label="Full name"><input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Mobile number"><input className={inputCls} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit">Save</Button>
        <span role="status" className="text-sm text-slate-600">{msg}</span>
      </div>
    </form>
  )
}

const H2 = ({ children }) => <h2 className="mb-3 mt-10 text-xl font-bold">{children}</h2>

export default function Account() {
  const { user, profile, refreshProfile } = useAuth()
  const { state } = useLocation()
  const { data, error, loading, reload } = useAsync(() => loadMyAccount(user.id), [user.id])
  const [paying, setPaying] = useState(null)

  if (loading) return <Spinner label="Loading your dashboard" />
  if (error) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorBox error={error} onRetry={reload} /></div>

  const live = data.bookings.find((b) => b.status === 'active' || b.status === 'pending')
  const past = data.bookings.filter((b) => b !== live)
  const sum = summarize(data.bills, data.payments)
  const hasStay = data.bookings.some((b) => ['active', 'completed'].includes(b.status))

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 text-navy">
      <h1 className="text-2xl font-bold">Hi {profile?.full_name || 'there'}</h1>
      {state?.justBooked && <div className="mt-4"><Notice tone="ok">Your beds are reserved. Pay the bills below to confirm your booking.</Notice></div>}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Amount paid" value={rupees(sum.amountPaid)} />
        <Stat label="Outstanding" value={rupees(sum.outstanding)} tone={sum.overdue.length ? 'red' : undefined} hint={sum.overdue.length ? `${sum.overdue.length} overdue` : undefined} />
        <Stat label="Next bill" value={sum.nextBill ? rupees(sum.nextBill.amount) : '—'} />
        <Stat label="Next due date" value={sum.nextBill ? formatDate(sum.nextBill.due_date) : '—'} tone={sum.overdue.length ? 'red' : undefined} />
      </div>

      <H2>Current booking</H2>
      {live ? <BookingCard booking={live} onChanged={reload} /> : <Empty title="No current booking">Find a room on the <Link className="underline" to="/rooms">Rooms page</Link>.</Empty>}

      <H2>Bills</H2>
      {sum.nextBill && <div className="mb-3"><Button variant="sun" onClick={() => setPaying(sum.nextBill)}>Pay next bill · {rupees(sum.nextBill.amount)}</Button></div>}
      {data.bills.length === 0 ? <Empty title="No bills yet" /> : (
        <Table head={['Description', 'Amount', 'Due', 'Status', '']}>
          {data.bills.map((b) => (
            <tr key={b.id}>
              <td className="px-4 py-3">{b.description}</td>
              <td className="px-4 py-3">{rupees(b.amount)}</td>
              <td className="px-4 py-3">{formatDate(b.due_date)}{daysOverdue(b) > 0 && <span className="block text-xs text-red-700">{daysOverdue(b)} days late</span>}</td>
              <td className="px-4 py-3"><Badge tone={billTone[billLabel(b)]}>{billLabel(b)}</Badge></td>
              <td className="px-4 py-3 text-right">{b.status === 'unpaid' && <Button variant="outline" className="!py-1" onClick={() => setPaying(b)}>Pay</Button>}</td>
            </tr>
          ))}
        </Table>
      )}

      <H2>Payment history</H2>
      {data.payments.length === 0 ? <Empty title="No payments yet" /> : (
        <Table head={['Date', 'For', 'Amount', 'Method', 'Result']}>
          {data.payments.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3">{formatDateTime(p.created_at)}</td>
              <td className="px-4 py-3">{p.bills?.description}</td>
              <td className="px-4 py-3">{rupees(p.amount)}</td>
              <td className="px-4 py-3">{p.is_simulated ? <Badge tone="amber">Demo (simulated)</Badge> : p.provider}</td>
              <td className="px-4 py-3"><Badge tone={p.status === 'succeeded' ? 'green' : p.status === 'failed' ? 'red' : 'gray'}>{p.status}</Badge></td>
            </tr>
          ))}
        </Table>
      )}

      <H2>Documents</H2>
      <Documents docs={data.documents} userId={user.id} bookingId={live?.id} onChanged={reload} />

      {past.length > 0 && (
        <>
          <H2>Booking history</H2>
          <Table head={['Room', 'Dates', 'Status']}>
            {past.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-3">Room {b.rooms.room_no}</td>
                <td className="px-4 py-3">{formatDate(b.check_in)}{b.check_out ? ` to ${formatDate(b.check_out)}` : ''}</td>
                <td className="px-4 py-3"><Badge>{b.status}</Badge></td>
              </tr>
            ))}
          </Table>
        </>
      )}

      <H2>Your details</H2>
      <Card><ProfileForm profile={profile} onSaved={refreshProfile} /></Card>

      <H2>Leave a review</H2>
      <ReviewBox existing={data.review} hasStay={hasStay} userId={user.id} name={profile?.full_name || 'Resident'} onChanged={reload} />

      {paying && <PayModal bill={paying} onClose={() => setPaying(null)} onFinished={reload} />}
    </div>
  )
}
