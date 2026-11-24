import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { ActionMsg, FileButton, FormFields, Load, StatusBadge, useAction } from '../../components/manage/kit'
import ResidentForm from '../../components/manage/ResidentForm'
import { clearStash, readStash, tenantFormValue, validateTenant } from '../../components/manage/tenantFields'
import { Button, Card, Empty, Field, Notice, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { COMPLAINT_CATEGORIES, addDays, complaintCategory, complaintMoves, ymd } from '../../services/pg'
import { agreementPdf } from '../../services/pdfDocs'
import { formatDate, formatDateTime } from '../../services/format'

// Tenant-side screens of the PG app (PRD 3, 4, 6): own details and emergency contacts, notice to vacate,
// agreement view / accept / download, complaints with photos, and notices from the office.

export function TenantDetails() {
  const { user, profile, refreshProfile } = useAuth()
  return (
    <Load loader={() => m.rows('tenant_profiles', '*', (q) => q.eq('user_id', user.id).maybeSingle())} deps={[user.id]}>
      {(tp, reload) => <DetailsForm tp={Array.isArray(tp) ? null : tp} profile={profile} onSaved={() => { reload(); refreshProfile?.() }} />}
    </Load>
  )
}

function DetailsForm({ tp, profile, onSaved }) {
  const signed = Boolean(tp?.rules_accepted_at)
  const [kept] = useState(() => (tp ? null : readStash())) // registration filled in before email confirmation
  const [v, setV] = useState(() => ({ ...tenantFormValue({ ...profile, tenant_profiles: tp }), ...(kept ?? {}), full_name: profile?.full_name ?? '', phone: profile?.phone ?? '' }))
  const a = useAction()
  const save = async (e) => {
    e.preventDefault()
    const bad = validateTenant(v) || (!signed && !v.rules_accepted ? 'Accept the rules and regulations to register' : '')
    if (bad) return a.run(() => Promise.reject(new Error(bad)))
    if (await a.run(() => m.saveMyTenantProfile(v), 'Saved')) { clearStash(); onSaved() }
  }
  return (
    <form onSubmit={save}>
      <Card>
        {tp && (
          <p className="mb-3 text-sm">Registration: <StatusBadge value={tp.approval_status} />{tp.approval_note && ` · ${tp.approval_note}`}
            {' '}· Police verification: <StatusBadge value={tp.police_status} /></p>
        )}
        {!tp && <div className="mb-3"><Notice tone="warn">{kept ? 'Your registration form is filled in below. Check it and press Save details to submit it.' : 'Complete the registration form, including one emergency contact and the rules, so the office can approve your registration.'}</Notice></div>}
        <ResidentForm value={v} onChange={setV} skip={['full_name', 'phone']} signed={signed} />
        <div className="mt-4 flex items-center gap-3"><Button type="submit" disabled={a.busy}>Save details</Button><ActionMsg action={a} /></div>
      </Card>
    </form>
  )
}

export function NoticeToVacate({ booking, onChanged }) {
  const [date, setDate] = useState(addDays(ymd(), booking.notice_period_days ?? 30))
  const a = useAction()
  if (booking.status !== 'active' || booking.billing_period !== 'month') return null
  if (booking.notice_date) {
    return <Notice>You gave notice on {formatDate(booking.notice_date)}. Planned check-out: <strong>{formatDate(booking.expected_checkout)}</strong>.</Notice>
  }
  return (
    <Card>
      <p className="text-sm">Planning to move out? Your notice period is {booking.notice_period_days ?? 30} days. Leaving earlier is charged for the days short.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Planned check-out"><input type="date" min={ymd()} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Button variant="outline" disabled={a.busy} onClick={async () => {
          if (window.confirm(`Give notice to check out on ${formatDate(date)}?`) && await a.run(() => m.giveNotice(booking.id, date))) onChanged()
        }}>Give notice</Button>
      </div>
      <div className="mt-2"><ActionMsg action={a} /></div>
    </Card>
  )
}

export function MyAgreement() {
  const { user, profile } = useAuth()
  const [name, setName] = useState('')
  const [rules, setRules] = useState(false)
  const a = useAction()
  return (
    <Load loader={() => m.rows('agreements', '*', (q) => q.eq('customer_id', user.id).order('created_at', { ascending: false }))} deps={[user.id]}>
      {(list, reload) => (list.length === 0 ? <Empty title="No agreement yet">The office will share it after check-in.</Empty> : (
        <div className="space-y-3">
          {list.map((ag) => (
            <Card key={ag.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{formatDate(ag.start_date)} – {formatDate(ag.end_date)}</p>
                <StatusBadge value={ag.status} tones={{ sent: 'amber' }} />
              </div>
              <p className="text-sm text-slate-600">Rent ₹{ag.rent.toLocaleString('en-IN')} · deposit ₹{ag.deposit.toLocaleString('en-IN')} · lock-in {ag.lock_in_months} month(s) · notice {ag.notice_period_days} days</p>
              {ag.body && <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-cream p-3 text-xs">{ag.body}</pre>}
              {ag.accepted_at && <p className="mt-2 text-sm">Accepted on {formatDateTime(ag.accepted_at)}.</p>}
              {ag.status === 'sent' && (
                <div className="mt-3 space-y-2">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} />I have read the agreement and accept the house rules</label>
                  <Field label={`Type your full name (${profile?.full_name}) to sign`}><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
                  <Button disabled={a.busy || !rules || !name.trim()} onClick={async () => (await a.run(() => m.acceptAgreement(ag.id, name, rules), 'Accepted')) && reload()}>Accept agreement</Button>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => agreementPdf({ agreement: ag, tenant: profile })}>Download PDF</Button>
              </div>
            </Card>
          ))}
          <ActionMsg action={a} />
        </div>
      ))}
    </Load>
  )
}

export function MyComplaints({ hasStay }) {
  const { user } = useAuth()
  const [v, setV] = useState({ category: 'electrical', title: '', description: '', preferred_time: '' })
  const [files, setFiles] = useState([])
  const [rate, setRate] = useState({})
  const a = useAction()
  return (
    <Load loader={() => m.rows('complaints', '*', (q) => q.eq('customer_id', user.id).order('created_at', { ascending: false }).limit(50))} deps={[user.id]}>
      {(list, reload) => (
        <div className="space-y-4">
          {hasStay ? (
            <Card>
              <FormFields value={v} onChange={setV} fields={[
                { key: 'category', label: 'Category', type: 'select', required: true, options: COMPLAINT_CATEGORIES.map((c) => [c, complaintCategory(c)]) },
                { key: 'preferred_time', label: 'Best time to visit your room' },
                { key: 'title', label: 'What is wrong? (short)', required: true, span: true }, { key: 'description', label: 'Details', type: 'textarea' },
              ]} />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <FileButton label="Add photos / video" accept="image/*,video/*" multiple onFile={(fs) => setFiles((x) => [...x, ...fs])} />
                <span className="text-sm">{files.length ? `${files.length} file(s)` : ''}</span>
              </div>
              <Button className="mt-3" disabled={a.busy || !v.title.trim()} onClick={async () => {
                const ok = await a.run(async () => {
                  const photos = []
                  for (const f of files) photos.push(await m.uploadFile('complaint-media', user.id, f))
                  await m.raiseComplaint({ ...v, photos })
                }, 'Complaint raised. You will be notified at every step.')
                if (ok) { setV({ category: 'electrical', title: '', description: '', preferred_time: '' }); setFiles([]); reload() }
              }}>Raise complaint</Button>
              <div className="mt-2"><ActionMsg action={a} /></div>
            </Card>
          ) : <Notice>You can raise complaints once your stay has started.</Notice>}
          {list.map((c) => (
            <Card key={c.id} className="!p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">#{c.ticket_no} {c.title}</p><StatusBadge value={c.status} />
              </div>
              <p className="text-xs text-slate-500">{complaintCategory(c.category)} · raised {formatDateTime(c.created_at)}{c.resolution ? ` · ${c.resolution}` : ''}</p>
              {complaintMoves(c.status, { tenant: true }).length > 0 && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  {c.status === 'resolved' && (
                    <>
                      <label className="text-sm">Rating <select className="rounded border border-navy/20" value={rate[c.id] ?? 5} onChange={(e) => setRate({ ...rate, [c.id]: e.target.value })}>
                        {[5, 4, 3, 2, 1].map((n) => <option key={n}>{n}</option>)}</select></label>
                      <Button variant="outline" className="!py-1" onClick={async () => (await a.run(() => m.updateComplaint(c.id, { status: 'closed', rating: Number(rate[c.id] ?? 5) }))) && reload()}>Confirm fixed</Button>
                    </>
                  )}
                  <Button variant="danger" className="!py-1" onClick={async () => {
                    const note = window.prompt('What is still wrong?')
                    if (note !== null && await a.run(() => m.updateComplaint(c.id, { status: 'reopen', note }))) reload()
                  }}>Reopen</Button>
                </div>
              )}
              {c.rating && <p className="mt-1 text-xs">Your rating: {c.rating}/5</p>}
            </Card>
          ))}
        </div>
      )}
    </Load>
  )
}

export function OfficeNotices() {
  return (
    <Load loader={() => m.rows('notices', '*', (q) => q.order('created_at', { ascending: false }).limit(20))}>
      {(list) => (list.length === 0 ? <Empty title="No notices" /> : (
        <ul className="space-y-2">
          {list.map((n) => <li key={n.id}><Card className="!p-4"><p className="font-semibold">{n.title}</p><p className="whitespace-pre-line text-sm">{n.body}</p><p className="text-xs text-slate-500">{formatDate(n.created_at)}</p></Card></li>)}
        </ul>
      ))}
    </Load>
  )
}


// PRD 9.4 [Later]: link to the property's Google review page, set by the owner in Settings
export function GoogleReviewLink() {
  return (
    <Load loader={() => m.rows('app_settings', 'value', (q) => q.eq('key', 'google_review_url').maybeSingle())}>
      {(row) => (typeof row?.value === 'string' && row.value.startsWith('http')
        ? <p className="mt-3 text-sm">Happy with your stay? <a className="font-medium underline" href={row.value} target="_blank" rel="noopener noreferrer">Review us on Google</a></p>
        : null)}
    </Load>
  )
}
