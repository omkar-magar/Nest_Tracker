import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import useAsync from '../../hooks/useAsync'
import { ActionMsg, Fact, FileButton, FormFields, H3, Modal, Small, StatusBadge, Tabs, useAction } from '../../components/manage/kit'
import DataTable from '../../components/manage/DataTable'
import ContactButtons from '../../components/dashboard/ContactButtons'
import { TENANT_FIELDS, tenantFormValue, validateTenant } from '../../components/manage/tenantFields'
import { Badge, Button, Card, ErrorBox, Notice, TableSkeleton, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { CHARGE_KINDS, ID_TYPES, INVOICE_TONES, PAY_MODES, addDays, bedState, invoiceState, label, maskId, owed, ymd } from '../../services/pg'
import { agreementPdf, invoicePdf, receiptPdf } from '../../services/pdfDocs'
import { formatDate, formatDateTime, rupees } from '../../services/format'

export default function TenantDetail() {
  const { id } = useParams()
  const { state } = useLocation()
  const t = useAsync(() => m.loadTenant(id), [id])
  const [tab, setTab] = useState('stay')
  if (t.loading) return <TableSkeleton />
  if (t.error) return <ErrorBox error={t.error} onRetry={t.reload} />
  const d = t.data
  const p = d.profile
  const tp = p.tenant_profiles ?? {}
  const stay = d.bookings.find((b) => ['active', 'pending'].includes(b.status))
  const due = d.bills.reduce((s, b) => s + owed(b), 0)
  const credit = d.credits.reduce((s, c) => s + c.amount, 0)
  return (
    <div>
      <Link to="/admin/tenants" className="text-sm underline">← All tenants</Link>
      {state?.checkedIn && <div className="mt-3"><Notice tone="ok">Checked in. The bed is now occupied and the first invoice is ready.</Notice></div>}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{p.full_name}</h2>
          <p className="text-sm text-slate-600">{p.phone} · {tp.email || 'no email'}{stay ? ` · Room ${stay.rooms.room_no}` : ''}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge value={tp.approval_status ?? 'pending'} /> <Badge>Police: {label(tp.police_status ?? 'pending')}</Badge>
            {tp.risk_flag && <Badge tone="red">Repeat late payer</Badge>}
            {due > 0 && <Badge tone="red">Due {rupees(due)}</Badge>}
            {credit > 0 && <Badge tone="green">Credit {rupees(credit)}</Badge>}
          </div>
        </div>
        <ContactButtons phone={p.phone} name={p.full_name} />
      </div>
      <div className="mt-5">
        <Tabs tab={tab} onTab={setTab} tabs={[['stay', 'Stay'], ['invoices', 'Invoices & payments'], ['profile', 'Profile'], ['documents', 'Documents'],
          ['agreement', 'Agreement'], ['complaints', 'Complaints']]} />
        {tab === 'stay' && <StayTab d={d} stay={stay} reload={t.reload} />}
        {tab === 'invoices' && <InvoicesTab d={d} stay={stay} reload={t.reload} />}
        {tab === 'profile' && <ProfileTab p={p} reload={t.reload} />}
        {tab === 'documents' && <DocumentsTab d={d} customerId={id} stay={stay} reload={t.reload} />}
        {tab === 'agreement' && <AgreementTab d={d} stay={stay} customerId={id} reload={t.reload} />}
        {tab === 'complaints' && (
          <DataTable title="Complaints" rows={d.complaints} columns={[
            { key: 'ticket_no', label: '#', render: (c) => <Link className="underline" to={`/admin/complaints?open=${c.id}`}>#{c.ticket_no}</Link>, value: (c) => c.ticket_no },
            { key: 'title', label: 'Issue' }, { key: 'status', label: 'Status', render: (c) => <StatusBadge value={c.status} /> },
            { key: 'created_at', label: 'Raised', render: (c) => formatDate(c.created_at) }, { key: 'cost', label: 'Cost', render: (c) => rupees(c.cost) },
          ]} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- profile, approval, police verification
function ProfileTab({ p, reload }) {
  const tp = p.tenant_profiles ?? {}
  const [v, setV] = useState(() => tenantFormValue(p))
  const [police, setPolice] = useState({ status: tp.police_status ?? 'pending', ref: tp.police_ref ?? '', date: tp.police_submitted_on ?? '' })
  const [note, setNote] = useState('')
  const a = useAction()
  const save = async (e) => {
    e.preventDefault()
    const bad = validateTenant(v)
    if (bad) return a.run(() => Promise.reject(new Error(bad)))
    if (await a.run(() => m.saveTenant(p.id, { ...v, property_id: tp.property_id }), 'Saved')) reload()
  }
  return (
    <div className="space-y-6">
      <Card>
        <H3>Registration approval</H3>
        <p className="text-sm">Status: <StatusBadge value={tp.approval_status ?? 'pending'} /> {tp.approval_note && `· ${tp.approval_note}`}</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input className={`${inputCls} !w-64`} placeholder="Note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Approval note" />
          <Button onClick={async () => (await a.run(() => m.setApproval(p.id, 'approved', note), 'Approved')) && reload()}>Approve</Button>
          <Button variant="danger" onClick={async () => (await a.run(() => m.setApproval(p.id, 'rejected', note), 'Rejected')) && reload()}>Reject</Button>
        </div>
      </Card>
      <Card>
        <H3>Police verification</H3>
        <FormFields value={police} onChange={setPolice} fields={[
          { key: 'status', label: 'Status', type: 'select', required: true, options: ['pending', 'submitted', 'verified', 'rejected', 'not_required'] },
          { key: 'ref', label: 'Form / reference number' }, { key: 'date', label: 'Submitted on', type: 'date' },
        ]} />
        <Button className="mt-3" onClick={async () => (await a.run(() => m.setPolice(p.id, police.status, police.ref, police.date), 'Saved')) && reload()}>Save verification</Button>
      </Card>
      <form onSubmit={save}>
        <Card>
          <H3>Details</H3>
          <FormFields fields={TENANT_FIELDS} value={v} onChange={setV} />
          <Button type="submit" className="mt-4" disabled={a.busy}>Save details</Button>
        </Card>
      </form>
      <ActionMsg action={a} />
    </div>
  )
}

// ---------------------------------------------------------------- documents (PRD 3.2)
function DocumentsTab({ d, customerId, stay, reload }) {
  const [meta, setMeta] = useState({ docType: 'id_proof', idType: 'aadhaar', side: 'front', idNumber: '' })
  const [reject, setReject] = useState(null)
  const a = useAction()
  const upload = (file) => a.run(async () => {
    const last4 = String(meta.idNumber).replace(/[^0-9A-Za-z]/g, '').slice(-4)
    await m.uploadTenantDocument(customerId, file, { ...meta, last4: last4.length === 4 ? last4 : null, bookingId: stay?.id })
    setMeta((x) => ({ ...x, idNumber: '' }))
    reload()
  }, 'Uploaded')
  const open = (doc) => a.run(async () => window.open(await m.fileUrl('customer-documents', doc.file_path), '_blank', 'noopener'))
  return (
    <div className="space-y-4">
      <Card>
        <FormFields value={meta} onChange={setMeta} fields={[
          { key: 'docType', label: 'Document', type: 'select', required: true, options: ['id_proof', 'address_proof', 'photo', 'police_verification', 'agreement', 'payment_proof', 'other'] },
          { key: 'idType', label: 'ID type', type: 'select', options: ID_TYPES, hidden: (v) => v.docType !== 'id_proof' },
          { key: 'side', label: 'Side', type: 'select', required: true, options: ['front', 'back', 'single'] },
          { key: 'idNumber', label: 'ID number (only the last 4 digits are kept)', hidden: (v) => v.docType !== 'id_proof', help: 'Type it to store the last 4 digits for listings.' },
        ]} />
        <div className="mt-3 flex items-center gap-3"><FileButton label="Upload image or PDF" onFile={upload} busy={a.busy} /><ActionMsg action={a} /></div>
        <p className="mt-2 text-xs text-slate-500">Stored in a private, encrypted bucket. Only this tenant, their property manager and the owner can open them.</p>
      </Card>
      <DataTable title="Documents" rows={d.docs} columns={[
        { key: 'doc_type', label: 'Type', value: (x) => label(x.id_type || x.doc_type) },
        { key: 'side', label: 'Side', value: (x) => label(x.side) },
        { key: 'id_last4', label: 'ID number', value: (x) => maskId(x.id_last4) },
        { key: 'file_name', label: 'File' },
        { key: 'status', label: 'Status', render: (x) => <span><StatusBadge value={x.status} />{x.review_note && <span className="block text-xs text-slate-500">{x.review_note}</span>}</span>, value: (x) => x.status },
        { key: 'created_at', label: 'Uploaded', render: (x) => formatDate(x.created_at) },
        { key: 'act', label: '', noExport: true, noSort: true, render: (x) => (
          <span className="flex flex-wrap gap-1">
            <Small onClick={() => open(x)}>View</Small>
            <Small onClick={async () => (await a.run(() => m.reviewDocument(x.id, 'verified'))) && reload()}>Verify</Small>
            <Small onClick={() => setReject(x)}>Reject</Small>
          </span>
        ) },
      ]} />
      {reject && <RejectDoc doc={reject} onClose={() => setReject(null)} onDone={() => { setReject(null); reload() }} />}
    </div>
  )
}

function RejectDoc({ doc, onClose, onDone }) {
  const [note, setNote] = useState('')
  const a = useAction()
  return (
    <Modal title={`Reject ${doc.file_name}`} onClose={onClose}>
      <label className="block text-sm font-medium">Reason (sent to the tenant with a request to upload again)
        <textarea className={`${inputCls} mt-1`} rows={3} required value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <ActionMsg action={a} />
      <Button className="mt-3" variant="danger" disabled={a.busy} onClick={async () => (await a.run(() => m.reviewDocument(doc.id, 'rejected', note))) && onDone()}>Reject and re-request</Button>
    </Modal>
  )
}

// ---------------------------------------------------------------- stay: notice, transfer, check-out, checklist
function StayTab({ d, stay, reload }) {
  const [modal, setModal] = useState('')
  const deposit = stay && d.deposits.find((x) => x.booking_id === stay.id)
  const past = d.bookings.filter((b) => b !== stay)
  return (
    <div className="space-y-6">
      {!stay ? <Notice>No current stay. <Link className="underline" to={`/admin/checkin?tenant=${d.profile.id}`}>Check this tenant in</Link>.</Notice> : (
        <Card>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Fact k="Room / beds">{stay.rooms.room_no} · {stay.booking_beds.filter((b) => b.active).map((b) => b.beds.code).join(', ')}</Fact>
            <Fact k="Rent">{rupees(stay.rate)} / {stay.billing_period}{stay.rooms.rent_basis === 'bed' ? ' per bed' : ''}</Fact>
            <Fact k="Check-in">{formatDate(stay.check_in)}</Fact>
            <Fact k="Expected check-out">{formatDate(stay.expected_checkout || stay.check_out)}</Fact>
            <Fact k="Notice period">{stay.notice_period_days} days</Fact>
            <Fact k="Notice given on">{formatDate(stay.notice_date)}</Fact>
            <Fact k="Lock-in">{stay.lock_in_months} month(s)</Fact>
            <Fact k="Deposit">{deposit ? `${rupees(deposit.received_amount)} of ${rupees(deposit.amount)} · ${label(deposit.status)}` : 'None'}</Fact>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setModal('notice')}>Record notice</Button>
            <Button variant="outline" onClick={() => setModal('transfer')}>Change room / bed</Button>
            <Button variant="outline" onClick={() => setModal('checklist-check_in')}>Check-in checklist</Button>
            <Button variant="outline" onClick={() => setModal('checklist-check_out')}>Check-out checklist</Button>
            {deposit && deposit.received_amount < deposit.amount && <Button variant="outline" onClick={() => setModal('deposit')}>Record deposit</Button>}
            <Button variant="danger" onClick={() => setModal('checkout')}>Check out</Button>
          </div>
        </Card>
      )}
      {d.transfers.length > 0 && (
        <>
          <H3>Room changes</H3>
          <DataTable title="Room changes" search={false} rows={d.transfers} columns={[
            { key: 'transfer_date', label: 'Date', render: (x) => formatDate(x.transfer_date) },
            { key: 'from_beds', label: 'From' }, { key: 'to_beds', label: 'To' },
            { key: 'old_rate', label: 'Rent', value: (x) => `${rupees(x.old_rate)} → ${rupees(x.new_rate)}` }, { key: 'reason', label: 'Reason' },
          ]} />
        </>
      )}
      {d.deposits.length > 0 && (
        <>
          <H3>Security deposits</H3>
          <DataTable title="Deposits" search={false} rows={d.deposits} columns={[
            { key: 'amount', label: 'Agreed', render: (x) => rupees(x.amount) }, { key: 'received_amount', label: 'Received', render: (x) => rupees(x.received_amount) },
            { key: 'received_on', label: 'On', render: (x) => formatDate(x.received_on) }, { key: 'mode', label: 'Mode', value: (x) => label(x.mode) },
            { key: 'status', label: 'Status', render: (x) => <StatusBadge value={x.status} /> },
            { key: 'deductions', label: 'Deductions', value: (x) => x.deductions.map((y) => `${y.description}: ₹${y.amount}`).join('; ') },
            { key: 'refund_amount', label: 'Refunded', value: (x) => (x.refund_amount ? `${rupees(x.refund_amount)} on ${formatDate(x.refunded_on)} (${label(x.refund_mode)})` : '—') },
          ]} />
        </>
      )}
      {past.length > 0 && (
        <>
          <H3>Past stays</H3>
          <DataTable title="Past stays" search={false} rows={past} columns={[
            { key: 'room', label: 'Room', value: (b) => b.rooms.room_no }, { key: 'check_in', label: 'Check-in', render: (b) => formatDate(b.check_in) },
            { key: 'actual_checkout', label: 'Check-out', render: (b) => formatDate(b.actual_checkout || b.check_out) },
            { key: 'rate', label: 'Rent', render: (b) => rupees(b.rate) }, { key: 'status', label: 'Status', render: (b) => <StatusBadge value={b.status} /> },
          ]} />
        </>
      )}
      {modal === 'notice' && <NoticeModal stay={stay} onClose={() => setModal('')} onDone={() => { setModal(''); reload() }} />}
      {modal === 'transfer' && <TransferModal stay={stay} onClose={() => setModal('')} onDone={() => { setModal(''); reload() }} />}
      {modal === 'checkout' && <CheckoutModal stay={stay} onClose={() => setModal('')} onDone={() => { setModal(''); reload() }} />}
      {modal === 'deposit' && <DepositModal stay={stay} deposit={deposit} onClose={() => setModal('')} onDone={() => { setModal(''); reload() }} />}
      {modal.startsWith('checklist-') && <ChecklistModal stay={stay} kind={modal.slice(10)} existing={d.checklists.find((c) => c.booking_id === stay.id && c.kind === modal.slice(10))}
        customerId={d.profile.id} onClose={() => setModal('')} onDone={() => { setModal(''); reload() }} />}
    </div>
  )
}

function NoticeModal({ stay, onClose, onDone }) {
  const [v, setV] = useState({ notice: ymd(), out: addDays(ymd(), stay.notice_period_days) })
  const a = useAction()
  return (
    <Modal title="Record notice to vacate" onClose={onClose}>
      <FormFields value={v} onChange={setV} fields={[{ key: 'notice', label: 'Notice given on', type: 'date', required: true }, { key: 'out', label: 'Planned check-out', type: 'date', required: true }]} />
      <ActionMsg action={a} />
      <Button className="mt-3" disabled={a.busy} onClick={async () => (await a.run(() => m.giveNotice(stay.id, v.out, v.notice))) && onDone()}>Save</Button>
    </Modal>
  )
}

function TransferModal({ stay, onClose, onDone }) {
  const rooms = useAsync(() => m.loadRoomsWithBeds(null), [])
  const [roomId, setRoomId] = useState('')
  const [beds, setBeds] = useState([])
  const [v, setV] = useState({ date: ymd(), rate: '', reason: '' })
  const a = useAction()
  const mine = new Set(stay.booking_beds.filter((b) => b.active).map((b) => b.bed_id))
  const list = (rooms.data ?? []).filter((r) => r.is_active && r.beds.some((b) => bedState(b) === 'vacant' || mine.has(b.id)))
  const room = list.find((r) => r.id === roomId)
  return (
    <Modal title="Change room / bed" onClose={onClose}>
      <label className="block text-sm font-medium">New room
        <select className={`${inputCls} mt-1`} value={roomId} onChange={(e) => { setRoomId(e.target.value); setBeds([]) }}>
          <option value="">Choose</option>
          {list.map((r) => <option key={r.id} value={r.id}>{r.property_id} · Room {r.room_no} · {rupees(r.price)}</option>)}
        </select>
      </label>
      {room && (
        <div className="mt-3 flex flex-wrap gap-2">
          {room.beds.filter((b) => bedState(b) === 'vacant' || mine.has(b.id)).map((b) => (
            <label key={b.id} className="flex items-center gap-1 rounded-xl border border-navy/20 px-2 py-1 text-sm">
              <input type="checkbox" checked={beds.includes(b.id)} onChange={() => setBeds((x) => (x.includes(b.id) ? x.filter((y) => y !== b.id) : [...x, b.id]))} />{b.code}
            </label>
          ))}
        </div>
      )}
      <div className="mt-3"><FormFields value={v} onChange={setV} fields={[
        { key: 'date', label: 'Effective date', type: 'date', required: true },
        { key: 'rate', label: 'New rent (blank = the new bed\'s rent)', type: 'number', min: 1 },
        { key: 'reason', label: 'Reason', span: true },
      ]} /></div>
      <p className="mt-2 text-xs text-slate-500">The rent difference for the rest of this billing period is added to (or credited on) the current invoice. History is kept.</p>
      <ActionMsg action={a} />
      <Button className="mt-3" disabled={a.busy || !beds.length} onClick={async () => (await a.run(() => m.transferStay(stay.id, beds, v.date, v.rate, v.reason))) && onDone()}>Transfer</Button>
    </Modal>
  )
}

// PRD 3.3 check-out: final bill (pending rent, electricity, damages, notice shortfall) minus deposit = refund / payable
function CheckoutModal({ stay, onClose, onDone }) {
  const [date, setDate] = useState(stay.expected_checkout || ymd())
  const [extras, setExtras] = useState([])
  const [refund, setRefund] = useState({ mode: 'upi', ref: '', notes: '' })
  const [quote, setQuote] = useState(null)
  const [result, setResult] = useState(null)
  const a = useAction()
  const clean = extras.filter((x) => Number(x.amount) > 0).map((x) => ({ ...x, amount: Number(x.amount) }))
  const preview = () => a.run(async () => setQuote(await m.checkoutQuote(stay.id, date, clean)))
  const confirm = async () => {
    if (!window.confirm('Check out this tenant? The bed becomes vacant and the deposit is settled.')) return
    const r = await a.run(() => m.checkOut(stay.id, date, clean, refund.mode, refund.ref, refund.notes))
    if (r) setResult(r)
  }
  if (result) {
    return (
      <Modal title="Checked out" onClose={onDone}>
        <Notice tone="ok">Refund to tenant: <strong>{rupees(result.refund)}</strong>{result.payable > 0 && <> · Still payable by tenant: <strong>{rupees(result.payable)}</strong></>}</Notice>
        {result.deductions?.length > 0 && <ul className="mt-3 text-sm">{result.deductions.map((x) => <li key={x.bill_id}>Deducted from deposit: {x.description} · {rupees(x.amount)}</li>)}</ul>}
        <Button className="mt-4" onClick={onDone}>Done</Button>
      </Modal>
    )
  }
  return (
    <Modal title="Check out" onClose={onClose} wide>
      <label className="block text-sm font-medium">Check-out date <input type="date" className={`${inputCls} mt-1 !w-48`} value={date} onChange={(e) => { setDate(e.target.value); setQuote(null) }} /></label>
      <p className="mb-1 mt-4 text-sm font-medium">Other charges (electricity, damages, cleaning…)</p>
      {extras.map((x, i) => (
        <div key={i} className="mb-2 grid grid-cols-[8rem_1fr_7rem_auto] gap-2">
          <select aria-label="Kind" className={inputCls} value={x.kind} onChange={(e) => setExtras((l) => l.map((y, j) => (j === i ? { ...y, kind: e.target.value } : y)))}>
            {CHARGE_KINDS.map((k) => <option key={k} value={k}>{label(k)}</option>)}
          </select>
          <input aria-label="Description" className={inputCls} value={x.description} onChange={(e) => setExtras((l) => l.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
          <input aria-label="Amount" type="number" min="0" className={inputCls} value={x.amount} onChange={(e) => setExtras((l) => l.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
          <Small onClick={() => setExtras((l) => l.filter((_, j) => j !== i))}>Remove</Small>
        </div>
      ))}
      <Small onClick={() => { setExtras((l) => [...l, { kind: 'damage', description: '', amount: '' }]); setQuote(null) }}>+ Add charge</Small>
      <div className="mt-4"><Button variant="outline" onClick={preview} disabled={a.busy}>Calculate final bill</Button></div>
      {quote && (
        <div className="mt-4 rounded-xl bg-cream p-4 text-sm">
          <dl className="grid grid-cols-2 gap-2">
            <Fact k="Pending dues">{rupees(quote.pending_dues)}</Fact>
            <Fact k="Notice shortfall">{quote.notice_shortfall_days} days · {rupees(quote.notice_charge)}</Fact>
            <Fact k="Other charges">{rupees(quote.extras)}</Fact>
            <Fact k="Unused rent credited">− {rupees(quote.unused_rent_credit + quote.future_paid_credit)}</Fact>
            <Fact k="Total due">{rupees(quote.total_due)}</Fact>
            <Fact k="Deposit held + credit">{rupees(quote.deposit_held + quote.credit_balance)}</Fact>
          </dl>
          <p className="mt-3 text-base font-bold">{quote.net >= 0 ? `Refund to tenant: ${rupees(quote.net)}` : `Tenant pays: ${rupees(-quote.net)}`}</p>
          {quote.within_lock_in && <p className="mt-1 text-gold-deep">Leaving inside the lock-in period (ends {formatDate(quote.lock_in_ends)}).</p>}
          <div className="mt-3"><FormFields value={refund} onChange={setRefund} fields={[
            { key: 'mode', label: 'Refund paid by', type: 'select', options: PAY_MODES }, { key: 'ref', label: 'Refund reference' },
            { key: 'notes', label: 'Notes', type: 'textarea' },
          ]} /></div>
          <Button variant="danger" className="mt-3" onClick={confirm} disabled={a.busy}>Confirm check-out</Button>
        </div>
      )}
      <div className="mt-2"><ActionMsg action={a} /></div>
    </Modal>
  )
}

function DepositModal({ stay, deposit, onClose, onDone }) {
  const [v, setV] = useState({ amount: deposit.amount - deposit.received_amount, mode: 'upi', ref: '', date: ymd() })
  const a = useAction()
  return (
    <Modal title="Record deposit received" onClose={onClose}>
      <FormFields value={v} onChange={setV} fields={[
        { key: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1 }, { key: 'mode', label: 'Mode', type: 'select', required: true, options: PAY_MODES },
        { key: 'ref', label: 'Reference' }, { key: 'date', label: 'Received on', type: 'date', required: true },
      ]} />
      <ActionMsg action={a} />
      <Button className="mt-3" disabled={a.busy} onClick={async () => (await a.run(() => m.recordDeposit(stay.id, v.amount, v.mode, v.ref, v.date))) && onDone()}>Save</Button>
    </Modal>
  )
}

const DEFAULT_ITEMS = ['Room clean and undamaged', 'Bed and mattress', 'Cupboard and key', 'Room key', 'Lights and fan working', 'AC remote', 'Bathroom fittings']
function ChecklistModal({ stay, kind, existing, customerId, onClose, onDone }) {
  const [items, setItems] = useState(existing?.items?.length ? existing.items : DEFAULT_ITEMS.map((item) => ({ item, ok: true, note: '' })))
  const [v, setV] = useState({ room_condition: existing?.room_condition ?? '', keys_count: existing?.keys_count ?? 1, notes: existing?.notes ?? '' })
  const [photos, setPhotos] = useState(existing?.photos ?? [])
  const a = useAction()
  const upload = (files) => a.run(async () => {
    const paths = []
    for (const f of files) paths.push(await m.uploadFile('customer-documents', customerId, f))
    setPhotos((p) => [...p, ...paths])
  })
  const save = async () => {
    if (await a.run(() => m.saveChecklist({ booking_id: stay.id, kind, items, photos, room_condition: v.room_condition, keys_count: Number(v.keys_count || 0), notes: v.notes }))) onDone()
  }
  return (
    <Modal title={kind === 'check_in' ? 'Check-in checklist' : 'Check-out checklist'} onClose={onClose} wide>
      <ul className="space-y-2">
        {items.map((x, i) => (
          <li key={i} className="grid grid-cols-[auto_1fr_1fr] items-center gap-2 text-sm">
            <input type="checkbox" aria-label={`${x.item} OK`} checked={x.ok} onChange={(e) => setItems((l) => l.map((y, j) => (j === i ? { ...y, ok: e.target.checked } : y)))} />
            <input aria-label="Item" className={inputCls} value={x.item} onChange={(e) => setItems((l) => l.map((y, j) => (j === i ? { ...y, item: e.target.value } : y)))} />
            <input aria-label="Note" placeholder="Note" className={inputCls} value={x.note} onChange={(e) => setItems((l) => l.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
          </li>
        ))}
      </ul>
      <Small className="mt-2" onClick={() => setItems((l) => [...l, { item: '', ok: true, note: '' }])}>+ Item</Small>
      <div className="mt-4"><FormFields value={v} onChange={setV} fields={[
        { key: 'room_condition', label: 'Room condition', type: 'textarea' }, { key: 'keys_count', label: kind === 'check_in' ? 'Keys handed over' : 'Keys returned', type: 'number', min: 0 },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ]} /></div>
      <div className="mt-3 flex items-center gap-3"><FileButton label="Add photos" accept="image/*" multiple capture="environment" onFile={upload} busy={a.busy} /><span className="text-sm">{photos.length} photo(s)</span></div>
      <ActionMsg action={a} />
      <Button className="mt-4" onClick={save} disabled={a.busy}>Save checklist</Button>
    </Modal>
  )
}

// ---------------------------------------------------------------- invoices, payments, charges, credit (PRD 4)
function InvoicesTab({ d, stay, reload }) {
  const [modal, setModal] = useState(null)
  const [open, setOpen] = useState(null)
  const a = useAction()
  const tenant = d.profile
  const remind = (b) => a.run(() => m.sendReminder(b.id), 'Reminder sent')
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {stay && <Button onClick={() => setModal({ kind: 'charge' })}>Add charge</Button>}
        <Button variant="outline" onClick={() => setModal({ kind: 'advance' })}>Record advance payment</Button>
        <ActionMsg action={a} />
      </div>
      <div className="space-y-2">
        {d.bills.length === 0 && <Notice>No invoices yet.</Notice>}
        {d.bills.map((b) => {
          const st = invoiceState(b)
          return (
            <Card key={b.id} className="!p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button className="text-left" onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id}>
                  <p className="font-semibold">{b.description} <span className="text-xs font-normal text-slate-500">{b.invoice_no}</span></p>
                  <p className="text-xs text-slate-600">Due {formatDate(b.due_date)} · {rupees(b.amount)}{b.amount_paid ? ` · paid ${rupees(b.amount_paid)}` : ''}</p>
                </button>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge tone={INVOICE_TONES[st]}>{label(st)}</Badge>
                  {b.status === 'unpaid' && (
                    <>
                      <Small onClick={() => setModal({ kind: 'pay', bill: b })}>Record payment</Small>
                      <Small onClick={() => setModal({ kind: 'line', bill: b })}>Discount / adjust</Small>
                      <Small onClick={() => remind(b)}>Send reminder</Small>
                      <Small onClick={() => setModal({ kind: 'void', bill: b })}>Void</Small>
                    </>
                  )}
                  <Small onClick={() => invoicePdf({ bill: b, tenant, room: stay?.rooms?.room_no })}>PDF</Small>
                </div>
              </div>
              {open === b.id && (
                <table className="mt-3 w-full text-sm">
                  <tbody>
                    {b.bill_lines.map((l) => (
                      <tr key={l.id} className="border-t border-navy/5">
                        <td className="py-1">{l.description}{l.reason && <span className="block text-xs text-slate-500">Reason: {l.reason}</span>}</td>
                        <td className="py-1 text-right">{rupees(l.amount)}</td>
                        <td className="py-1 pl-2 text-right">{b.status === 'unpaid' && l.kind !== 'rent' && (
                          <button className="text-xs text-red-700 underline" onClick={async () => {
                            const reason = window.prompt('Reason for removing this line?')
                            if (reason && await a.run(() => m.removeBillLine(l.id, reason))) reload()
                          }}>Remove</button>
                        )}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )
        })}
      </div>
      <H3>Payments</H3>
      <DataTable title="Payments" rows={d.payments} columns={[
        { key: 'created_at', label: 'Date', render: (p) => formatDate(p.paid_on || p.created_at) },
        { key: 'for', label: 'For', value: (p) => p.bills?.description },
        { key: 'amount', label: 'Amount', render: (p) => rupees(p.amount) },
        { key: 'provider', label: 'Mode', value: (p) => (p.is_simulated ? 'demo' : label(p.provider)) },
        { key: 'reference', label: 'Reference', value: (p) => p.reference || p.provider_payment_id },
        { key: 'status', label: 'Status', render: (p) => <StatusBadge value={p.status} tones={{ succeeded: 'green' }} /> },
        { key: 'r', label: '', noExport: true, noSort: true, render: (p) => p.status === 'succeeded' && <Small onClick={() => receiptPdf({ payment: p, bill: p.bills, tenant })}>Receipt</Small> },
      ]} />
      <H3>Recurring charges</H3>
      <DataTable title="Recurring charges" search={false} rows={d.recurring} empty="None. Add a charge and tick 'every month'." columns={[
        { key: 'description', label: 'Charge' }, { key: 'amount', label: 'Amount', render: (r) => rupees(r.amount) },
        { key: 'active', label: 'Status', render: (r) => <StatusBadge value={r.active ? 'active' : 'stopped'} /> },
        { key: 'x', label: '', noExport: true, render: (r) => r.active && <Small onClick={async () => (await a.run(() => m.updateRow('recurring_charges', r.id, { active: false }))) && reload()}>Stop</Small> },
      ]} />
      <H3>Credit ledger</H3>
      <DataTable title="Credit" search={false} rows={d.credits} empty="No advance or credit" columns={[
        { key: 'created_at', label: 'Date', render: (c) => formatDateTime(c.created_at) }, { key: 'reason', label: 'Reason' },
        { key: 'amount', label: 'Amount', render: (c) => <span className={c.amount < 0 ? 'text-red-700' : 'text-green-800'}>{rupees(c.amount)}</span> },
      ]} />
      {modal?.kind === 'pay' && <PaymentModal bill={modal.bill} customerId={tenant.id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
      {modal?.kind === 'line' && <LineModal bill={modal.bill} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
      {modal?.kind === 'charge' && <ChargeModal stay={stay} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
      {modal?.kind === 'advance' && <AdvanceModal customerId={tenant.id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
      {modal?.kind === 'void' && <VoidModal bill={modal.bill} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
    </div>
  )
}

export function PaymentModal({ bill, customerId, onClose, onDone }) {
  const [v, setV] = useState({ amount: owed(bill), mode: 'upi', reference: '', paidOn: ymd(), notes: '' })
  const [proof, setProof] = useState(null)
  const a = useAction()
  const save = async () => {
    const ok = await a.run(async () => {
      const proofPath = proof ? await m.uploadFile('customer-documents', customerId, proof) : null
      return m.recordPayment({ bill: bill.id, ...v, proof: proofPath })
    })
    if (ok) onDone()
  }
  return (
    <Modal title={`Record payment · ${bill.description}`} onClose={onClose}>
      <p className="mb-3 text-sm">Owed: <strong>{rupees(owed(bill))}</strong>. A smaller amount is a part payment; a larger one is kept as credit for the next invoice.</p>
      <FormFields value={v} onChange={setV} fields={[
        { key: 'amount', label: 'Amount received (₹)', type: 'number', required: true, min: 1 },
        { key: 'mode', label: 'Mode', type: 'select', required: true, options: PAY_MODES },
        { key: 'reference', label: 'Reference / UTR / cheque no.', help: 'Required except for cash' },
        { key: 'paidOn', label: 'Received on', type: 'date', required: true, max: ymd() }, { key: 'notes', label: 'Notes', type: 'textarea' },
      ]} />
      <div className="mt-3 flex items-center gap-3"><FileButton label="Attach proof" onFile={setProof} /><span className="text-sm">{proof?.name}</span></div>
      <ActionMsg action={a} />
      <Button className="mt-3" onClick={save} disabled={a.busy}>Save payment</Button>
    </Modal>
  )
}

function LineModal({ bill, onClose, onDone }) {
  const [v, setV] = useState({ kind: 'discount', description: '', amount: '', reason: '' })
  const a = useAction()
  return (
    <Modal title="Discount, adjustment or extra line" onClose={onClose}>
      <FormFields value={v} onChange={setV} fields={[
        { key: 'kind', label: 'Type', type: 'select', required: true, options: [['discount', 'Discount'], ['adjustment', 'Adjustment (+ or −)'], ...CHARGE_KINDS.map((k) => [k, label(k)])] },
        { key: 'description', label: 'Description', required: true }, { key: 'amount', label: 'Amount (₹)', type: 'number', required: true, help: 'Discounts are taken off automatically; use a negative adjustment to reduce.' },
        { key: 'reason', label: 'Reason (kept in the audit log)', span: true, required: ['discount', 'adjustment'].includes(v.kind) },
      ]} />
      <ActionMsg action={a} />
      <Button className="mt-3" disabled={a.busy} onClick={async () => (await a.run(() => m.addBillLine(bill.id, v.kind, v.description, v.amount, v.reason))) && onDone()}>Add</Button>
    </Modal>
  )
}

function ChargeModal({ stay, onClose, onDone }) {
  const [v, setV] = useState({ kind: 'laundry', description: '', amount: '', recurring: false })
  const a = useAction()
  return (
    <Modal title="Add a charge" onClose={onClose}>
      <FormFields value={v} onChange={setV} fields={[
        { key: 'kind', label: 'Charge', type: 'select', required: true, options: CHARGE_KINDS },
        { key: 'description', label: 'Description', required: true }, { key: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1 },
        { key: 'recurring', label: 'Add every month (e.g. Wi-Fi, food plan, parking)', type: 'checkbox', span: true },
      ]} />
      <p className="mt-2 text-xs text-slate-500">Goes on the current unpaid invoice as its own line, or on a new charges invoice. Electricity for a whole room is under Rent & payments → Electricity.</p>
      <ActionMsg action={a} />
      <Button className="mt-3" disabled={a.busy} onClick={async () => (await a.run(() => m.addCharge(stay.id, v.kind, v.description || label(v.kind), v.amount, v.recurring))) && onDone()}>Add charge</Button>
    </Modal>
  )
}

function AdvanceModal({ customerId, onClose, onDone }) {
  const [v, setV] = useState({ amount: '', mode: 'upi', ref: '' })
  const a = useAction()
  return (
    <Modal title="Record advance payment" onClose={onClose}>
      <FormFields value={v} onChange={setV} fields={[
        { key: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1 }, { key: 'mode', label: 'Mode', type: 'select', options: PAY_MODES }, { key: 'ref', label: 'Reference' },
      ]} />
      <p className="mt-2 text-xs text-slate-500">Kept as credit and used automatically on the next invoices.</p>
      <ActionMsg action={a} />
      <Button className="mt-3" disabled={a.busy} onClick={async () => (await a.run(() => m.recordAdvance(customerId, v.amount, v.mode, v.ref))) && onDone()}>Save</Button>
    </Modal>
  )
}

function VoidModal({ bill, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const a = useAction()
  return (
    <Modal title={`Void ${bill.invoice_no}`} onClose={onClose}>
      <label className="block text-sm font-medium">Reason<textarea className={`${inputCls} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <ActionMsg action={a} />
      <Button variant="danger" className="mt-3" disabled={a.busy} onClick={async () => (await a.run(() => m.voidBill(bill.id, reason))) && onDone()}>Void invoice</Button>
    </Modal>
  )
}

// ---------------------------------------------------------------- agreement (PRD 3.4)
function AgreementTab({ d, stay, customerId, reload }) {
  const [mode, setMode] = useState('')
  const [v, setV] = useState({ start: stay?.check_in ?? ymd(), end: addDays(stay?.check_in ?? ymd(), 334), lockIn: stay?.lock_in_months ?? 0,
    notice: stay?.notice_period_days ?? 30, rent: stay?.rate ?? '', deposit: stay?.deposit ?? 0, rules: '' })
  const [file, setFile] = useState(null)
  const a = useAction()
  const generate = async () => (await a.run(() => m.generateAgreement(stay.id, v.end, v.rules || null), 'Agreement sent to the tenant')) && (setMode(''), reload())
  const record = async () => {
    const ok = await a.run(async () => {
      if (!file) throw new Error('Choose the signed PDF')
      const doc = await m.uploadTenantDocument(customerId, file, { docType: 'agreement', bookingId: stay.id })
      return m.recordAgreement({ booking: stay.id, ...v, document: doc.id })
    }, 'Saved')
    if (ok) { setMode(''); reload() }
  }
  const openDoc = (docId) => a.run(async () => {
    const doc = d.docs.find((x) => x.id === docId)
    window.open(await m.fileUrl('customer-documents', doc.file_path), '_blank', 'noopener')
  })
  return (
    <div className="space-y-4">
      {stay && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode('generate')}>Generate from template</Button>
          <Button variant="outline" onClick={() => setMode('upload')}>Upload signed agreement</Button>
        </div>
      )}
      {mode && (
        <Card>
          <FormFields value={v} onChange={setV} fields={mode === 'generate'
            ? [{ key: 'end', label: 'End date', type: 'date', required: true }, { key: 'rules', label: 'House rules (blank = standard rules)', type: 'textarea' }]
            : [{ key: 'start', label: 'Start date', type: 'date', required: true }, { key: 'end', label: 'End date', type: 'date', required: true },
              { key: 'lockIn', label: 'Lock-in (months)', type: 'number', min: 0 }, { key: 'notice', label: 'Notice period (days)', type: 'number', min: 0 },
              { key: 'rent', label: 'Rent (₹)', type: 'number', required: true }, { key: 'deposit', label: 'Deposit (₹)', type: 'number' },
              { key: 'rules', label: 'Rules accepted', type: 'textarea' }]} />
          {mode === 'upload' && <div className="mt-3 flex items-center gap-3"><FileButton label="Choose signed PDF" accept="application/pdf" onFile={setFile} /><span className="text-sm">{file?.name}</span></div>}
          <Button className="mt-3" disabled={a.busy} onClick={mode === 'generate' ? generate : record}>{mode === 'generate' ? 'Generate and send' : 'Save agreement'}</Button>
        </Card>
      )}
      <ActionMsg action={a} />
      <DataTable title="Agreements" search={false} rows={d.agreements} empty="No agreement yet" columns={[
        { key: 'start_date', label: 'Period', value: (x) => `${formatDate(x.start_date)} – ${formatDate(x.end_date)}` },
        { key: 'rent', label: 'Rent / deposit', value: (x) => `${rupees(x.rent)} / ${rupees(x.deposit)}` },
        { key: 'lock_in_months', label: 'Lock-in / notice', value: (x) => `${x.lock_in_months} mo / ${x.notice_period_days} d` },
        { key: 'status', label: 'Status', render: (x) => <StatusBadge value={x.status} tones={{ sent: 'amber' }} /> },
        { key: 'accepted_at', label: 'Accepted', value: (x) => (x.accepted_at ? `${formatDateTime(x.accepted_at)} (${x.acceptance_method})` : '—') },
        { key: 'x', label: '', noExport: true, noSort: true, render: (x) => (
          <span className="flex flex-wrap gap-1">
            <Small onClick={() => agreementPdf({ agreement: x, tenant: d.profile })}>PDF</Small>
            {x.document_id && <Small onClick={() => openDoc(x.document_id)}>Signed copy</Small>}
            {['active', 'sent'].includes(x.status) && <Small onClick={async () => (await a.run(() => m.setAgreementStatus(x.id, 'terminated'))) && reload()}>Terminate</Small>}
          </span>
        ) },
      ]} />
    </div>
  )
}
