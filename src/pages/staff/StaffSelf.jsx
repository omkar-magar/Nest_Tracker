import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { ActionMsg, FileButton, FormFields, H3, Load, Small, StatusBadge, useAction } from '../../components/manage/kit'
import { Button, Card, Empty, Notice } from '../../components/ui'
import * as m from '../../services/manage'
import { complaintCategory, complaintMoves, label, ymd } from '../../services/pg'
import { payslipPdf } from '../../services/pdfDocs'
import { formatDate, formatDateTime, rupees } from '../../services/format'

// The employee's own screens: attendance check-in with selfie and GPS, today's checklist, assigned complaints,
// leave and payslips. Everything is limited to their own rows by RLS.
const me = m.loadMyStaff

function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This device cannot share its location')); return }
    navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), () => reject(new Error('Allow location access to check in')),
      { enableHighAccuracy: true, timeout: 15000 })
  })
}

export function Today() {
  const { user } = useAuth()
  const a = useAction()
  return (
    <Load loader={() => me(user.id).then(async (s) => (s ? [s, await m.rows('attendance', '*', (q) => q.eq('staff_id', s.id).eq('work_date', ymd()).maybeSingle()),
      await m.rows('staff_tasks', '*', (q) => q.eq('staff_id', s.id).eq('task_date', ymd()).order('title'))] : [null]))} deps={[user.id]}>
      {([s, att, tasks], reload) => {
        if (!s) return <Notice>Your login is not linked to a staff profile yet. Ask the manager to link it under Employees.</Notice>
        const checkIn = (selfie) => a.run(async () => {
          const c = await position()
          const path = await m.uploadFile('employee-documents', s.id, selfie)
          const r = await m.staffCheckIn(c.latitude, c.longitude, path)
          reload()
          return r
        }, 'Checked in')
        return (
          <div className="space-y-6">
            <Card>
              <H3>Attendance · {formatDate(new Date())}</H3>
              {att?.check_in_at ? (
                <p className="text-sm">Checked in at {formatDateTime(att.check_in_at)}{att.distance_m != null && ` · ${att.distance_m} m from the property`}
                  {att.check_out_at ? ` · out at ${formatDateTime(att.check_out_at)}` : ''}</p>
              ) : att ? <p className="text-sm">Marked: {label(att.status)}</p> : <p className="text-sm">Not checked in yet.</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {!att?.check_in_at && <FileButton label="Check in (take selfie)" accept="image/*" capture="user" busy={a.busy} onFile={checkIn} />}
                {att?.check_in_at && !att.check_out_at && <Button variant="outline" disabled={a.busy} onClick={async () => (await a.run(() => m.staffCheckOut(), 'Checked out')) && reload()}>Check out</Button>}
              </div>
              <div className="mt-2"><ActionMsg action={a} /></div>
              <p className="mt-2 text-xs text-slate-500">Your location is checked against the property when you check in.</p>
            </Card>
            <section>
              <H3>Today's checklist</H3>
              {tasks.length === 0 ? <Empty title="No tasks today" /> : (
                <ul className="space-y-2">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-navy/10 bg-white p-3 text-sm">
                      <span className={t.done_at ? 'text-slate-500 line-through' : 'font-medium'}>{t.title}{t.requires_photo && !t.done_at && ' (photo needed)'}</span>
                      {t.done_at ? <StatusBadge value="done" tones={{ done: 'green' }} /> : t.requires_photo
                        ? <FileButton label="Photo & done" accept="image/*" capture="environment" busy={a.busy} onFile={(f) => a.run(async () => {
                          await m.completeTask(t.id, await m.uploadFile('employee-documents', s.id, f)); reload()
                        })} />
                        : <Small onClick={async () => (await a.run(() => m.completeTask(t.id))) && reload()}>Done</Small>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )
      }}
    </Load>
  )
}

export function MyComplaints() {
  const { user } = useAuth()
  const [notes, setNotes] = useState({})
  const a = useAction()
  return (
    <Load loader={() => m.rows('complaints', '*, rooms(room_no)', (q) => q.eq('assigned_to', user.id).order('created_at', { ascending: false }).limit(100))} deps={[user.id]}>
      {(list, reload) => (list.length === 0 ? <Empty title="No complaints assigned to you" /> : (
        <ul className="space-y-3">
          {list.map((c) => (
            <li key={c.id}>
              <Card className="!p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">#{c.ticket_no} {c.title}</p>
                  <span className="flex gap-1"><StatusBadge value={c.priority} /><StatusBadge value={c.status} /></span>
                </div>
                <p className="text-sm text-slate-600">{complaintCategory(c.category)} · {c.is_common_area ? 'Common area' : `Room ${c.rooms?.room_no ?? ''}`} · due {formatDateTime(c.due_at)}{c.preferred_time ? ` · tenant prefers ${c.preferred_time}` : ''}</p>
                {c.description && <p className="mt-1 text-sm">{c.description}</p>}
                {['assigned', 'in_progress', 'new'].includes(c.status) && (
                  <div className="mt-3 space-y-2">
                    <FormFields value={notes[c.id] ?? { note: '', resolution: c.resolution, cost: c.cost }} onChange={(v) => setNotes((n) => ({ ...n, [c.id]: v }))} fields={[
                      { key: 'note', label: 'Work note', type: 'textarea' }, { key: 'resolution', label: 'What was fixed' }, { key: 'cost', label: 'Material cost (₹)', type: 'number', min: 0 },
                    ]} />
                    <div className="flex flex-wrap gap-2">
                      {complaintMoves(c.status, { staff: true }).map((s) => (
                        <Button key={s} variant="outline" disabled={a.busy} onClick={async () => {
                          const n = notes[c.id] ?? {}
                          if (await a.run(() => m.updateComplaint(c.id, { status: s, note: n.note ?? '', resolution: n.resolution ?? c.resolution, cost: Number(n.cost ?? c.cost ?? 0) }))) reload()
                        }}>{s === 'in_progress' ? 'Start work' : `Mark ${label(s).toLowerCase()}`}</Button>
                      ))}
                      <FileButton label="After photo" accept="image/*" capture="environment" busy={a.busy} onFile={(f) => a.run(async () => {
                        const p = await m.uploadFile('complaint-media', user.id, f)
                        await m.updateComplaint(c.id, { after_photos: [...(c.after_photos ?? []), p] }); reload()
                      }, 'Photo added')} />
                    </div>
                  </div>
                )}
              </Card>
            </li>
          ))}
          <ActionMsg action={a} />
        </ul>
      ))}
    </Load>
  )
}

export function MyLeave() {
  const { user } = useAuth()
  const [v, setV] = useState({ type: 'casual', from: ymd(), to: ymd(), half: false, reason: '' })
  const a = useAction()
  return (
    <Load loader={() => me(user.id).then(async (s) => (s ? [s, await m.leaveBalance(s.id), await m.rows('leave_requests', '*', (q) => q.eq('staff_id', s.id).order('created_at', { ascending: false }))] : [null]))} deps={[user.id]}>
      {([s, bal, list], reload) => (!s ? <Notice>Your login is not linked to a staff profile yet.</Notice> : (
        <div className="space-y-6">
          <p className="text-sm">Balance this year: paid {bal?.paid ?? 0} · sick {bal?.sick ?? 0} · casual {bal?.casual ?? 0}</p>
          <Card>
            <FormFields value={v} onChange={setV} fields={[
              { key: 'type', label: 'Leave type', type: 'select', required: true, options: ['casual', 'sick', 'paid', 'unpaid'] },
              { key: 'from', label: 'From', type: 'date', required: true }, { key: 'to', label: 'To', type: 'date', required: true },
              { key: 'half', label: 'Half day', type: 'checkbox' }, { key: 'reason', label: 'Reason', type: 'textarea' },
            ]} />
            <Button className="mt-3" disabled={a.busy} onClick={async () => (await a.run(() => m.requestLeave(null, v.type, v.from, v.to, v.reason, v.half), 'Requested')) && reload()}>Request leave</Button>
            <div className="mt-2"><ActionMsg action={a} /></div>
          </Card>
          <ul className="divide-y divide-navy/5 text-sm">
            {list.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2">
                <span>{label(l.leave_type)} · {formatDate(l.from_date)} – {formatDate(l.to_date)} ({l.days} d)</span>
                <span className="flex gap-1"><StatusBadge value={l.status} />{l.status === 'pending' && <Small onClick={async () => (await a.run(() => m.updateRow('leave_requests', l.id, { status: 'cancelled' }))) && reload()}>Cancel</Small>}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Load>
  )
}

export function MyPayslips() {
  const { user } = useAuth()
  return (
    <Load loader={() => me(user.id).then(async (s) => (s ? [s, await m.rows('payslips', '*', (q) => q.eq('staff_id', s.id).order('month', { ascending: false }))] : [null, []]))} deps={[user.id]}>
      {([s, list]) => (!s ? <Notice>Your login is not linked to a staff profile yet.</Notice> : list.length === 0 ? <Empty title="No payslips yet" /> : (
        <ul className="divide-y divide-navy/5 text-sm">
          {list.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <span>{new Date(p.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} · net {rupees(p.net)} · paid {formatDate(p.paid_on)}</span>
              <Small onClick={() => payslipPdf({ slip: p, staff: s })}>Download</Small>
            </li>
          ))}
        </ul>
      ))}
    </Load>
  )
}

export function Notices() {
  return (
    <Load loader={() => m.rows('notices', '*', (q) => q.order('created_at', { ascending: false }).limit(50))}>
      {(list) => (list.length === 0 ? <Empty title="No notices" /> : (
        <ul className="space-y-3">
          {list.map((n) => (
            <li key={n.id}><Card className="!p-4"><p className="font-semibold">{n.title}</p><p className="whitespace-pre-line text-sm">{n.body}</p><p className="mt-1 text-xs text-slate-500">{formatDate(n.created_at)}</p></Card></li>
          ))}
        </ul>
      ))}
    </Load>
  )
}
