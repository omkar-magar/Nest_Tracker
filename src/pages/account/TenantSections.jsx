import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { ActionMsg, FileButton, Load, StatusBadge, useAction } from '../../components/manage/kit'
import ResidentForm from '../../components/manage/ResidentForm'
import { clearStash, readStash, tenantFormValue, validateTenant } from '../../components/manage/tenantFields'
import { Button, Card, Empty, Field, Notice, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { RESIDENT_COMPLAINT_CATEGORIES, addDays, complaintCategory, complaintStatus, ymd } from '../../services/pg'
import * as cx from '../../services/complaints'
import { ComplaintImages, ComplaintStatusBadge, ComplaintTimeline } from '../../components/complaints/ComplaintParts'
import { agreementPdf } from '../../services/pdfDocs'
import { formatDate, formatDateTime } from '../../services/format'
import useAsync from '../../hooks/useAsync'
import { registrationProperties, submitRegistration } from '../../services/registration'

// Tenant-side screens of the PG app (PRD 3, 4, 6): own details and emergency contacts, notice to vacate,
// agreement view / accept / download, complaints with photos, and notices from the office.

export function TenantDetails() {
  const { user, profile, refreshProfile } = useAuth()
  return (
    <Load loader={() => m.rows('tenant_profiles', '*', (q) => q.eq('user_id', user.id).maybeSingle())} deps={[user.id]}>
      {(tp, reload) => <DetailsForm tp={Array.isArray(tp) ? null : tp} profile={profile} accountEmail={user.email} onSaved={() => { reload(); refreshProfile?.() }} />}
    </Load>
  )
}

function DetailsForm({ tp, profile, accountEmail, onSaved }) {
  const signed = Boolean(tp?.rules_accepted_at)
  const [kept] = useState(() => {
    const stash = readStash()
    return !tp && stash?.email?.toLowerCase() === accountEmail?.toLowerCase() ? stash : null
  }) // never restore another account's form
  const [v, setV] = useState(() => ({ ...tenantFormValue({ ...profile, tenant_profiles: tp }), ...(kept ?? {}), full_name: profile?.full_name ?? '', phone: profile?.phone ?? '' }))
  const a = useAction()
  const properties = useAsync(registrationProperties, [])
  const save = async (e) => {
    e.preventDefault()
    const bad = validateTenant(v) || (!signed && !v.rules_accepted ? 'Accept the rules and regulations to register' : '')
    if (bad) return a.run(() => Promise.reject(new Error(bad)))
    if (await a.run(() => !tp?.registration_state && v.property_id ? submitRegistration(v) : m.saveMyTenantProfile(v), 'Saved')) { clearStash(); onSaved(); window.dispatchEvent(new Event('focus')) }
  }
  return (
    <form onSubmit={save}>
      <Card>
        {tp && (
          <p className="mb-3 text-sm">Registration: <StatusBadge value={tp.approval_status} />{tp.approval_note && ` · ${tp.approval_note}`}
            {' '}· Police verification: <StatusBadge value={tp.police_status} /></p>
        )}
        {!tp && <div className="mb-3"><Notice tone="warn">{kept ? 'Your registration form is filled in below. Check it and press Save details to submit it.' : 'Complete the registration form, including one emergency contact and the rules, so the office can approve your registration.'}</Notice></div>}
        {!tp?.registration_state && <Field label="Property"><select required className={inputCls} value={v.property_id ?? ''} onChange={(e) => setV({ ...v, property_id: e.target.value })}><option value="">Choose a property</option>{(properties.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
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

// Residents raise complaints for their own room, follow them through the steps, and confirm or reopen them.
// my_complaints() only returns the signed-in resident's own complaints.
export function MyComplaints() {
  const { user } = useAuth()
  return (
    <Load loader={() => Promise.all([cx.myComplaintPlace(), cx.myComplaints()])} deps={[user.id]}>
      {([place, list], reload) => (
        <div className="space-y-4">
          {place ? <RaiseComplaint userId={user.id} place={place} onDone={reload} /> : <Notice>You can raise complaints once your stay has started.</Notice>}
          {list.length === 0
            ? (place && <Empty title="No complaints yet">If something is not working, tell us above and a manager will pick it up.</Empty>)
            : <ul className="space-y-3">{list.map((c) => <li key={c.id}><MyComplaintCard c={c} onChanged={reload} /></li>)}</ul>}
        </div>
      )}
    </Load>
  )
}

const EMPTY_COMPLAINT = { category: '', title: '', description: '', preferred_time: '' }

function RaiseComplaint({ userId, place, onDone }) {
  const [v, setV] = useState(EMPTY_COMPLAINT)
  const [files, setFiles] = useState([])
  const a = useAction()
  const addFiles = (fs) => {
    const bad = cx.checkImages(fs, files.length)
    if (bad) return a.run(() => Promise.reject(new Error(bad)))
    a.clear(); setFiles((x) => [...x, ...fs])
  }
  const submit = async (e) => {
    e.preventDefault()
    const bad = !v.category ? 'Choose a category' : v.title.trim().length < 3 ? 'Give the complaint a short title (3 characters or more)'
      : !v.description.trim() ? 'Describe the problem' : ''
    if (bad) return a.run(() => Promise.reject(new Error(bad)))
    const ok = await a.run(() => cx.raiseMyComplaint(userId, v, files), 'Complaint submitted. You will be notified at every step.')
    if (ok) { setV(EMPTY_COMPLAINT); setFiles([]); onDone() }
  }
  return (
    <Card>
      <form onSubmit={submit} noValidate>
        <h3 className="mb-1 font-semibold">Raise a complaint</h3>
        <p className="mb-3 text-sm text-slate-600">For room {place.room_label || 'your room'}. The admin and managers are notified straight away.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category *">
            <select required className={inputCls} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
              <option value="">Choose a category</option>
              {RESIDENT_COMPLAINT_CATEGORIES.map((c) => <option key={c} value={c}>{complaintCategory(c)}</option>)}
            </select>
          </Field>
          <Field label="Best time to visit your room">
            <input className={inputCls} maxLength={120} value={v.preferred_time} onChange={(e) => setV({ ...v, preferred_time: e.target.value })} placeholder="e.g. after 6 pm" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Title *">
              <input required className={inputCls} maxLength={120} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. Bathroom tap leaking" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description *">
              <textarea required rows={4} className={inputCls} maxLength={2000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })}
                placeholder="What is wrong, where exactly, and since when?" />
            </Field>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FileButton label="Add images (optional)" accept="image/jpeg,image/png,image/webp" multiple busy={a.busy} onFile={addFiles} />
          <span className="text-xs text-slate-500">Up to {cx.MAX_IMAGES} JPG, PNG or WebP images, {cx.MAX_IMAGE_MB} MB each</span>
        </div>
        {files.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full bg-cream px-3 py-1 text-xs">
                {f.name}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}
                  className="rounded-full px-1 text-slate-600 hover:text-navy focus-visible:outline-2 focus-visible:outline-navy">×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={a.busy}>{a.busy ? 'Submitting…' : 'Submit complaint'}</Button>
          <ActionMsg action={a} />
        </div>
      </form>
    </Card>
  )
}

const STEPS = ['new', 'assigned', 'in_progress', 'resolved', 'closed']
function ComplaintSteps({ status }) {
  const at = STEPS.indexOf(status)
  return (
    <ol aria-label={`Progress: ${complaintStatus(status)}`} className="mt-3 flex flex-wrap gap-x-1 gap-y-1 text-xs">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined}
          className={`rounded-full px-2.5 py-0.5 ${i < at ? 'bg-navy/10 text-navy' : i === at ? 'bg-navy font-semibold text-white' : 'bg-slate-100 text-slate-600'}`}>
          {complaintStatus(s)}
        </li>
      ))}
    </ol>
  )
}

function MyComplaintCard({ c, onChanged }) {
  const [open, setOpen] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [reason, setReason] = useState('')
  const [rating, setRating] = useState('5')
  const a = useAction()
  const done = async (fn, msg, ask) => {
    if (ask && !window.confirm(ask)) return
    if (await a.run(fn, msg)) { setReopening(false); setReason(''); onChanged() }
  }
  return (
    <Card className="!p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold">#{c.ticket_no} {c.title}</p>
        <ComplaintStatusBadge status={c.status} />
      </div>
      <p className="text-xs text-slate-500">
        {complaintCategory(c.category)}{c.room_label ? ` · room ${c.room_label}` : ''} · raised {formatDateTime(c.created_at)}
        {c.reopen_count > 0 ? ` · reopened ${c.reopen_count}×` : ''}
      </p>
      <p className="mt-1 text-sm">{c.assignee_name ? <>Handled by <strong>{c.assignee_name}</strong></> : <span className="text-slate-600">Waiting for a manager to pick it up</span>}</p>
      <ComplaintSteps status={c.status} />
      {c.description && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{c.description}</p>}
      {c.photos?.length > 0 && <div className="mt-2"><ComplaintImages paths={c.photos} name="Your image" /></div>}
      {c.resolution && ['resolved', 'closed'].includes(c.status) && (
        <div className="mt-3 rounded-xl bg-cream p-3 text-sm">
          <p className="font-medium">How it was fixed</p>
          <p className="whitespace-pre-line">{c.resolution}</p>
          {c.after_photos?.length > 0 && <div className="mt-2"><ComplaintImages paths={c.after_photos} name="Resolution image" /></div>}
        </div>
      )}

      {c.status === 'resolved' && !reopening && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="How did we do?">
            <select className={`${inputCls} !w-28`} value={rating} onChange={(e) => setRating(e.target.value)}>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}
            </select>
          </Field>
          <Button variant="outline" disabled={a.busy} onClick={() => done(() => cx.confirmFixed(c.id, rating), 'Thanks! Complaint closed.', 'Confirm the issue is fixed and close this complaint?')}>Confirm fixed</Button>
          <Button variant="danger" disabled={a.busy} onClick={() => setReopening(true)}>Still not fixed</Button>
        </div>
      )}
      {reopening && (
        <div className="mt-3">
          <Field label="What is still wrong? *">
            <textarea rows={2} className={inputCls} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="danger" disabled={a.busy || !reason.trim()} onClick={() => done(() => cx.reopenComplaint(c.id, reason.trim()), 'Complaint reopened', 'Reopen this complaint?')}>Reopen complaint</Button>
            <Button variant="outline" onClick={() => { setReopening(false); setReason('') }}>Cancel</Button>
          </div>
        </div>
      )}
      {c.rating && <p className="mt-2 text-xs">Your rating: {c.rating}/5</p>}
      <div className="mt-2"><ActionMsg action={a} /></div>

      <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)}
        className="mt-3 text-sm font-medium text-navy underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-navy">
        {open ? 'Hide activity' : 'Show activity'}
      </button>
      {open && <div className="mt-2"><ComplaintTimeline id={c.id} version={c.updated_at} /></div>}
    </Card>
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
