import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import useAsync from '../../hooks/useAsync'
import { ActionMsg, Fact, FormFields, H3, Small, StatusBadge, useAction, useScope } from '../../components/manage/kit'
import { ENQUIRY_FIELDS, LostModal } from './Enquiries'
import { Button, Card, ErrorBox, Notice, TableSkeleton, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { ENQUIRY_STATUSES, addDays, label, ymd } from '../../services/pg'
import { formatDate, formatDateTime, whatsappLink } from '../../services/format'

export default function EnquiryDetail() {
  const { id } = useParams()
  const { role } = useAuth()
  const { properties } = useScope()
  const navigate = useNavigate()
  const d = useAsync(() => Promise.all([m.loadEnquiry(id), m.loadStaffLogins(), m.rows('brokers', '*'), m.rows('campaigns', '*')]), [id])
  const [edit, setEdit] = useState(null)
  const [lost, setLost] = useState(false)
  const [call, setCall] = useState({ kind: 'call', outcome: 'answered', notes: '', next: '', followUp: '' })
  const [visit, setVisit] = useState({ when: `${addDays(ymd(), 1)}T11:00`, property: '', notes: '' })
  const a = useAction()
  if (d.loading) return <TableSkeleton />
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />
  const [{ e, acts, fus, visits, subs }, staff, brokers, campaigns] = d.data
  const execs = staff.filter((s) => ['sales', 'manager', 'admin'].includes(s.role) && s.is_active)
  const reload = d.reload
  const act = async (fn, msg) => { if (await a.run(fn, msg)) reload() }

  const setStatus = (status) => (status === 'lost' ? setLost(true) : act(() => m.updateEnquiry(e.id, { status }), 'Status updated'))
  const logCall = (ev) => {
    ev.preventDefault()
    act(() => m.logLeadActivity(e.id, call.kind, call.outcome, call.notes, call.next, call.followUp ? new Date(call.followUp).toISOString() : null), 'Logged')
    setCall({ kind: 'call', outcome: 'answered', notes: '', next: '', followUp: '' })
  }
  // PRD 8.2 one-click convert: registration opens pre-filled; check-in then links the stay to this lead
  const convert = () => {
    if (e.converted_customer_id) navigate(`/admin/checkin?tenant=${e.converted_customer_id}&enquiry=${e.id}`)
    else navigate(`/admin/tenants?new=1&name=${encodeURIComponent(e.name)}&phone=${e.phone}&email=${encodeURIComponent(e.email)}&property=${e.property_id ?? ''}&enquiry=${e.id}`)
  }

  return (
    <div>
      <Link to="/admin/enquiries" className="text-sm underline">← All enquiries</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{e.name}</h2>
          <p className="text-sm text-slate-600">{e.phone}{e.email ? ` · ${e.email}` : ''} · received {formatDateTime(e.received_at)} via {label(e.source)}{e.campaigns ? ` (${e.campaigns.name})` : ''}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge value={e.status} /><StatusBadge value={e.temperature} />{e.opted_out && <StatusBadge value="opted out" />}
            {e.duplicate_of && <Link className="text-xs underline" to={`/admin/enquiries/${e.duplicate_of}`}>Same mobile as an earlier enquiry</Link>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button href={`tel:+91${e.phone.slice(-10)}`} onClick={() => setCall((c) => ({ ...c, kind: 'call' }))}>Call</Button>
          <Button variant="outline" href={whatsappLink(e.phone, `Hi ${e.name}, this is YOLO Nest about your enquiry.`)} target="_blank" rel="noopener"
            onClick={() => m.logLeadActivity(e.id, 'whatsapp', 'sent', 'Opened WhatsApp chat').then(reload).catch(() => {})}>WhatsApp</Button>
          {e.status !== 'booked' && <Button variant="sun" onClick={convert}>Convert to tenant</Button>}
          {e.status !== 'booked' && <Button variant="outline" to="/admin/beds">Reserve a bed</Button>}
        </div>
      </div>
      <ActionMsg action={a} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium">Status
                <select className={`${inputCls} ml-2 !w-auto`} value={e.status} onChange={(ev) => setStatus(ev.target.value)}>
                  {ENQUIRY_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">Assigned to
                <select className={`${inputCls} ml-2 !w-auto`} value={e.assigned_to ?? ''} disabled={role === 'sales'}
                  onChange={(ev) => act(() => m.updateEnquiry(e.id, { assigned_to: ev.target.value || null }), 'Assigned')}>
                  <option value="">Nobody</option>{execs.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">Lead
                <select className={`${inputCls} ml-2 !w-auto`} value={e.temperature}
                  onChange={(ev) => act(() => m.updateEnquiry(e.id, { temperature: ev.target.value, temperature_manual: true }))}>
                  {['hot', 'warm', 'cold'].map((t) => <option key={t} value={t}>{label(t)}</option>)}
                </select>
              </label>
            </div>
            {e.status === 'lost' && <p className="mt-2 text-sm">Lost: {label(e.lost_reason)} {e.lost_note}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
              <Fact k="Property">{e.property_id}</Fact><Fact k="Looking for">{e.room_type}</Fact><Fact k="Budget">{e.budget ? `₹${e.budget}` : '—'}</Fact>
              <Fact k="Move-in">{formatDate(e.move_in)}</Fact><Fact k="Broker">{e.brokers?.name}</Fact><Fact k="Next follow-up">{formatDateTime(e.next_follow_up_at)}</Fact>
            </dl>
            {e.message && <p className="mt-3 whitespace-pre-line rounded-xl bg-cream p-3 text-sm">{e.message}</p>}
            <div className="mt-3 flex gap-2">
              <Small onClick={() => setEdit({ ...e })}>Edit details</Small>
              <Small onClick={() => act(() => m.updateEnquiry(e.id, { opted_out: !e.opted_out }))}>{e.opted_out ? 'Allow messages again' : 'Opt out of messages'}</Small>
            </div>
            {edit && (
              <div className="mt-4 border-t border-navy/10 pt-4">
                <FormFields fields={ENQUIRY_FIELDS(properties, brokers, campaigns)} value={edit} onChange={setEdit} />
                <div className="mt-3 flex gap-2">
                  <Button onClick={async () => {
                    const patch = Object.fromEntries(ENQUIRY_FIELDS(properties).map((f) => [f.key, edit[f.key] === '' ? null : edit[f.key]]))
                    patch.email = edit.email ?? ''; patch.room_type = edit.room_type ?? ''; patch.message = edit.message ?? ''
                    if (await a.run(() => m.updateEnquiry(e.id, patch), 'Saved')) { setEdit(null); reload() }
                  }}>Save</Button>
                  <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </Card>

          <form onSubmit={logCall}>
            <Card>
              <H3>Log a call or message</H3>
              <FormFields value={call} onChange={setCall} fields={[
                { key: 'kind', label: 'Type', type: 'select', required: true, options: ['call', 'whatsapp', 'sms', 'email', 'note'] },
                { key: 'outcome', label: 'Outcome', type: 'select', options: ['answered', 'no_answer', 'busy', 'call_back', 'wrong_number', 'sent'], hidden: (v) => v.kind === 'note' },
                { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'next', label: 'Next step' },
                { key: 'followUp', label: 'Follow up on', type: 'datetime-local' },
              ]} />
              <Button type="submit" className="mt-3" disabled={a.busy}>Save</Button>
            </Card>
          </form>

          <section>
            <H3>Activity timeline</H3>
            <ol className="space-y-2">
              {acts.map((x) => (
                <li key={x.id} className="border-l-2 border-gold pl-3 text-sm">
                  <span className="text-xs text-slate-500">{formatDateTime(x.created_at)} · {x.profiles?.full_name ?? 'System'} · {label(x.kind)}{x.outcome ? ` · ${label(x.outcome)}` : ''}</span>
                  <p className="whitespace-pre-line">{x.notes}{x.next_step ? ` → Next: ${x.next_step}` : ''}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-6">
          <Card>
            <H3>Follow-ups</H3>
            <ul className="space-y-2 text-sm">
              {fus.length === 0 && <li className="text-slate-500">None scheduled.</li>}
              {fus.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2">
                  <span className={!x.done_at && new Date(x.due_at) < new Date() ? 'text-red-700' : ''}>{formatDateTime(x.due_at)} {x.note && `· ${x.note}`}{x.done_at && ` · done (${x.outcome})`}</span>
                  {!x.done_at && <Small onClick={() => { const o = window.prompt('Outcome?', 'Spoke to lead'); if (o !== null) act(() => m.completeFollowUp(x.id, o)) }}>Done</Small>}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <H3>Site visits</H3>
            <ul className="mb-3 space-y-2 text-sm">
              {visits.map((v) => (
                <li key={v.id}>
                  {formatDateTime(v.scheduled_at)} · {v.property_id} · <StatusBadge value={v.status} tones={{ visited: 'green', no_show: 'red' }} />
                  {v.status === 'scheduled' && (
                    <span className="mt-1 flex gap-1">
                      <Small onClick={() => act(() => m.setVisitStatus(v.id, 'visited'))}>Visited</Small>
                      <Small onClick={() => act(() => m.setVisitStatus(v.id, 'no_show'))}>No-show</Small>
                      <Small onClick={() => act(() => m.setVisitStatus(v.id, 'cancelled'))}>Cancel</Small>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <FormFields value={visit} onChange={setVisit} fields={[
              { key: 'when', label: 'Date and time', type: 'datetime-local', required: true },
              { key: 'property', label: 'Property', type: 'select', options: properties.map((p) => [p.id, p.name]) },
            ]} />
            <Button className="mt-3" disabled={a.busy} onClick={() => act(() => m.scheduleVisit(e.id, new Date(visit.when).toISOString(), visit.property || e.property_id, visit.notes), 'Visit booked; confirmation queued to the lead')}>Schedule visit</Button>
            {e.opted_out && <p className="mt-2 text-xs text-slate-500">Opted out: no confirmation message is sent.</p>}
          </Card>
          <Card>
            <H3>Raw submissions</H3>
            {subs.length === 0 ? <Notice>Entered by staff.</Notice> : (
              <ul className="space-y-2 text-xs">
                {subs.map((s) => <li key={s.id}><p className="text-slate-500">{formatDateTime(s.received_at)} · {s.source}</p><pre className="overflow-x-auto whitespace-pre-wrap rounded bg-cream p-2">{JSON.stringify(s.payload, null, 1)}</pre></li>)}
              </ul>
            )}
          </Card>
        </aside>
      </div>
      {lost && <LostModal e={e} onClose={() => setLost(false)} onDone={() => { setLost(false); reload() }} />}
    </div>
  )
}
