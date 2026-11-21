import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import CrudPanel from '../../components/manage/CrudPanel'
import DataTable from '../../components/manage/DataTable'
import { ActionMsg, FormFields, H3, Load, Modal, Small, StatusBadge, Tabs, useAction, useScope } from '../../components/manage/kit'
import { Button, Card, Notice, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { setUserActive } from '../../services/api'
import { label } from '../../services/pg'
import { formatDateTime } from '../../services/format'

export default function Settings() {
  const [tab, setTab] = useState('users')
  return (
    <div>
      <Tabs tab={tab} onTab={setTab} tabs={[['users', 'Users & roles'], ['rules', 'Rent, reminders & rules'], ['templates', 'Message templates'], ['agreement', 'Agreement & house rules'], ['jobs', 'Automation']]} />
      {tab === 'users' && <Users />}
      {tab === 'rules' && <Rules />}
      {tab === 'templates' && <Templates />}
      {tab === 'agreement' && <Agreement />}
      {tab === 'jobs' && <Jobs />}
    </div>
  )
}

function Users() {
  const { user } = useAuth()
  const { properties } = useScope()
  const [creating, setCreating] = useState(false)
  const a = useAction()
  return (
    <Load loader={() => Promise.all([m.loadStaffLogins(), m.loadMembers()])}>
      {([users, members], reload) => (
        <>
          <DataTable title="Users" rows={users} filters={<Button className="!py-1.5" onClick={() => setCreating(true)}>Create login</Button>} columns={[
            { key: 'full_name', label: 'Name' }, { key: 'phone', label: 'Mobile' },
            { key: 'role', label: 'Role', value: (u) => u.role, render: (u) => (u.id === user.id ? label(u.role) : (
              <select aria-label={`Role of ${u.full_name}`} className="rounded border border-navy/20 px-1 text-sm" value={u.role}
                onChange={(e) => a.run(async () => { await m.setRole(u.id, e.target.value); reload() }, 'Role changed')}>
                {['admin', 'manager', 'sales', 'employee', 'customer'].map((r) => <option key={r} value={r}>{r === 'admin' ? 'Owner (admin)' : label(r)}</option>)}
              </select>
            )) },
            { key: 'props', label: 'Properties', value: (u) => members.filter((x) => x.user_id === u.id).map((x) => x.property_id).join(', '), render: (u) => (u.role === 'admin' ? 'All' : (
              <span className="flex flex-wrap gap-2">
                {properties.map((p) => {
                  const on = members.some((x) => x.user_id === u.id && x.property_id === p.id)
                  return (
                    <label key={p.id} className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={on} onChange={() => a.run(async () => { await m.assignMember(p.id, u.id, !on); reload() })} />{p.id}
                    </label>
                  )
                })}
              </span>
            )) },
            { key: 'opens', label: 'Opens on', value: (u) => members.find((x) => x.user_id === u.id && x.is_default)?.property_id ?? '', render: (u) => {
              const mine = members.filter((x) => x.user_id === u.id)
              if (u.role === 'admin') return 'All wings'
              if (mine.length < 2) return mine[0]?.property_id ?? '—'
              return (
                <select aria-label={`Wing ${u.full_name} opens on`} className="rounded border border-navy/20 px-1 text-sm" value={mine.find((x) => x.is_default)?.property_id ?? ''}
                  onChange={(e) => a.run(async () => { await m.setDefaultProperty(u.id, e.target.value); reload() }, 'Default wing saved')}>
                  <option value="">First wing</option>
                  {mine.map((x) => <option key={x.property_id} value={x.property_id}>{properties.find((p) => p.id === x.property_id)?.name ?? x.property_id}</option>)}
                </select>
              )
            } },
            { key: 'is_active', label: 'Status', render: (u) => <StatusBadge value={u.is_active ? 'active' : 'inactive'} />, value: (u) => (u.is_active ? 'active' : 'inactive') },
            { key: 'x', label: '', noExport: true, render: (u) => u.id !== user.id && (
              <Small onClick={() => a.run(async () => { await setUserActive(u.id, !u.is_active); reload() })}>{u.is_active ? 'Deactivate' : 'Activate'}</Small>
            ) },
          ]} />
          <ActionMsg action={a} />
          <p className="mt-2 text-xs text-slate-500">Managers see only the properties ticked here (tick both wings to let them see both). "Opens on" is the wing they see first each time they open the app. Employee data permissions (contacts, payments, beds) are under Website & bookings → Employees.</p>
          {creating && <CreateLogin onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload() }} />}
        </>
      )}
    </Load>
  )
}

function CreateLogin({ onClose, onDone }) {
  const { properties } = useScope()
  const [v, setV] = useState({ role: 'manager', full_name: '', phone: '', email: '', password: '', property_id: properties[0]?.id ?? '' })
  const a = useAction()
  return (
    <Modal title="Create a login" onClose={onClose}>
      <FormFields value={v} onChange={setV} fields={[
        { key: 'role', label: 'Role', type: 'select', required: true, options: [['manager', 'Property manager'], ['sales', 'Sales / marketing executive'], ['employee', 'Staff']] },
        { key: 'full_name', label: 'Full name', required: true }, { key: 'phone', label: 'Mobile', type: 'tel', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true }, { key: 'password', label: 'Temporary password (8+ characters)', type: 'password', required: true },
        { key: 'property_id', label: 'Property', type: 'select', options: properties.map((p) => [p.id, p.name]) },
      ]} />
      <ActionMsg action={a} />
      <Button className="mt-3" disabled={a.busy} onClick={async () => (await a.run(() => m.createUser(v))) && onDone()}>Create</Button>
    </Modal>
  )
}

// Structured editor for the app_settings rows the PG modules read
const RULES = [
  ['rent_cycle', 'Rent cycle', { type: 'select', options: [['fixed', 'Fixed due day each month (pro-rata first month)'], ['checkin', 'Monthly from each tenant\'s check-in date']] }],
  ['rent_due_day', 'Rent due day (fixed cycle)', { type: 'number', min: 1, max: 28 }],
  ['invoice_lead_days', 'Create next invoice this many days before it is due', { type: 'number', min: 0, max: 15 }],
  ['late_fee.mode', 'Late fee', { type: 'select', options: [['none', 'No late fee'], ['per_day', 'Fixed amount per day'], ['percent', 'Percentage of the invoice']] }],
  ['late_fee.amount', 'Late fee per day (₹)', { type: 'number', min: 0 }],
  ['late_fee.percent', 'Late fee %', { type: 'number', min: 0, step: 'any' }],
  ['late_fee.grace_days', 'Grace period (days)', { type: 'number', min: 0 }],
  ['late_fee.cap', 'Maximum late fee per invoice (₹, 0 = none)', { type: 'number', min: 0 }],
  ['risk_late_count', 'Late payments in 12 months that flag a repeat defaulter', { type: 'number', min: 1 }],
  ['reminder_schedule.before', 'Remind days before due (comma separated)', { list: true }],
  ['reminder_schedule.on_due', 'Remind on the due date', { type: 'checkbox' }],
  ['reminder_schedule.after', 'Remind days after due (comma separated)', { list: true }],
  ['reminder_schedule.weekly_after', 'Then weekly until paid', { type: 'checkbox' }],
  ['reminder_schedule.channels', 'Channels (in_app, push, sms, whatsapp, email)', { list: true, text: true }],
  ['reminder_schedule.copy_guardian', 'Copy guardians who consented', { type: 'checkbox' }],
  ['expense_approval_limit', 'Manager expenses above this need owner approval (₹)', { type: 'number', min: 0 }],
  ['lead_assignment.mode', 'Lead assignment', { type: 'select', options: [['round_robin', 'Round-robin between sales executives'], ['by_property', 'By property (executives assigned to it)'], ['manual', 'Manual']] }],
  ['lead_hot_days', 'Hot lead: move-in within (days)', { type: 'number', min: 1 }],
  ['lead_warm_days', 'Warm lead: move-in within (days)', { type: 'number', min: 1 }],
  ['referral_reward.type', 'Referral reward', { type: 'select', options: [['discount', 'Rent discount (automatic)'], ['cash', 'Cash (paid by office)']] }],
  ['referral_reward.amount', 'Referral reward amount (₹)', { type: 'number', min: 0 }],
  ['complaint_sla_hours.low', 'Complaint SLA low (hours)', { type: 'number', min: 1 }],
  ['complaint_sla_hours.medium', 'SLA medium (hours)', { type: 'number', min: 1 }],
  ['complaint_sla_hours.high', 'SLA high (hours)', { type: 'number', min: 1 }],
  ['complaint_sla_hours.urgent', 'SLA urgent (hours)', { type: 'number', min: 1 }],
  ['payroll.pf_rate', 'PF %', { type: 'number', step: 'any' }], ['payroll.pf_wage_cap', 'PF wage ceiling (₹)', { type: 'number' }],
  ['payroll.esi_rate', 'ESI %', { type: 'number', step: 'any' }], ['payroll.esi_gross_limit', 'ESI applies up to gross (₹)', { type: 'number' }],
  ['payroll.standard_hours', 'Standard shift hours (overtime after)', { type: 'number', step: 'any' }],
  ['site_url', 'Site address used in message links', { text: true }],
  ['google_review_url', 'Google review link (shown to tenants)', { text: true }],
  ['hold_minutes', 'Online booking hold (minutes)', { type: 'number', min: 5 }],
  ['demo_payments_enabled', 'Demo payments enabled', { type: 'checkbox' }],
]

function Rules() {
  const { role } = useAuth()
  const a = useAction()
  return (
    <Load loader={m.loadSettings}>
      {(rows, reload) => {
        const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
        const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), map)
        const init = Object.fromEntries(RULES.map(([k, , o]) => {
          const v = get(k)
          return [k, o.list ? (v ?? []).join(', ') : v ?? (o.type === 'checkbox' ? false : '')]
        }))
        return <RulesForm init={init} map={map} disabled={role !== 'admin'} onSave={async (v) => {
          const next = structuredClone(map)
          for (const [k, , o] of RULES) {
            let val = v[k]
            if (o.list) val = String(val).split(',').map((s) => s.trim()).filter(Boolean).map((s) => (o.text ? s : Number(s)))
            else if (o.type === 'number') val = Number(val)
            const [top, sub] = k.split('.')
            if (sub) next[top] = { ...(next[top] ?? {}), [sub]: val }; else next[top] = val
          }
          const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(map[k]))
          if (await a.run(async () => { for (const k of changed) await m.setSetting(k, next[k]) }, `Saved ${changed.length} setting(s)`)) reload()
        }} action={a} />
      }}
    </Load>
  )
}

function RulesForm({ init, disabled, onSave, action }) {
  const [v, setV] = useState(init)
  return (
    <Card>
      <FormFields value={v} onChange={setV} fields={RULES.map(([key, l, o]) => ({ key, label: l, type: o.type, options: o.options, min: o.min, max: o.max, step: o.step, disabled }))} />
      <div className="mt-4 flex items-center gap-3"><Button disabled={disabled || action.busy} onClick={() => onSave(v)}>Save settings</Button><ActionMsg action={action} /></div>
    </Card>
  )
}

function Templates() {
  return (
    <>
      <Notice>Placeholders: {'{{name}} {{amount}} {{due_date}} {{description}} {{link}} {{invoice}} {{property}} {{when}} {{phone}} {{status}} {{title}} {{note}} {{document}}'}. SMS templates must match your DLT-registered text.</Notice>
      <div className="mt-4" />
      <CrudPanel table="message_templates" idKey="key" title="Message templates" canDelete={false} query={(q) => q.order('key')}
        columns={[{ key: 'key', label: 'Used for', value: (t) => label(t.key) }, { key: 'subject', label: 'Subject' }, { key: 'body', label: 'Text', className: 'max-w-md' }]}
        fields={[{ key: 'key', label: 'Key', required: true }, { key: 'subject', label: 'Subject (email / push title)', span: true, keepEmpty: true }, { key: 'body', label: 'Text', type: 'textarea', required: true, rows: 5 }]} />
    </>
  )
}

function Agreement() {
  const a = useAction()
  return (
    <Load loader={m.loadSettings}>
      {(rows, reload) => {
        const get = (k) => rows.find((r) => r.key === k)?.value ?? ''
        return <AgreementForm tpl={get('agreement_template')} rules={get('house_rules')} action={a}
          onSave={async (tpl, rules) => (await a.run(async () => { await m.setSetting('agreement_template', tpl); await m.setSetting('house_rules', rules) }, 'Saved')) && reload()} />
      }}
    </Load>
  )
}

function AgreementForm({ tpl, rules, onSave, action }) {
  const [t, setT] = useState(tpl)
  const [r, setR] = useState(rules)
  return (
    <Card>
      <label className="block text-sm font-medium">Agreement template
        <textarea className={`${inputCls} mt-1 font-mono`} rows={10} value={t} onChange={(e) => setT(e.target.value)} />
      </label>
      <p className="mt-1 text-xs text-slate-500">{'{{tenant}} {{property}} {{address}} {{room}} {{start}} {{end}} {{rent}} {{deposit}} {{notice}} {{lock_in}}'}</p>
      <label className="mt-4 block text-sm font-medium">House rules
        <textarea className={`${inputCls} mt-1`} rows={6} value={r} onChange={(e) => setR(e.target.value)} />
      </label>
      <div className="mt-3 flex items-center gap-3"><Button onClick={() => onSave(t, r)} disabled={action.busy}>Save</Button><ActionMsg action={action} /></div>
    </Card>
  )
}

function Jobs() {
  const a = useAction()
  return (
    <Load loader={() => m.rows('job_runs', '*', (q) => q.order('started_at', { ascending: false }).limit(30))}>
      {(runs, reload) => (
        <>
          <Notice>Timed rules (monthly invoices, late fees, rent reminders, reservation release, complaint escalation, preventive maintenance, staff tasks, visit and follow-up reminders, agreement renewal alerts, referral rewards, the owner's monthly report) run every 30 minutes from the scheduler. Message delivery needs the provider keys described in docs/pg-management.md.</Notice>
          <div className="mt-3 flex items-center gap-3"><Button disabled={a.busy} onClick={async () => (await a.run(() => m.runJobs(true), 'Done')) && reload()}>Run now</Button><ActionMsg action={a} /></div>
          <H3>Recent runs</H3>
          <DataTable title="Job runs" search={false} rows={runs} columns={[
            { key: 'started_at', label: 'When', render: (r) => formatDateTime(r.started_at) },
            { key: 'result', label: 'Result', value: (r) => Object.entries(r.result).filter(([, n]) => n).map(([k, n]) => `${label(k)}: ${n}`).join(' · ') || 'nothing to do' },
          ]} />
        </>
      )}
    </Load>
  )
}
