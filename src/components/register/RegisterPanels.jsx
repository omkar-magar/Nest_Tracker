import { useState } from 'react'
import DataTable from '../manage/DataTable'
import { ActionMsg, FileButton, FormFields, Load, Modal, Small, useAction } from '../manage/kit'
import { Badge, Button, Empty, Field, Notice, inputCls } from '../ui'
import * as r from '../../services/register'
import { parseCSV } from '../../services/exporters'
import { ymd } from '../../services/pg'
import { formatDate, rupees } from '../../services/format'
import ExtendStay from './ExtendStay'

const statusOpts = r.STATUSES.map((s) => [s, r.STATUS_TEXT[s]])
export const STATUS_TONE = { paid: 'green', pending: 'red', partially_paid: 'amber', not_updated: 'gray', not_applicable: 'gray' }
export const StatusPill = ({ value }) => <Badge tone={STATUS_TONE[value] ?? 'gray'}>{r.STATUS_TEXT[value] ?? 'Not updated'}</Badge>

export function guestFields(roomNos) {
  return [
    roomNos.length ? { key: 'room_no', label: 'Room', type: 'select', required: true, options: roomNos.map((n) => [n, n]) }
      : { key: 'room_no', label: 'Room', required: true },
    { key: 'name', label: 'Guest name' },
    { key: 'contact', label: 'Contact (10 digits)', type: 'tel' },
    { key: 'rent', label: 'Rent (₹)', type: 'number', min: 0 },
    { key: 'rent_status', label: 'Rent status', type: 'select', required: true, options: statusOpts },
    { key: 'deposit', label: 'Deposit (₹)', type: 'number', min: 0 },
    { key: 'deposit_status', label: 'Deposit status', type: 'select', required: true, options: statusOpts },
    { key: 'check_in', label: 'Check-in date', type: 'date' },
    { key: 'expected_checkout', label: 'Expected check-out', type: 'date', help: 'Leave empty for a monthly stay with no end date' },
    { key: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
  ]
}

export function AddGuestModal({ pid, roomNos, room, after, onClose, onDone }) {
  const [v, setV] = useState({ room_no: room || roomNos[0] || '', rent_status: 'not_updated', deposit_status: 'not_updated', check_in: ymd() })
  const a = useAction()
  const submit = async (e) => {
    e.preventDefault()
    if (v.contact && !/^\d{10}$/.test(v.contact)) return a.run(() => Promise.reject(new Error('Contact must be exactly 10 digits')))
    if (await a.run(() => r.addGuest(pid, v, after))) onDone()
  }
  return (
    <Modal title="Add guest" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormFields fields={guestFields(roomNos)} value={v} onChange={setV} />
        <ActionMsg action={a} />
        <Button type="submit" disabled={a.busy} className="w-full">{a.busy ? 'Saving…' : 'Save guest'}</Button>
      </form>
    </Modal>
  )
}

// "Delete" in the register is a check-out: the guest moves to Past guests with the date. Blank rows are removed.
export function CheckoutModal({ guest, onClose, onDone }) {
  const [date, setDate] = useState(ymd())
  const [note, setNote] = useState('')
  const a = useAction()
  const named = r.occupies(guest)
  return (
    <Modal title={named ? `Check out ${guest.name}` : 'Remove empty entry'} onClose={onClose}>
      {named ? (
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (await a.run(() => r.checkoutGuest(guest.id, date, note))) onDone() }}>
          <p className="text-sm text-slate-600">Room {guest.room_no}{guest.check_in ? ` · checked in ${formatDate(guest.check_in)}` : ''}. They will be listed under Past guests.</p>
          <Field label="Check-out date *"><input type="date" required className={inputCls} value={date} min={guest.check_in || undefined} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Note (optional)"><input className={inputCls} value={note} placeholder="e.g. deposit returned, keys collected" onChange={(e) => setNote(e.target.value)} /></Field>
          <ActionMsg action={a} />
          <Button type="submit" disabled={a.busy || !date} className="w-full">{a.busy ? 'Saving…' : 'Check out'}</Button>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">This entry in room {guest.room_no} has no guest name, so there is nobody to check out. Remove it?</p>
          <ActionMsg action={a} />
          <Button variant="danger" disabled={a.busy} onClick={async () => (await a.run(() => r.removeEntry(guest.id))) && onDone()}>Remove entry</Button>
        </div>
      )}
    </Modal>
  )
}

export function PastGuests({ pid, canEdit, onChanged }) {
  const a = useAction()
  const [extending, setExtending] = useState(null)
  return (
    <Load loader={() => r.loadPastGuests(pid)} deps={[pid]}>
      {(list, reload) => (
        <div>
          <p className="mb-3 text-sm text-slate-600">Everyone who has checked out, newest first.</p>
          <ActionMsg action={a} />
          <DataTable title="Past guests" rows={list} empty="Nobody has checked out yet" columns={[
            { key: 'name', label: 'Guest' },
            { key: 'contact', label: 'Contact' },
            { key: 'room_no', label: 'Room' },
            { key: 'check_in', label: 'Checked in', render: (g) => formatDate(g.check_in), value: (g) => g.check_in ?? '' },
            { key: 'checked_out_on', label: 'Checked out', render: (g) => formatDate(g.checked_out_on), value: (g) => g.checked_out_on },
            { key: 'days', label: 'Stayed', value: (g) => r.nightsBetween(g.check_in, g.checked_out_on) ?? '', render: (g) => { const n = r.nightsBetween(g.check_in, g.checked_out_on); return n === null ? '—' : `${n} days` } },
            { key: 'rent', label: 'Rent', render: (g) => (g.rent === null ? '—' : rupees(g.rent)), value: (g) => g.rent ?? '' },
            { key: 'deposit_status', label: 'Deposit', render: (g) => <>{g.deposit === null ? '—' : rupees(g.deposit)} <StatusPill value={g.deposit_status} /></>, value: (g) => `${g.deposit ?? ''} ${r.STATUS_TEXT[g.deposit_status]}` },
            { key: 'checkout_note', label: 'Note', value: (g) => [g.checkout_note, g.notes].filter(Boolean).join(' · ') },
            ...(canEdit ? [{ key: 'undo', label: '', noExport: true, render: (g) => (
              <Small disabled={a.busy} onClick={async () => {
                if (!window.confirm(`Move ${g.name} back to current guests?`)) return
                if (await a.run(() => r.returnGuest(g.id), 'Moved back to current guests')) { reload(); onChanged?.() }
              }}>Undo check-out</Small>
            ) }, { key: 'extend', label: '', noExport: true, render: (g) => <Small onClick={() => setExtending(g)}>Extend stay</Small> }] : []),
          ]} />
          {extending && <ExtendStay guest={extending} onClose={() => setExtending(null)} onDone={() => { setExtending(null); reload(); onChanged?.() }} />}
        </div>
      )}
    </Load>
  )
}

const OP_TEXT = { INSERT: 'Added', UPDATE: 'Edited', DELETE: 'Removed', CHECKOUT: 'Checked out', RETURN: 'Back from check-out' }
const SHOWN = ['room_no', 'name', 'contact', 'rent', 'rent_status', 'deposit', 'deposit_status', 'check_in', 'expected_checkout', 'checked_out_on', 'notes']
const diff = (o = {}, n = {}) => SHOWN.filter((k) => String(o[k] ?? '') !== String(n[k] ?? ''))
  .map((k) => `${k.replace(/_/g, ' ')}: ${o[k] || '-'} → ${n[k] || '-'}`).join(', ') || 'order updated'
const dayKey = (t) => new Date(t).toLocaleDateString('en-CA')

export function History({ pid, onChanged }) {
  const [day, setDay] = useState('')
  const a = useAction()
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="Show one day"><input type="date" className={`${inputCls} !w-auto`} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        {day && <Button variant="outline" onClick={() => setDay('')}>All dates (latest 500)</Button>}
      </div>
      <ActionMsg action={a} />
      <Load loader={() => r.loadRegisterHistory(pid, day)} deps={[pid, day]}>
        {(rows, reload) => {
          if (!rows.length) return <Empty title="No changes found" />
          const days = []
          for (const h of rows) { const k = dayKey(h.changed_at); if (days.at(-1)?.k !== k) days.push({ k, rows: [] }); days.at(-1).rows.push(h) }
          return days.map((d) => (
            <section key={d.k} className="mb-4">
              <h4 className="sticky top-0 flex justify-between rounded-xl bg-cream px-3 py-1.5 text-xs font-bold">
                <span>{formatDate(d.k)}</span><span>{d.rows.length} change{d.rows.length === 1 ? '' : 's'}</span>
              </h4>
              <ul className="divide-y divide-navy/5 text-sm">
                {d.rows.map((h) => {
                  const g = h.new_row ?? h.old_row ?? {}
                  return (
                    <li key={h.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p><span className="font-semibold">{OP_TEXT[h.op] ?? h.op}</span> · Room {g.room_no} · {g.name || '-'}</p>
                        {h.op === 'UPDATE' && <p className="break-words text-slate-600">{diff(h.old_row, h.new_row)}</p>}
                        {h.op === 'CHECKOUT' && <p className="text-slate-600">on {formatDate(h.new_row?.checked_out_on)}{h.new_row?.checkout_note ? ` · ${h.new_row.checkout_note}` : ''}</p>}
                        <p className="text-xs text-slate-500">{new Date(h.changed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}{h.changed_by_name ? ` · ${h.changed_by_name}` : ''}</p>
                      </div>
                      <Small disabled={a.busy} onClick={async () => {
                        if (!window.confirm('Undo this change?')) return
                        if (await a.run(() => r.restoreHistory(h.id), 'Change undone')) { reload(); onChanged?.() }
                      }}>{h.op === 'INSERT' ? 'Undo add' : h.op === 'DELETE' ? 'Restore' : 'Restore previous'}</Small>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        }}
      </Load>
    </div>
  )
}

// Review screen for a ?changes= link: nothing is saved until Apply.
export function ChangesModal({ pid, plan, onClose, onDone }) {
  const a = useAction()
  const good = plan.items.filter((i) => i.ok).length
  return (
    <Modal title="Review changes from link" onClose={onClose} wide>
      <p className="mb-3 text-sm text-slate-600">Nothing is saved until you press Apply.</p>
      <ul className="space-y-2">
        {plan.items.map((i, n) => (
          <li key={n} className={`rounded-xl border p-2.5 text-sm ${i.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50 text-red-800'}`}>
            <span className="mr-2 rounded-full bg-white px-2 py-0.5 text-xs font-bold">{i.tag}</span>{i.text}
            {!i.ok && <strong> · {i.err} (skipped)</strong>}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={!good || a.busy} onClick={async () => (await a.run(() => r.applyChanges(pid, plan.ops))) && onDone(good)}>
          {a.busy ? 'Applying…' : `Apply ${good} change${good === 1 ? '' : 's'}`}
        </Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
      <div className="mt-2"><ActionMsg action={a} /></div>
    </Modal>
  )
}

async function readFile(file) {
  const text = await file.text()
  if (/\.json$/i.test(file.name) || text.trim().startsWith('{') || text.trim().startsWith('[')) return JSON.parse(text)
  return parseCSV(text)
}

export function Tools({ pid, guests, roomNos, wings = [], onChanged }) {
  const [preview, setPreview] = useState(null)
  const [file, setFile] = useState(null)
  const [wing, setWing] = useState(wings[0] ?? '')
  const [withPast, setWithPast] = useState(true)
  const a = useAction()
  const base = `${window.location.origin}/staff/manager`
  const guide = r.guideText(base, roomNos)
  const copy = (text, msg) => a.run(() => navigator.clipboard.writeText(text), msg)

  const load = async (f, w = wing) => {
    setFile(f); setPreview(null)
    await a.run(async () => setPreview({ name: f.name, ...r.parseImport(await readFile(f), guests, { wing: w }) }))
  }
  const ops = preview ? [...preview.ops, ...(withPast ? preview.past : [])] : []
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-lg font-bold">Import guests</h3>
        <p className="mt-1 text-sm text-slate-600">
          Use the <strong>Backup (JSON)</strong> file from the old PG Manager page, or a CSV (in Excel: File → Save as → CSV) with columns
          like Room, Name, Contact, Rent, Deposit, Rent status, Deposit status, Check-in, Expected check-out, Notes.
          Guests already in the register (same room and name) are skipped.
        </p>
        {wings.length > 0 && (
          <label className="mt-3 block text-sm font-medium">Rooms in the file without a wing (like 101) belong to{' '}
            <select className={`${inputCls} !w-auto`} value={wing} onChange={(e) => { setWing(e.target.value); if (file) load(file, e.target.value) }}>
              {wings.map((w) => <option key={w} value={w}>Wing {w}</option>)}
            </select>
          </label>
        )}
        <div className="mt-3"><FileButton label="Choose file" accept=".json,.csv,application/json,text/csv" onFile={load} busy={a.busy && !preview} /></div>
        {preview && (
          <div className="mt-4 space-y-3 rounded-2xl border border-navy/10 bg-white p-4 text-sm">
            <p><strong>{preview.name}</strong>: {preview.ops.length} current guest{preview.ops.length === 1 ? '' : 's'} to add.</p>
            {preview.past.length > 0 && (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-navy" checked={withPast} onChange={(e) => setWithPast(e.target.checked)} />
                <span>Also add the {preview.past.length} guest{preview.past.length === 1 ? '' : 's'} deleted in the old page to Past guests
                  (check-out date = the day they were deleted). Untick if some of those deletions were mistakes.</span>
              </label>
            )}
            {preview.skipped.length > 0 && (
              <details><summary className="cursor-pointer">{preview.skipped.length} row{preview.skipped.length === 1 ? '' : 's'} skipped</summary>
                <ul className="mt-2 list-disc pl-5 text-slate-600">{preview.skipped.map((s) => <li key={s}>{s}</li>)}</ul>
              </details>
            )}
            {guests.length > 0 && <Notice tone="warn">The register already has {guests.length} guests. Check the numbers above before importing.</Notice>}
            <Button disabled={!ops.length || a.busy} onClick={async () => {
              if (await a.run(() => r.applyChanges(pid, ops, true), `${ops.length} guests imported`)) { setPreview(null); onChanged() }
            }}>Import {ops.length}</Button>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-lg font-bold">AI link guide</h3>
        <p className="mt-1 text-sm text-slate-600">
          Paste these instructions into any AI chat once. Then ask, for example, “mark Rahul in 101 as paid” and it replies with a link.
          Opening the link here shows the changes and saves them only when you press Apply. A “checkout” in a link checks the guest out.
        </p>
        <label className="mt-3 block text-sm"><span className="sr-only">AI instructions</span>
          <textarea readOnly rows={10} className={`${inputCls} font-mono text-xs`} value={guide} />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={() => copy(guide, 'AI instructions copied')}>Copy AI instructions</Button>
          <Button variant="outline" onClick={() => copy(`Current guests (room | name | rent | rent status | deposit | deposit status | expected check-out):\n${
            r.sortGuests(guests).map((g) => [g.room_no, g.name || '-', g.rent ?? '-', r.STATUS_TEXT[g.rent_status], g.deposit ?? '-', r.STATUS_TEXT[g.deposit_status], g.expected_checkout || '-'].join(' | ')).join('\n')}`,
          'Guest list copied (no phone numbers)')}>Copy guest list (no phone numbers)</Button>
        </div>
      </section>
      <ActionMsg action={a} />
    </div>
  )
}
