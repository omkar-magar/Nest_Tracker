import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CrudPanel from '../../components/manage/CrudPanel'
import DataTable from '../../components/manage/DataTable'
import { ActionMsg, FileButton, FormFields, H3, Load, Modal, Small, StatusBadge, Tabs, useAction, useScope } from '../../components/manage/kit'
import { Button, Notice, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { PAY_MODES, addDays, label, maskId, monthStart, ymd } from '../../services/pg'
import { payslipPdf } from '../../services/pdfDocs'
import { formatDate, formatDateTime, rupees } from '../../services/format'

const DESIGNATIONS = ['manager', 'caretaker', 'housekeeping', 'cook', 'security', 'maintenance', 'sales', 'other']

const TABS = ['people', 'attendance', 'roster', 'leave', 'payroll', 'advances', 'tasks', 'notices']

export default function Staff() {
  const [params] = useSearchParams()
  // ?tab=leave opens a section directly (links from Recent activity)
  const [tab, setTab] = useState(() => (TABS.includes(params.get('tab')) ? params.get('tab') : 'people'))
  return (
    <div>
      <Tabs tab={tab} onTab={setTab} tabs={[['people', 'Employees'], ['attendance', 'Attendance'], ['roster', 'Shifts & roster'], ['leave', 'Leave'],
        ['payroll', 'Payroll'], ['advances', 'Advances & loans'], ['tasks', 'Tasks'], ['notices', 'Notices']]} />
      {tab === 'people' && <People />}
      {tab === 'attendance' && <Attendance />}
      {tab === 'roster' && <Roster />}
      {tab === 'leave' && <Leave />}
      {tab === 'payroll' && <Payroll />}
      {tab === 'advances' && <Advances />}
      {tab === 'tasks' && <Tasks />}
      {tab === 'notices' && <Notices />}
    </div>
  )
}

const scoped = (property) => (q) => (property ? q.eq('property_id', property) : q)

function People() {
  const { property, properties } = useScope()
  const [docs, setDocs] = useState(null)
  return (
    <Load loader={() => m.loadStaffLogins()}>
      {(logins) => (
        <>
          <CrudPanel table="staff_members" title="Employees" deps={[property]} canDelete={false}
            query={(q) => scoped(property)(q).order('status').order('full_name')}
            defaults={{ property_id: property || properties[0]?.id, designation: 'housekeeping', employment_type: 'full_time', status: 'active', joining_date: ymd(),
              basic_pay: 0, allowances: 0, per_day_rate: 0, overtime_rate: 0, paid_leave_quota: 12, sick_leave_quota: 6, casual_leave_quota: 6 }}
            columns={[
              { key: 'full_name', label: 'Name' }, { key: 'designation', label: 'Role', value: (s) => label(s.designation) }, { key: 'property_id', label: 'Property' },
              { key: 'phone', label: 'Mobile' }, { key: 'employment_type', label: 'Type', value: (s) => label(s.employment_type) },
              { key: 'joining_date', label: 'Joined', render: (s) => formatDate(s.joining_date) },
              { key: 'pay', label: 'Pay', value: (s) => (s.employment_type === 'daily_wage' ? `₹${s.per_day_rate}/day` : `₹${s.basic_pay + s.allowances}/month`) },
              { key: 'login', label: 'App login', value: (s) => (s.user_id ? logins.find((l) => l.id === s.user_id)?.full_name ?? 'linked' : '') },
              { key: 'status', label: 'Status', render: (s) => <StatusBadge value={s.status} tones={{ resigned: 'gray', inactive: 'gray' }} />, value: (s) => s.status },
            ]}
            extraActions={(s) => <Small onClick={() => setDocs(s)}>Documents</Small>}
            fields={[
              { key: 'full_name', label: 'Full name', required: true }, { key: 'phone', label: 'Mobile', type: 'tel', keepEmpty: true },
              { key: 'property_id', label: 'Property', type: 'select', required: true, options: properties.map((p) => [p.id, p.name]) },
              { key: 'designation', label: 'Role / designation', type: 'select', required: true, options: DESIGNATIONS },
              { key: 'employment_type', label: 'Employment type', type: 'select', required: true, options: ['full_time', 'part_time', 'contract', 'daily_wage'] },
              { key: 'joining_date', label: 'Joining date', type: 'date', required: true },
              { key: 'address', label: 'Address', type: 'textarea', keepEmpty: true },
              { key: 'emergency_name', label: 'Emergency contact', keepEmpty: true }, { key: 'emergency_relation', label: 'Relationship', keepEmpty: true },
              { key: 'emergency_phone', label: 'Emergency mobile', type: 'tel', keepEmpty: true },
              { key: 'basic_pay', label: 'Basic pay (₹/month)', type: 'number', min: 0 }, { key: 'allowances', label: 'Allowances (₹/month)', type: 'number', min: 0 },
              { key: 'per_day_rate', label: 'Per-day rate (daily wage)', type: 'number', min: 0 }, { key: 'overtime_rate', label: 'Overtime (₹/hour)', type: 'number', min: 0 },
              { key: 'pf_applicable', label: 'PF deducted', type: 'checkbox' }, { key: 'esi_applicable', label: 'ESI deducted', type: 'checkbox' },
              { key: 'weekly_off_day', label: 'Weekly off', type: 'select', options: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => [String(i), d]) },
              { key: 'paid_leave_quota', label: 'Paid leave / year', type: 'number', min: 0 }, { key: 'sick_leave_quota', label: 'Sick leave / year', type: 'number', min: 0 },
              { key: 'casual_leave_quota', label: 'Casual leave / year', type: 'number', min: 0 },
              { key: 'bank_account_name', label: 'Bank account name', keepEmpty: true }, { key: 'bank_account_no', label: 'Account number', keepEmpty: true },
              { key: 'bank_ifsc', label: 'IFSC', keepEmpty: true }, { key: 'upi_id', label: 'UPI id', keepEmpty: true },
              { key: 'user_id', label: 'App login (employee / manager / sales account)', type: 'select', options: logins.filter((l) => l.role !== 'admin').map((l) => [l.id, `${l.full_name} (${l.role})`]) },
              { key: 'status', label: 'Status', type: 'select', required: true, options: ['active', 'inactive', 'resigned'] },
              { key: 'exit_date', label: 'Exit date', type: 'date', hidden: (v) => v.status === 'active' }, { key: 'exit_reason', label: 'Exit reason', keepEmpty: true, hidden: (v) => v.status === 'active' },
            ]}
            toForm={(s) => ({ ...s, weekly_off_day: s.weekly_off_day == null ? '' : String(s.weekly_off_day) })}
            fromForm={(d) => ({ ...d, weekly_off_day: d.weekly_off_day == null || d.weekly_off_day === '' ? null : Number(d.weekly_off_day) })} />
          <p className="mt-2 text-xs text-slate-500">Logins are created under Settings & users. Salary changes are kept as a revision history.</p>
          {docs && <StaffDocs staff={docs} onClose={() => setDocs(null)} />}
        </>
      )}
    </Load>
  )
}

function StaffDocs({ staff, onClose }) {
  const [meta, setMeta] = useState({ doc_type: 'id_proof', idNumber: '' })
  const a = useAction()
  return (
    <Modal title={`${staff.full_name} · documents`} onClose={onClose} wide>
      <Load loader={() => Promise.all([m.rows('staff_documents', '*', (q) => q.eq('staff_id', staff.id).order('created_at', { ascending: false })),
        m.rows('salary_revisions', '*', (q) => q.eq('staff_id', staff.id).order('effective_from', { ascending: false }))])}>
        {([docs, revs], reload) => (
          <>
            <FormFields value={meta} onChange={setMeta} fields={[
              { key: 'doc_type', label: 'Document', type: 'select', required: true, options: ['id_proof', 'pan', 'address_proof', 'police_verification', 'contract', 'bank', 'photo', 'other'] },
              { key: 'idNumber', label: 'ID / PAN number (only last 4 kept)' },
            ]} />
            <div className="mt-3 flex items-center gap-3">
              <FileButton busy={a.busy} onFile={(f) => a.run(async () => {
                const path = await m.uploadFile('employee-documents', staff.id, f)
                const last4 = meta.idNumber.replace(/[^0-9A-Za-z]/g, '').slice(-4)
                await m.insertRow('staff_documents', { staff_id: staff.id, doc_type: meta.doc_type, file_path: path, file_name: f.name, id_last4: last4.length === 4 ? last4 : null })
                reload()
              }, 'Uploaded')} />
              <ActionMsg action={a} />
            </div>
            <ul className="mt-4 divide-y divide-navy/5 text-sm">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2">
                  <span>{label(d.doc_type)} {maskId(d.id_last4)} · {d.file_name}</span>
                  <Small onClick={() => a.run(async () => window.open(await m.fileUrl('employee-documents', d.file_path), '_blank', 'noopener'))}>View</Small>
                </li>
              ))}
            </ul>
            <H3>Salary history</H3>
            <ul className="text-sm">{revs.map((r) => <li key={r.id}>{formatDate(r.effective_from)} · {r.reason}: basic {rupees(r.basic_pay)}, allowances {rupees(r.allowances)}, per day {rupees(r.per_day_rate)}</li>)}</ul>
          </>
        )}
      </Load>
    </Modal>
  )
}

// PRD 10.2 daily attendance marked by the manager; self check-ins (selfie + GPS) show here too
function Attendance() {
  const { property } = useScope()
  const [date, setDate] = useState(ymd())
  const a = useAction()
  return (
    <>
      <label className="mb-3 block text-sm">Date <input type="date" max={ymd()} className={`${inputCls} !w-auto`} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <Load deps={[property, date]} loader={() => Promise.all([m.rows('staff_members', 'id, full_name, designation, property_id', (q) => scoped(property)(q).eq('status', 'active').order('full_name')),
        m.rows('attendance', '*', (q) => q.eq('work_date', date))])}>
        {([staff, att], reload) => (
          <>
            <DataTable title={`Attendance ${date}`} rows={staff.map((s) => ({ ...s, a: att.find((x) => x.staff_id === s.id) }))} search={false} columns={[
              { key: 'full_name', label: 'Name' }, { key: 'designation', label: 'Role', value: (s) => label(s.designation) },
              { key: 'status', label: 'Status', value: (s) => label(s.a?.status ?? 'not marked'), render: (s) => (
                <select aria-label={`Attendance for ${s.full_name}`} className="rounded-lg border border-navy/20 px-2 py-1 text-sm" value={s.a?.status ?? ''}
                  onChange={(e) => e.target.value && a.run(async () => { await m.markAttendance(s.id, date, e.target.value, s.a?.overtime_hours, s.a?.notes); reload() })}>
                  <option value="">Not marked</option>{['present', 'absent', 'half_day', 'leave', 'weekly_off'].map((x) => <option key={x} value={x}>{label(x)}</option>)}
                </select>
              ) },
              { key: 'ot', label: 'Overtime (h)', value: (s) => s.a?.overtime_hours ?? 0, render: (s) => (
                <input type="number" min="0" max="16" step="0.5" aria-label={`Overtime for ${s.full_name}`} className="w-16 rounded border border-navy/20 px-1" defaultValue={s.a?.overtime_hours ?? 0}
                  onBlur={(e) => s.a && Number(e.target.value) !== Number(s.a.overtime_hours) && a.run(async () => { await m.markAttendance(s.id, date, s.a.status, e.target.value, s.a.notes); reload() })} />
              ) },
              { key: 'in', label: 'Self check-in', value: (s) => (s.a?.check_in_at ? `${formatDateTime(s.a.check_in_at)}${s.a.distance_m != null ? ` · ${s.a.distance_m} m away` : ''}` : '') },
              { key: 'out', label: 'Check-out', value: (s) => (s.a?.check_out_at ? formatDateTime(s.a.check_out_at) : '') },
              { key: 'selfie', label: '', noExport: true, render: (s) => s.a?.selfie_path && <Small onClick={() => a.run(async () => window.open(await m.fileUrl('employee-documents', s.a.selfie_path), '_blank', 'noopener'))}>Selfie</Small> },
            ]} />
            <ActionMsg action={a} />
          </>
        )}
      </Load>
    </>
  )
}

function Roster() {
  const { property, properties } = useScope()
  const [week, setWeek] = useState(ymd())
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const a = useAction()
  return (
    <>
      <CrudPanel table="shifts" title="Shifts" deps={[property]} query={(q) => scoped(property)(q).order('start_time')}
        defaults={{ property_id: property || properties[0]?.id }}
        columns={[{ key: 'name', label: 'Shift' }, { key: 'property_id', label: 'Property' }, { key: 'start_time', label: 'From' }, { key: 'end_time', label: 'To' }]}
        fields={[{ key: 'property_id', label: 'Property', type: 'select', required: true, options: properties.map((p) => [p.id, p.name]) },
          { key: 'name', label: 'Name (Morning, Night security…)', required: true }, { key: 'start_time', label: 'Starts', type: 'time', required: true }, { key: 'end_time', label: 'Ends', type: 'time', required: true }]} />
      <H3>Duty roster</H3>
      <label className="mb-3 block text-sm">Week starting <input type="date" className={`${inputCls} !w-auto`} value={week} onChange={(e) => setWeek(e.target.value)} /></label>
      <Load deps={[property, week]} loader={() => Promise.all([m.rows('staff_members', 'id, full_name, property_id', (q) => scoped(property)(q).eq('status', 'active').order('full_name')),
        m.rows('shifts', '*', scoped(property)), m.rows('roster', '*', (q) => q.gte('work_date', days[0]).lte('work_date', days[6]))])}>
        {([staff, shifts, roster], reload) => (
          <div className="overflow-x-auto rounded-2xl border border-navy/10 bg-white">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="bg-cream text-xs text-slate-500"><tr><th scope="col" className="px-2 py-2 text-left">Staff</th>{days.map((d) => <th scope="col" key={d} className="px-2 py-2">{new Date(`${d}T00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</th>)}</tr></thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id} className="border-t border-navy/5">
                    <th scope="row" className="px-2 py-1 text-left font-medium">{s.full_name}</th>
                    {days.map((d) => {
                      const r = roster.find((x) => x.staff_id === s.id && x.work_date === d)
                      return (
                        <td key={d} className="px-1 py-1">
                          <select aria-label={`${s.full_name} on ${d}`} className="w-full rounded border border-navy/20 text-xs" value={r?.shift_id ?? ''}
                            onChange={(e) => a.run(async () => {
                              if (r) await m.deleteRow('roster', r.id)
                              if (e.target.value) await m.insertRow('roster', { staff_id: s.id, shift_id: e.target.value, work_date: d })
                              reload()
                            })}>
                            <option value="">Off</option>{shifts.filter((x) => x.property_id === s.property_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Load>
      <ActionMsg action={a} />
    </>
  )
}

function Leave() {
  const { property } = useScope()
  const a = useAction()
  return (
    <Load deps={[property]} loader={() => Promise.all([m.rows('leave_requests', '*, staff_members(full_name, property_id)', (q) => q.order('created_at', { ascending: false }).limit(300)),
      m.rpc('report_leave', { p_year: new Date().getFullYear(), p_property: property || null })])}>
      {([reqs, bal], reload) => (
        <>
          <DataTable title="Leave requests" rows={reqs.filter((r) => !property || r.staff_members?.property_id === property)} columns={[
            { key: 'name', label: 'Employee', value: (r) => r.staff_members?.full_name }, { key: 'leave_type', label: 'Type', value: (r) => label(r.leave_type) },
            { key: 'dates', label: 'Dates', value: (r) => `${formatDate(r.from_date)} – ${formatDate(r.to_date)}` }, { key: 'days', label: 'Days' },
            { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} />, value: (r) => r.status },
            { key: 'x', label: '', noExport: true, render: (r) => r.status === 'pending' && (
              <span className="flex gap-1">
                <Small onClick={async () => (await a.run(() => m.decideLeave(r.id, true))) && reload()}>Approve</Small>
                <Small onClick={async () => (await a.run(() => m.decideLeave(r.id, false))) && reload()}>Reject</Small>
              </span>
            ) },
          ]} />
          <ActionMsg action={a} />
          <H3>Leave balance {new Date().getFullYear()}</H3>
          <DataTable title="Leave balance" rows={bal} search={false} columns={[
            { key: 'name', label: 'Employee' }, { key: 'paid_left', label: 'Paid left' }, { key: 'sick_left', label: 'Sick left' }, { key: 'casual_left', label: 'Casual left' },
            { key: 'unpaid_taken', label: 'Unpaid taken' }, { key: 'pending', label: 'Pending requests' },
          ]} />
        </>
      )}
    </Load>
  )
}

// PRD 10.3 monthly salary from attendance, leave, overtime, advances, bonus, deductions; payslip PDF; paid -> expense
function Payroll() {
  const { property, properties } = useScope()
  const [month, setMonth] = useState(monthStart())
  const [pid, setPid] = useState(property || properties[0]?.id)
  const [pay, setPay] = useState(null)
  const a = useAction()
  return (
    <Load deps={[month, pid]} loader={() => m.rows('payslips', '*, staff_members(full_name, designation)', (q) => q.eq('month', monthStart(new Date(`${month}T00:00`))).eq('property_id', pid))}>
      {(slips, reload) => (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <label className="text-sm">Month <input type="month" className={`${inputCls} !w-auto`} value={month.slice(0, 7)} onChange={(e) => setMonth(`${e.target.value}-01`)} /></label>
            <select aria-label="Property" className={`${inputCls} !w-auto`} value={pid} onChange={(e) => setPid(e.target.value)}>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <Button disabled={a.busy} onClick={async () => (await a.run(() => m.generatePayroll(month, pid), 'Calculated from attendance')) && reload()}>Calculate salaries</Button>
            <ActionMsg action={a} />
          </div>
          {slips.some((s) => s.unmarked_days > 0 && s.status === 'draft') && <div className="mb-3"><Notice tone="warn">Some days have no attendance. Mark them (Attendance tab) and calculate again; unmarked days are unpaid and block payment.</Notice></div>}
          <DataTable title={`Payroll ${month.slice(0, 7)}`} rows={slips} empty="Press Calculate salaries" columns={[
            { key: 'name', label: 'Employee', value: (s) => s.staff_members?.full_name },
            { key: 'payable_days', label: 'Payable days', value: (s) => `${s.payable_days}/${s.days_in_month}${s.unmarked_days > 0 ? ` (${s.unmarked_days} unmarked)` : ''}` },
            { key: 'overtime_hours', label: 'OT h' }, { key: 'gross', label: 'Gross', render: (s) => rupees(s.gross), value: (s) => s.gross },
            { key: 'ded', label: 'PF / ESI', value: (s) => `${rupees(s.pf)} / ${rupees(s.esi)}` },
            { key: 'advance_recovery', label: 'Advance recovered', render: (s) => rupees(s.advance_recovery), value: (s) => s.advance_recovery },
            { key: 'bonus', label: 'Bonus', render: (s) => rupees(s.bonus), value: (s) => s.bonus }, { key: 'other_deductions', label: 'Other ded.', render: (s) => rupees(s.other_deductions), value: (s) => s.other_deductions },
            { key: 'net', label: 'Net pay', render: (s) => <strong>{rupees(s.net)}</strong>, value: (s) => s.net },
            { key: 'status', label: 'Status', render: (s) => <StatusBadge value={s.status} tones={{ draft: 'amber' }} />, value: (s) => s.status },
            { key: 'x', label: '', noExport: true, render: (s) => (
              <span className="flex gap-1">
                {s.status === 'draft' && <Small onClick={() => setPay({ s, mode: 'edit' })}>Bonus / deductions</Small>}
                {s.status === 'draft' && <Small onClick={() => setPay({ s, mode: 'pay' })}>Pay</Small>}
                <Small onClick={() => payslipPdf({ slip: s, staff: s.staff_members })}>Payslip</Small>
              </span>
            ) },
          ]} />
          {pay && <PayslipModal {...pay} onClose={() => setPay(null)} onDone={() => { setPay(null); reload() }} />}
        </>
      )}
    </Load>
  )
}

function PayslipModal({ s, mode, onClose, onDone }) {
  const [v, setV] = useState({ bonus: s.bonus, deductions: s.other_deductions, notes: s.notes, pay: 'bank_transfer', ref: '', date: ymd() })
  const a = useAction()
  return (
    <Modal title={`${s.staff_members?.full_name} · ${mode === 'pay' ? 'pay salary' : 'adjust'}`} onClose={onClose}>
      <FormFields value={v} onChange={setV} fields={mode === 'pay'
        ? [{ key: 'pay', label: 'Paid by', type: 'select', required: true, options: PAY_MODES }, { key: 'ref', label: 'Reference' }, { key: 'date', label: 'Paid on', type: 'date', required: true }]
        : [{ key: 'bonus', label: 'Bonus (₹)', type: 'number', min: 0 }, { key: 'deductions', label: 'Other deductions (₹)', type: 'number', min: 0 }, { key: 'notes', label: 'Notes', type: 'textarea' }]} />
      {mode === 'pay' && <p className="mt-2 text-sm">Net {rupees(s.net)}. Advance instalments are recovered and the cost is booked under Staff salaries.</p>}
      <ActionMsg action={a} />
      <Button className="mt-3" disabled={a.busy} onClick={async () => (await a.run(() => (mode === 'pay' ? m.payPayslip(s.id, v.pay, v.ref, v.date) : m.updatePayslip(s.id, v.bonus, v.deductions, v.notes)))) && onDone()}>Save</Button>
    </Modal>
  )
}

function Advances() {
  const { property } = useScope()
  return (
    <Load loader={() => m.rows('staff_members', 'id, full_name', (q) => scoped(property)(q).order('full_name'))} deps={[property]}>
      {(staff) => (
        <CrudPanel table="salary_advances" title="Advances & loans" select="*, staff_members(full_name)" canDelete={false} query={(q) => q.order('given_on', { ascending: false })}
          defaults={{ kind: 'advance', given_on: ymd(), mode: 'cash', status: 'open', recovered: 0 }}
          columns={[{ key: 'name', label: 'Employee', value: (r) => r.staff_members?.full_name }, { key: 'kind', label: 'Type', value: (r) => label(r.kind) },
            { key: 'given_on', label: 'Given', render: (r) => formatDate(r.given_on) }, { key: 'amount', label: 'Amount', render: (r) => rupees(r.amount) },
            { key: 'instalment', label: 'Per salary', render: (r) => rupees(r.instalment) }, { key: 'recovered', label: 'Recovered', render: (r) => rupees(r.recovered) },
            { key: 'left', label: 'Outstanding', value: (r) => r.amount - r.recovered }, { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} tones={{ open: 'amber' }} /> }]}
          fields={[{ key: 'staff_id', label: 'Employee', type: 'select', required: true, options: staff.map((s) => [s.id, s.full_name]) },
            { key: 'kind', label: 'Type', type: 'select', required: true, options: ['advance', 'loan'] }, { key: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1 },
            { key: 'instalment', label: 'Recover per salary (₹)', type: 'number', required: true, min: 1 }, { key: 'given_on', label: 'Given on', type: 'date', required: true },
            { key: 'mode', label: 'Paid by', type: 'select', options: PAY_MODES }, { key: 'notes', label: 'Notes', type: 'textarea', keepEmpty: true }]} />
      )}
    </Load>
  )
}

function Tasks() {
  const { property, properties } = useScope()
  const [date, setDate] = useState(ymd())
  const a = useAction()
  return (
    <>
      <CrudPanel table="task_templates" title="Daily / weekly checklists" deps={[property]} query={(q) => scoped(property)(q).order('designation')}
        defaults={{ property_id: property || properties[0]?.id, designation: 'housekeeping', frequency: 'daily', active: true }}
        columns={[{ key: 'title', label: 'Task' }, { key: 'designation', label: 'For role', value: (t) => label(t.designation) }, { key: 'property_id', label: 'Property' },
          { key: 'frequency', label: 'Every', value: (t) => (t.frequency === 'weekly' ? `week (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.weekday] ?? '?'})` : 'day') },
          { key: 'requires_photo', label: 'Photo proof', value: (t) => (t.requires_photo ? 'yes' : '') }, { key: 'active', label: 'Status', render: (t) => <StatusBadge value={t.active ? 'active' : 'stopped'} /> }]}
        toForm={(t) => ({ ...t, weekday: t.weekday == null ? '' : String(t.weekday) })} fromForm={(d) => ({ ...d, weekday: d.weekday == null || d.weekday === '' ? null : Number(d.weekday) })}
        fields={[{ key: 'property_id', label: 'Property', type: 'select', required: true, options: properties.map((p) => [p.id, p.name]) },
          { key: 'designation', label: 'For role', type: 'select', required: true, options: DESIGNATIONS },
          { key: 'title', label: 'Task (room cleaning, bathroom cleaning, garbage disposal, kitchen hygiene…)', required: true, span: true },
          { key: 'frequency', label: 'Frequency', type: 'select', required: true, options: ['daily', 'weekly'] },
          { key: 'weekday', label: 'Day (weekly)', type: 'select', options: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => [String(i), d]), hidden: (v) => v.frequency !== 'weekly' },
          { key: 'requires_photo', label: 'Needs photo proof', type: 'checkbox' }, { key: 'active', label: 'Active', type: 'checkbox' }]} />
      <H3>Task status</H3>
      <label className="mb-3 block text-sm">Date <input type="date" className={`${inputCls} !w-auto`} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <Load deps={[date, property]} loader={() => m.rows('staff_tasks', '*, staff_members(full_name)', (q) => scoped(property)(q).eq('task_date', date).order('title'))}>
        {(tasks) => (
          <DataTable title={`Tasks ${date}`} rows={tasks} empty="No tasks for this day (they are created each morning from the checklists)" columns={[
            { key: 'name', label: 'Employee', value: (t) => t.staff_members?.full_name }, { key: 'title', label: 'Task' },
            { key: 'done_at', label: 'Done', value: (t) => (t.done_at ? formatDateTime(t.done_at) : 'pending') }, { key: 'notes', label: 'Notes' },
            { key: 'photo', label: '', noExport: true, render: (t) => t.photo_path && <Small onClick={() => a.run(async () => window.open(await m.fileUrl('employee-documents', t.photo_path), '_blank', 'noopener'))}>Photo</Small> },
          ]} />
        )}
      </Load>
      <ActionMsg action={a} />
    </>
  )
}

function Notices() {
  const { property, properties } = useScope()
  return (
    <CrudPanel table="notices" title="Notices" query={(q) => q.order('created_at', { ascending: false })} defaults={{ audience: 'staff', property_id: property || null }}
      columns={[{ key: 'created_at', label: 'Posted', render: (n) => formatDate(n.created_at) }, { key: 'title', label: 'Title' },
        { key: 'audience', label: 'For', value: (n) => label(n.audience) }, { key: 'property_id', label: 'Property', value: (n) => n.property_id ?? 'All' },
        { key: 'expires_on', label: 'Until', render: (n) => formatDate(n.expires_on) }]}
      fields={[{ key: 'title', label: 'Title', required: true, span: true }, { key: 'body', label: 'Message', type: 'textarea', keepEmpty: true },
        { key: 'audience', label: 'For', type: 'select', required: true, options: [['staff', 'Staff'], ['tenants', 'Tenants'], ['all', 'Everyone']] },
        { key: 'property_id', label: 'Property (blank = all, owner only)', type: 'select', options: properties.map((p) => [p.id, p.name]) },
        { key: 'expires_on', label: 'Show until', type: 'date' }]} />
  )
}

