import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import useCatalog from '../hooks/useCatalog'
import { availability, priceLabel } from '../services/catalog'
import { bookRoom } from '../services/api'
import { rupees } from '../services/format'
import { Button, Card, ErrorBox, Field, Notice, PageHeader, Spinner, inputCls } from '../components/ui'
import Img from '../components/Img'

const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => iso(new Date(new Date(s).getTime() + n * 86400000))

export default function Book() {
  const { roomId } = useParams()
  const { configured, loading: authLoading, user, role } = useAuth()
  const { data, error, loading, reload } = useCatalog()
  const navigate = useNavigate()
  const today = iso(new Date())
  const [beds, setBeds] = useState(1)
  const [checkIn, setCheckIn] = useState(today)
  const [checkOut, setCheckOut] = useState(addDays(today, 1))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  if (!configured) return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="warn">Booking is not available until Supabase is configured.</Notice></div>
  if (authLoading || loading) return <Spinner />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(`/book/${roomId}`)}`} replace />
  if (role !== 'customer') return <div className="mx-auto max-w-md px-4 py-16"><Notice tone="warn">Only customer accounts can book. Staff accounts manage bookings from their dashboards.</Notice></div>
  if (error) return <div className="mx-auto max-w-2xl px-4 py-10"><ErrorBox error={error} onRetry={reload} /></div>

  const room = data.rooms.find((r) => r.id === roomId)
  if (!room) return <div className="mx-auto max-w-md px-4 py-16"><Notice>That room does not exist. <Link className="underline" to="/rooms">See all rooms</Link></Notice></div>

  const a = availability(room)
  const nightly = room.billing === 'night'
  const units = room.rentBasis === 'room' ? 1 : beds
  const nights = nightly ? Math.max(0, Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000)) : 1
  // Display only: the database recomputes the real amounts from its own price list.
  const rent = room.price * units * nights
  const deposit = room.deposit * units

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setProblem('')
    try {
      await bookRoom({ roomId: room.id, bedCount: beds, checkIn, checkOut: nightly ? checkOut : null })
      navigate('/account', { state: { justBooked: true } })
    } catch (err) {
      setProblem(err.message)
      reload() // someone may have taken the bed: show fresh availability
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title={`Book room ${room.no}`} />
      <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-8 text-navy md:grid-cols-2">
        <Card className="overflow-hidden !p-0">
          <Img src={room.image} alt={`Room ${room.no}`} className="h-48 w-full object-cover" />
          <div className="p-5">
            <p className="font-semibold">{priceLabel(room)}</p>
            <p className="text-sm text-slate-600">{room.type} · Floor {room.floor} · {a.free ?? '?'} of {a.total} beds free</p>
          </div>
        </Card>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-navy/10 bg-white p-5">
          {room.rentBasis === 'bed' ? (
            <Field label="Number of beds">
              <select className={inputCls} value={beds} onChange={(e) => setBeds(Number(e.target.value))}>
                {Array.from({ length: Math.max(1, Math.min(a.free || 1, 4)) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          ) : (
            <p className="text-sm text-slate-600">This room is rented as a whole, so the booking takes all {a.total} beds.</p>
          )}
          <Field label="Check-in">
            <input className={inputCls} type="date" min={today} required value={checkIn} onChange={(e) => { setCheckIn(e.target.value); if (checkOut <= e.target.value) setCheckOut(addDays(e.target.value, 1)) }} />
          </Field>
          {nightly && (
            <Field label="Check-out">
              <input className={inputCls} type="date" min={addDays(checkIn, 1)} required value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </Field>
          )}

          <dl className="space-y-1 rounded-xl bg-cream p-3 text-sm">
            <div className="flex justify-between"><dt>{nightly ? `Rent (${nights} night${nights === 1 ? '' : 's'})` : 'First month rent'}</dt><dd>{rupees(rent)}</dd></div>
            {deposit > 0 && <div className="flex justify-between"><dt>Security deposit</dt><dd>{rupees(deposit)}</dd></div>}
            <div className="flex justify-between border-t border-navy/10 pt-1 font-semibold"><dt>Due now</dt><dd>{rupees(rent + deposit)}</dd></div>
          </dl>
          <p className="text-xs text-slate-500">Your beds are held for 30 minutes. Pay from your dashboard to confirm.</p>

          {problem && <p role="alert" className="text-sm text-red-700">{problem}</p>}
          <Button type="submit" variant="sun" className="w-full" disabled={busy || a.bookable === false || (nightly && nights < 1)}>
            {busy ? 'Booking…' : a.bookable === false ? 'Not available' : 'Reserve beds'}
          </Button>
        </form>
      </div>
    </>
  )
}
