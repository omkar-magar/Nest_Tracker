import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import CrudPanel from '../../components/manage/CrudPanel'
import DataTable from '../../components/manage/DataTable'
import { ActionMsg, FormFields, H3, Load, Modal, Small, StatusBadge, Tabs, useAction, useScope } from '../../components/manage/kit'
import { Funnel } from '../../components/manage/Charts'
import { Button, Card, Notice, Stat, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { ENQUIRY_STATUSES, LEAD_SOURCES, PAY_MODES, addDays, label, monthStart, ymd } from '../../services/pg'
import { formatDate, formatDateTime, rupees } from '../../services/format'

export default function Sales() {
  const { role } = useAuth()
  const [tab, setTab] = useState('reports')
  const manager = role === 'admin' || role === 'manager'
  return (
    <div>
      <Tabs tab={tab} onTab={setTab} tabs={[['reports', 'Sales reports'], ['visits', 'Site visits'], ['campaigns', 'Campaigns'], ['bulk', 'Bulk messages'],
        ['brokers', 'Brokers & partners'], ['referrals', 'Referrals'], ['offers', 'Offers']]} />
      {tab === 'reports' && <SalesReports manager={manager} />}
      {tab === 'visits' && <Visits />}
      {tab === 'campaigns' && <Campaigns manager={manager} />}
      {tab === 'bulk' && <Bulk />}
      {tab === 'brokers' && <Brokers manager={manager} />}
      {tab === 'referrals' && <Referrals manager={manager} />}
      {tab === 'offers' && <Offers admin={role === 'admin'} />}
    </div>
  )
}

function SalesReports({ manager }) {
  const { property } = useScope()
  const [r, setR] = useState({ from: monthStart(), to: ymd() })
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <label className="text-sm">From <input type="date" className={`${inputCls} !w-auto`} value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} /></label>
        <label className="text-sm">To <input type="date" className={`${inputCls} !w-auto`} value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} /></label>
      </div>
      <Load deps={[r.from, r.to, property, manager]} loader={() => Promise.all([
        m.rpc('report_lead_funnel', { p_from: r.from, p_to: r.to, p_property: property || null }),
        m.rpc('report_lead_sources', { p_from: r.from, p_to: r.to, p_property: property || null }),
        manager ? m.rpc('report_executives', { p_from: r.from, p_to: r.to }) : Promise.resolve([]),
        manager ? m.rpc('report_forecast', { p_property: property || null, p_days: 30 }) : Promise.resolve(null),
      ])}>
        {([f, src, ex, fc]) => (
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <Funnel title={`Lead funnel · ${f.conversion_pct}% booked`} stages={[
                { label: 'Enquiries', value: f.enquiries }, { label: 'Contacted', value: f.contacted }, { label: 'Visited', value: f.visited }, { label: 'Booked', value: f.booked }]} />
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Average days to close" value={f.avg_days_to_close ?? '—'} />
                <Stat label="Lost" value={f.lost} hint={Object.entries(f.lost_reasons ?? {}).map(([k, v]) => `${label(k)} ${v}`).join(' · ')} />
                {fc && <Stat label="Forecast occupancy (30 days)" value={`${fc.forecast_pct}%`} hint={`${fc.occupied_now} occupied − ${fc.planned_checkouts} leaving + ${fc.expected_new} expected from ${fc.hot_leads} hot / ${fc.warm_leads} warm leads`} />}
                {fc && <Stat label="Conversion (180 days)" value={`${fc.conversion_rate}%`} />}
              </div>
            </div>
            <div>
              <H3>Source and campaign performance</H3>
              <DataTable title="Lead sources" rows={src} columns={[
                { key: 'dimension', label: 'By', value: (x) => label(x.dimension) }, { key: 'name', label: 'Source / campaign', value: (x) => label(x.name) },
                { key: 'leads', label: 'Leads' }, { key: 'bookings', label: 'Bookings' }, { key: 'conversion_pct', label: 'Conversion %', value: (x) => x.conversion_pct ?? '' },
                { key: 'spend', label: 'Spend', render: (x) => rupees(x.spend), value: (x) => x.spend },
                { key: 'cost_per_lead', label: 'Cost per lead', render: (x) => (x.cost_per_lead == null ? '—' : rupees(x.cost_per_lead)), value: (x) => x.cost_per_lead },
                { key: 'cost_per_booking', label: 'Cost per booking', render: (x) => (x.cost_per_booking == null ? '—' : rupees(x.cost_per_booking)), value: (x) => x.cost_per_booking },
              ]} />
            </div>
            {manager && (
              <div>
                <H3>Executive performance</H3>
                <DataTable title="Executive performance" rows={ex} columns={[
                  { key: 'name', label: 'Executive' }, { key: 'leads', label: 'Leads' }, { key: 'contacted', label: 'Contacted' }, { key: 'calls', label: 'Calls logged' },
                  { key: 'follow_ups_done', label: 'Follow-ups done' }, { key: 'follow_ups_overdue', label: 'Overdue follow-ups' }, { key: 'visits', label: 'Visits' },
                  { key: 'bookings', label: 'Bookings' }, { key: 'conversion_pct', label: 'Conversion %', value: (x) => x.conversion_pct ?? '' },
                  { key: 'avg_days_to_close', label: 'Avg days to close', value: (x) => x.avg_days_to_close ?? '' },
                ]} />
              </div>
            )}
          </div>
        )}
      </Load>
    </>
  )
}

function Visits() {
  const a = useAction()
  return (
    <Load loader={m.loadVisits}>
      {(list, reload) => (
        <>
          <DataTable title="Site visits" rows={list} columns={[
            { key: 'scheduled_at', label: 'When', render: (v) => formatDateTime(v.scheduled_at), value: (v) => v.scheduled_at },
            { key: 'name', label: 'Lead', render: (v) => <Link className="underline" to={`/admin/enquiries/${v.enquiries?.id}`}>{v.enquiries?.name}</Link>, value: (v) => v.enquiries?.name },
            { key: 'phone', label: 'Mobile', value: (v) => v.enquiries?.phone }, { key: 'property_id', label: 'Property' },
            { key: 'status', label: 'Status', render: (v) => <StatusBadge value={v.status} tones={{ visited: 'green', no_show: 'red' }} />, value: (v) => v.status },
            { key: 'reminder', label: 'Reminder sent', value: (v) => (v.reminder_sent_at ? formatDateTime(v.reminder_sent_at) : '') },
            { key: 'x', label: '', noExport: true, render: (v) => v.status === 'scheduled' && (
              <span className="flex gap-1">
                <Small onClick={async () => (await a.run(() => m.setVisitStatus(v.id, 'visited'))) && reload()}>Visited</Small>
                <Small onClick={async () => (await a.run(() => m.setVisitStatus(v.id, 'no_show'))) && reload()}>No-show</Small>
              </span>
            ) },
          ]} />
          <ActionMsg action={a} />
        </>
      )}
    </Load>
  )
}

function Campaigns({ manager }) {
  const { properties } = useScope()
  const [spend, setSpend] = useState(null)
  const [qr, setQr] = useState(null)
  const link = (c) => `${window.location.origin}/?c=${encodeURIComponent(c.code)}`
  const showQr = async (c) => {
    const QR = await import('qrcode')
    setQr({ c, url: await QR.toDataURL(link(c), { width: 512, margin: 2 }) })
  }
  return (
    <>
      <CrudPanel table="campaigns" title="Campaigns" canEdit={manager} canDelete={false} query={(q) => q.order('start_date', { ascending: false })}
        defaults={{ channel: 'instagram', start_date: ymd(), active: true, budget: 0 }}
        columns={[
          { key: 'name', label: 'Campaign' }, { key: 'channel', label: 'Channel', value: (c) => label(c.channel) },
          { key: 'dates', label: 'Dates', value: (c) => `${formatDate(c.start_date)} – ${c.end_date ? formatDate(c.end_date) : 'open'}` },
          { key: 'budget', label: 'Budget', render: (c) => rupees(c.budget), value: (c) => c.budget },
          { key: 'property_id', label: 'Property', value: (c) => c.property_id ?? 'All' }, { key: 'room_type', label: 'Room type' },
          { key: 'code', label: 'Tracked link', render: (c) => <code className="text-xs">?c={c.code}</code>, value: (c) => link(c) },
        ]}
        extraActions={(c) => (
          <>
            <Small onClick={() => navigator.clipboard?.writeText(link(c))}>Copy link</Small>
            <Small onClick={() => showQr(c)}>QR code</Small>
            {manager && <Small onClick={() => setSpend(c)}>Add spend</Small>}
          </>
        )}
        fields={[
          { key: 'name', label: 'Name', required: true }, { key: 'channel', label: 'Channel', type: 'select', required: true, options: LEAD_SOURCES },
          { key: 'code', label: 'Link code (letters, digits, - or _)', required: true, help: 'Enquiries arriving through ?c=CODE or its QR code are credited to this campaign.' },
          { key: 'start_date', label: 'Start', type: 'date', required: true }, { key: 'end_date', label: 'End', type: 'date' },
          { key: 'budget', label: 'Budget (₹)', type: 'number', min: 0 },
          { key: 'property_id', label: 'Target property', type: 'select', options: properties.map((p) => [p.id, p.name]) },
          { key: 'room_type', label: 'Target room type' }, { key: 'notes', label: 'Notes', type: 'textarea', keepEmpty: true },
          { key: 'active', label: 'Active', type: 'checkbox' },
        ]} />
      <p className="mt-2 text-xs text-slate-500">Spend is recorded as a Marketing expense, so cost per lead and per booking appear in Sales reports and the P&L.</p>
      {spend && <SpendModal c={spend} onClose={() => setSpend(null)} />}
      {qr && (
        <Modal title={`QR code · ${qr.c.name}`} onClose={() => setQr(null)}>
          <img src={qr.url} alt={`QR code that opens ${link(qr.c)}`} className="mx-auto w-64" />
          <p className="mt-2 break-all text-center text-xs">{link(qr.c)}</p>
          <div className="mt-3 text-center"><Button href={qr.url} download={`qr-${qr.c.code}.png`}>Download PNG</Button></div>
        </Modal>
      )}
    </>
  )
}

function SpendModal({ c, onClose }) {
  const [v, setV] = useState({ amount: '', date: ymd(), vendor: '', notes: '' })
  const a = useAction()
  return (
    <Modal title={`Add spend · ${c.name}`} onClose={onClose}>
      <FormFields value={v} onChange={setV} fields={[
        { key: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1 }, { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'vendor', label: 'Paid to' }, { key: 'notes', label: 'Notes', type: 'textarea' },
      ]} />
      <ActionMsg action={a} />
      <Button className="mt-3" disabled={a.busy} onClick={async () => (await a.run(() => m.addCampaignSpend(c.id, v.amount, v.date, v.vendor, v.notes))) && onClose()}>Save</Button>
    </Modal>
  )
}

// [Should] bulk SMS / WhatsApp / email to leads and past enquiries; opted-out leads are skipped
function Bulk() {
  const [f, setF] = useState({ status: '', source: '', since: addDays(ymd(), -90) })
  const [msg, setMsg] = useState({ sms: true, whatsapp: true, email: false, subject: '', body: 'Hi {{name}}, beds are available at YOLO Nest this month. Reply or call to book a visit.' })
  const a = useAction()
  return (
    <Load loader={m.loadEnquiries}>
      {(all) => {
        const list = all.filter((e) => !e.opted_out && !e.duplicate_of && e.status !== 'booked' && (!f.status || e.status === f.status)
          && (!f.source || e.source === f.source) && e.received_at >= f.since)
        const channels = ['sms', 'whatsapp', 'email'].filter((c) => msg[c])
        return (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <H3>Recipients ({list.length})</H3>
              <FormFields value={f} onChange={setF} fields={[
                { key: 'status', label: 'Status', type: 'select', options: ENQUIRY_STATUSES }, { key: 'source', label: 'Source', type: 'select', options: LEAD_SOURCES },
                { key: 'since', label: 'Enquired since', type: 'date' },
              ]} />
              <p className="mt-2 text-xs text-slate-500">Leads who opted out, booked leads and duplicates are left out. Every message carries an unsubscribe link.</p>
            </Card>
            <Card>
              <H3>Message</H3>
              <FormFields value={msg} onChange={setMsg} fields={[
                { key: 'sms', label: 'SMS', type: 'checkbox' }, { key: 'whatsapp', label: 'WhatsApp', type: 'checkbox' }, { key: 'email', label: 'Email', type: 'checkbox' },
                { key: 'subject', label: 'Email subject', hidden: (v) => !v.email }, { key: 'body', label: 'Message ({{name}} becomes the lead\'s name)', type: 'textarea', required: true },
              ]} />
              <ActionMsg action={a} />
              <Button className="mt-3" disabled={a.busy || !list.length || !channels.length} onClick={() => {
                if (window.confirm(`Send to ${list.length} lead(s) by ${channels.join(', ')}?`)) {
                  a.run(async () => { const r = await m.sendBulkMessage(list.map((e) => e.id), channels, msg.subject, msg.body); a.clear(); return r }, '')
                    .then((r) => r && window.alert(`Queued for ${r.sent}; skipped ${r.skipped_opted_out_or_hidden}.`))
                }
              }}>Send</Button>
            </Card>
          </div>
        )
      }}
    </Load>
  )
}

function Brokers({ manager }) {
  const [pay, setPay] = useState(null)
  return (
    <>
      <CrudPanel table="brokers" title="Brokers & partners" canEdit={manager} canDelete={false} query={(q) => q.order('name')}
        defaults={{ kind: 'broker', commission_type: 'flat', commission_value: 0, is_active: true }}
        columns={[{ key: 'name', label: 'Name' }, { key: 'kind', label: 'Type', value: (b) => label(b.kind) }, { key: 'firm', label: 'Firm' }, { key: 'phone', label: 'Phone' },
          { key: 'commission', label: 'Commission', value: (b) => (b.commission_type === 'flat' ? `₹${b.commission_value} per booking` : `${b.commission_value}% of first month`) },
          { key: 'is_active', label: 'Status', render: (b) => <StatusBadge value={b.is_active ? 'active' : 'inactive'} /> }]}
        fields={[
          { key: 'name', label: 'Name', required: true }, { key: 'kind', label: 'Type', type: 'select', required: true, options: ['broker', 'agent', 'college', 'corporate', 'other'] },
          { key: 'firm', label: 'Firm', keepEmpty: true }, { key: 'phone', label: 'Phone', type: 'tel', keepEmpty: true },
          { key: 'commission_type', label: 'Commission rule', type: 'select', required: true, options: [['flat', 'Flat amount per booking'], ['percent', '% of first month rent']] },
          { key: 'commission_value', label: 'Amount or %', type: 'number', required: true, min: 0, step: 'any' },
          { key: 'notes', label: 'Notes', type: 'textarea', keepEmpty: true }, { key: 'is_active', label: 'Active', type: 'checkbox' },
        ]} />
      {manager && (
        <>
          <H3>Leads and commissions per broker</H3>
          <Load loader={() => Promise.all([m.rows('broker_commissions', '*, brokers(name), enquiries(name)', (q) => q.order('created_at', { ascending: false })),
            m.rows('enquiries', 'broker_id, status', (q) => q.not('broker_id', 'is', null)), m.rows('brokers', 'id, name')])}>
            {([list, leads, brokers], reload) => (
              <>
                <DataTable title="Broker summary" search={false} rows={brokers.map((b) => ({
                  id: b.id, name: b.name, leads: leads.filter((l) => l.broker_id === b.id).length, booked: leads.filter((l) => l.broker_id === b.id && l.status === 'booked').length,
                  payable: list.filter((c) => c.broker_id === b.id && c.status === 'payable').reduce((s, c) => s + c.amount, 0),
                  paid: list.filter((c) => c.broker_id === b.id && c.status === 'paid').reduce((s, c) => s + c.amount, 0),
                }))} columns={[{ key: 'name', label: 'Broker' }, { key: 'leads', label: 'Leads' }, { key: 'booked', label: 'Bookings' },
                  { key: 'payable', label: 'Payable', render: (r) => rupees(r.payable) }, { key: 'paid', label: 'Paid', render: (r) => rupees(r.paid) }]} />
                <div className="mt-4" />
                <DataTable title="Commissions" rows={list} columns={[
                  { key: 'broker', label: 'Broker', value: (c) => c.brokers?.name }, { key: 'lead', label: 'Lead', value: (c) => c.enquiries?.name },
                  { key: 'amount', label: 'Amount', render: (c) => rupees(c.amount) }, { key: 'status', label: 'Status', render: (c) => <StatusBadge value={c.status} tones={{ payable: 'amber' }} /> },
                  { key: 'paid_on', label: 'Paid on', render: (c) => formatDate(c.paid_on) },
                  { key: 'x', label: '', noExport: true, render: (c) => c.status === 'payable' && <Small onClick={() => setPay({ c, reload })}>Mark paid</Small> },
                ]} />
              </>
            )}
          </Load>
        </>
      )}
      {pay && <PayCommission c={pay.c} onClose={() => setPay(null)} onDone={() => { pay.reload(); setPay(null) }} />}
    </>
  )
}

function PayCommission({ c, onClose, onDone }) {
  const [v, setV] = useState({ mode: 'upi', ref: '', date: ymd() })
  const a = useAction()
  return (
    <Modal title={`Pay commission ${rupees(c.amount)}`} onClose={onClose}>
      <FormFields value={v} onChange={setV} fields={[{ key: 'mode', label: 'Mode', type: 'select', required: true, options: PAY_MODES },
        { key: 'ref', label: 'Reference' }, { key: 'date', label: 'Paid on', type: 'date', required: true }]} />
      <p className="mt-2 text-xs text-slate-500">Recorded as a Broker commission expense.</p>
      <ActionMsg action={a} />
      <Button className="mt-3" disabled={a.busy} onClick={async () => (await a.run(() => m.payCommission(c.id, v.mode, v.ref, v.date))) && onDone()}>Save</Button>
    </Modal>
  )
}

function Referrals({ manager }) {
  const a = useAction()
  return (
    <>
      <Notice>A tenant refers a friend: add the friend as an enquiry with source “Referral” and choose the tenant as referrer. When the friend checks in, a discount reward becomes credit on the referrer's next rent automatically; a cash reward waits here to be paid. The reward amount is set in Settings.</Notice>
      <div className="mt-4" />
      <Load loader={() => m.rows('referrals', '*, referrer:profiles!referrals_referrer_customer_id_fkey(full_name), enquiries(name)', (q) => q.order('created_at', { ascending: false }))}>
        {(list, reload) => (
          <DataTable title="Referrals" rows={list} columns={[
            { key: 'created_at', label: 'Date', render: (r) => formatDate(r.created_at) },
            { key: 'referrer', label: 'Referred by', value: (r) => r.referrer?.full_name }, { key: 'friend', label: 'Friend', value: (r) => r.enquiries?.name },
            { key: 'reward', label: 'Reward', value: (r) => `${label(r.reward_type)} ${rupees(r.reward_amount)}` },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} tones={{ earned: 'amber', applied: 'green', paid: 'green' }} />, value: (r) => r.status },
            { key: 'x', label: '', noExport: true, render: (r) => manager && r.status === 'earned' && r.reward_type === 'cash' && (
              <Small onClick={async () => (await a.run(() => m.markReferralPaid(r.id))) && reload()}>Mark paid</Small>
            ) },
          ]} />
        )}
      </Load>
      <ActionMsg action={a} />
    </>
  )
}

function Offers({ admin }) {
  const { properties } = useScope()
  return (
    <CrudPanel table="offers" idKey="code" title="Offers & discount codes" canEdit={admin} canDelete={false} query={(q) => q.order('created_at', { ascending: false })}
      defaults={{ kind: 'percent', applies_to: 'first_month', valid_from: ymd(), is_active: true, min_months: 0, min_days_ahead: 0 }}
      fromForm={(d) => (d.code ? { ...d, code: d.code.toUpperCase() } : d)}
      columns={[
        { key: 'code', label: 'Code' }, { key: 'description', label: 'Offer' },
        { key: 'value', label: 'Discount', value: (o) => (o.kind === 'percent' ? `${o.value}%` : `₹${o.value}`) },
        { key: 'applies_to', label: 'Rule', value: (o) => (o.applies_to === 'long_stay' ? `Lock-in ≥ ${o.min_months} months` : o.applies_to === 'early_bird' ? `Book ≥ ${o.min_days_ahead} days ahead` : 'First month') },
        { key: 'valid', label: 'Valid', value: (o) => `${formatDate(o.valid_from)} – ${o.valid_to ? formatDate(o.valid_to) : 'no end'}` },
        { key: 'used', label: 'Used', value: (o) => `${o.used_count}${o.max_uses ? ` / ${o.max_uses}` : ''}` },
        { key: 'is_active', label: 'Status', render: (o) => <StatusBadge value={o.is_active ? 'active' : 'inactive'} /> },
      ]}
      fields={[
        { key: 'code', label: 'Code (CAPITALS)', required: true }, { key: 'description', label: 'Description', required: true },
        { key: 'kind', label: 'Type', type: 'select', required: true, options: [['percent', '% off'], ['flat', '₹ off']] },
        { key: 'value', label: 'Value', type: 'number', required: true, min: 1, step: 'any' },
        { key: 'applies_to', label: 'Applies to', type: 'select', required: true, options: [['first_month', 'First month rent'], ['long_stay', 'Long stay (lock-in)'], ['early_bird', 'Early bird']] },
        { key: 'min_months', label: 'Minimum lock-in months (long stay)', type: 'number', min: 0 },
        { key: 'min_days_ahead', label: 'Minimum days booked ahead (early bird)', type: 'number', min: 0 },
        { key: 'valid_from', label: 'Valid from', type: 'date', required: true }, { key: 'valid_to', label: 'Valid to', type: 'date' },
        { key: 'max_uses', label: 'Maximum uses', type: 'number', min: 1 },
        { key: 'property_id', label: 'Only for property', type: 'select', options: properties.map((p) => [p.id, p.name]) },
        { key: 'is_active', label: 'Active', type: 'checkbox' },
      ]} />
  )
}
