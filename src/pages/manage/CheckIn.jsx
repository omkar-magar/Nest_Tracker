import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useAsync from '../../hooks/useAsync'
import { ActionMsg, FileButton, FormFields, H3, useAction, useScope } from '../../components/manage/kit'
import { RegisterTenant } from './Tenants'
import { Button, Card, ErrorBox, Field, Notice, TableSkeleton, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { BED_STATES, addDays, bedState, label, ymd } from '../../services/pg'
import { rupees } from '../../services/format'

// PRD 3.3 check-in: property > room > vacant bed > tenant > rent > deposit > agreement > confirm. The bed turns
// Occupied, the deposit is recorded and the first (pro-rata) invoice is created by check_in_tenant().
export default function CheckIn() {
  const { property, properties } = useScope()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [pid, setPid] = useState(property || properties[0]?.id || 'P1')
  const data = useAsync(() => Promise.all([m.loadRoomsWithBeds(pid), m.loadTenants(), m.loadReservations()]), [pid])
  const preBed = params.get('bed')
  const [roomId, setRoomId] = useState('')
  const [beds, setBeds] = useState(preBed ? [preBed] : [])
  const [tenant, setTenant] = useState(params.get('tenant') ?? '')
  const [registering, setRegistering] = useState(false)
  const [f, setF] = useState({ check_in: ymd(), rent: '', deposit: '', deposit_paid: true, deposit_mode: 'upi', deposit_reference: '',
    expected_checkout: '', check_out: '', notice_period_days: 30, lock_in_months: 0, offer_code: '', agreement: 'generate', agreement_end: addDays(ymd(), 334) })
  const [agreementDoc, setAgreementDoc] = useState(null)
  const [offerMsg, setOfferMsg] = useState('')
  const a = useAction()
  const reservationId = params.get('reservation')

  const view = useMemo(() => {
    if (!data.data) return null
    const [rooms, tenants, resv] = data.data
    const mine = (b) => resv.find((r) => r.bed_id === b.id && (r.id === reservationId || (tenant && r.customer_id === tenant)))
    const usable = (b) => bedState(b) === 'vacant' || (bedState(b) === 'reserved' && mine(b))
    const preRoom = preBed && rooms.find((r) => r.beds.some((b) => b.id === preBed))
    return { rooms: rooms.filter((r) => r.is_active && r.beds.some(usable)), tenants: tenants.filter((t) => !t.bookings.some((b) => ['active', 'pending'].includes(b.status))), usable, preRoom }
  }, [data.data, reservationId, tenant, preBed])

  if (data.loading) return <TableSkeleton />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const room = view.rooms.find((r) => r.id === (roomId || view.preRoom?.id))
  const units = room ? (room.rent_basis === 'room' ? 1 : beds.length) : 0
  const defaultRent = room ? (room.rent_basis === 'bed' ? Math.max(...room.beds.filter((b) => beds.includes(b.id)).map((b) => b.rent ?? room.price), 0) || room.price : room.price) : 0
  const tenantRow = view.tenants.find((t) => t.id === tenant)

  const pickRoom = (id) => {
    setRoomId(id)
    const r = view.rooms.find((x) => x.id === id)
    setBeds(r?.rent_basis === 'room' ? r.beds.filter((b) => b.is_active).map((b) => b.id) : [])
  }
  const toggleBed = (id) => setBeds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  const checkOffer = async () => {
    setOfferMsg('')
    try {
      const o = await m.checkOffer(f.offer_code, pid, f.check_in, f.lock_in_months)
      setOfferMsg(`✓ ${o.description} (${o.kind === 'percent' ? `${o.value}%` : rupees(o.value)} off the first rent)`)
    } catch (e) { setOfferMsg(e.message) }
  }

  const submit = async (e) => {
    e.preventDefault()
    const id = await a.run(async () => {
      if (!room || !beds.length) throw new Error('Choose a room and at least one bed')
      if (!tenant) throw new Error('Choose or register the tenant')
      let agreementDocumentId = null
      if (f.agreement === 'upload') {
        if (!agreementDoc) throw new Error('Choose the signed agreement PDF, or pick another agreement option')
        agreementDocumentId = (await m.uploadTenantDocument(tenant, agreementDoc, { docType: 'agreement' })).id
      }
      return m.checkIn({
        customer_id: tenant, bed_ids: beds, check_in: f.check_in, rent: f.rent || defaultRent, deposit: f.deposit === '' ? room.deposit * units : f.deposit,
        deposit_paid: f.deposit_paid, deposit_mode: f.deposit_mode, deposit_reference: f.deposit_reference,
        expected_checkout: f.expected_checkout, check_out: f.check_out, notice_period_days: f.notice_period_days, lock_in_months: f.lock_in_months,
        offer_code: f.offer_code, reservation_id: reservationId, enquiry_id: params.get('enquiry'),
        agreement_document_id: agreementDocumentId, agreement_end: f.agreement === 'none' ? '' : f.agreement_end,
      })
    })
    if (id) navigate(`/admin/tenants/${tenant}`, { state: { checkedIn: true } })
  }

  return (
    <>
    <form onSubmit={submit} className="space-y-6">
      <h2 className="text-xl font-bold">Check in a tenant</h2>
      <Card>
        <H3>1. Property, room and bed</H3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Property">
            <select className={inputCls} value={pid} onChange={(e) => { setPid(e.target.value); setRoomId(''); setBeds([]) }}>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}
            </select>
          </Field>
          <Field label="Room (rooms with a free bed)">
            <select className={inputCls} value={room?.id ?? ''} onChange={(e) => pickRoom(e.target.value)} required>
              <option value="">Choose a room</option>
              {view.rooms.map((r) => <option key={r.id} value={r.id}>Floor {r.floor} · Room {r.room_no} · {label(r.room_type)} · {r.ac_type} · {rupees(r.price)}/{r.billing_period}</option>)}
            </select>
          </Field>
        </div>
        {room && (
          <fieldset className="mt-3">
            <legend className="text-sm font-medium">Bed(s){room.rent_basis === 'room' && ' — this room is let as a whole'}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {room.beds.filter((b) => b.is_active).map((b) => {
                const ok = view.usable(b)
                return (
                  <label key={b.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${BED_STATES[bedState(b)].cls} ${ok ? 'cursor-pointer' : 'opacity-60'}`}>
                    <input type="checkbox" disabled={!ok || room.rent_basis === 'room'} checked={beds.includes(b.id)} onChange={() => toggleBed(b.id)} />
                    {b.code} · {rupees(b.rent ?? room.price)}
                  </label>
                )
              })}
            </div>
          </fieldset>
        )}
      </Card>

      <Card>
        <H3>2. Tenant</H3>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Registered tenant without a current stay">
            <select className={inputCls} value={tenant} onChange={(e) => setTenant(e.target.value)}>
              <option value="">Choose a tenant</option>
              {view.tenants.map((t) => <option key={t.id} value={t.id}>{t.full_name} · {t.phone}{t.tenant_profiles?.emergency1_name ? '' : ' (emergency contact missing)'}</option>)}
            </select>
          </Field>
          <Button variant="outline" onClick={() => setRegistering(true)}>Register new tenant</Button>
        </div>
        {tenantRow && !tenantRow.tenant_profiles?.emergency1_name && <div className="mt-3"><Notice tone="warn">Add this tenant's emergency contact on their page before check-in.</Notice></div>}
      </Card>

      <Card>
        <H3>3. Rent, deposit and terms</H3>
        <FormFields value={f} onChange={setF} fields={[
          { key: 'check_in', label: 'Check-in date', type: 'date', required: true },
          { key: 'rent', label: `Rent per ${room?.rent_basis === 'room' ? 'room' : 'bed'} (₹ / ${room?.billing_period ?? 'month'})`, type: 'number', min: 1, help: `Default ${rupees(defaultRent)}` },
          ...(room?.billing_period === 'night' ? [{ key: 'check_out', label: 'Check-out date', type: 'date', required: true }] : [
            { key: 'expected_checkout', label: 'Expected check-out (optional)', type: 'date' },
            { key: 'notice_period_days', label: 'Notice period (days)', type: 'number', min: 0, max: 180 },
            { key: 'lock_in_months', label: 'Lock-in (months)', type: 'number', min: 0, max: 36 },
          ]),
          { key: 'deposit', label: 'Security deposit (₹)', type: 'number', min: 0, help: room ? `Default ${rupees(room.deposit * units)}` : undefined },
          { key: 'deposit_paid', label: 'Deposit received now (otherwise a deposit invoice is raised)', type: 'checkbox', span: true },
          { key: 'deposit_mode', label: 'Deposit paid by', type: 'select', options: ['cash', 'upi', 'bank_transfer', 'cheque'], hidden: (v) => !v.deposit_paid },
          { key: 'deposit_reference', label: 'Reference / UTR', hidden: (v) => !v.deposit_paid },
          { key: 'offer_code', label: 'Offer code (optional)' },
        ]} />
        {f.offer_code && <div className="mt-2 flex items-center gap-3"><Button variant="outline" className="!py-1" onClick={checkOffer}>Check offer</Button><span role="status" className="text-sm">{offerMsg}</span></div>}
      </Card>

      <Card>
        <H3>4. Rental agreement</H3>
        <FormFields value={f} onChange={setF} fields={[
          { key: 'agreement', label: 'Agreement', type: 'select', required: true, options: [['generate', 'Generate from template (tenant accepts in the app)'], ['upload', 'Upload the signed PDF'], ['none', 'Add later']] },
          { key: 'agreement_end', label: 'Agreement end date', type: 'date', hidden: (v) => v.agreement === 'none' },
        ]} />
        {f.agreement === 'upload' && (
          <div className="mt-3 flex items-center gap-3">
            <FileButton label="Choose signed PDF" accept="application/pdf" onFile={setAgreementDoc} />
            <span className="text-sm">{agreementDoc?.name}</span>
          </div>
        )}
      </Card>

      <Card>
        <H3>5. Confirm</H3>
        <p className="text-sm">
          {tenantRow?.full_name ?? 'Tenant'} → {room ? `Room ${room.room_no}` : 'room'} ({beds.length} bed{beds.length === 1 ? '' : 's'}) from {f.check_in}.
          Rent {rupees(f.rent || defaultRent)} × {units || 0}; deposit {rupees(f.deposit === '' ? (room?.deposit ?? 0) * units : f.deposit)}{f.deposit_paid ? ' received' : ' to be invoiced'}.
        </p>
        <div className="mt-3"><ActionMsg action={a} /></div>
        <Button type="submit" variant="sun" className="mt-3" disabled={a.busy}>{a.busy ? 'Checking in…' : 'Confirm check-in'}</Button>
      </Card>
    </form>
    {registering && <RegisterTenant onClose={() => setRegistering(false)} onDone={(id) => { setRegistering(false); setTenant(id); data.reload() }} />}
    </>
  )
}
