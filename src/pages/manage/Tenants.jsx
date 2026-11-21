import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import DataTable from '../../components/manage/DataTable'
import { ActionMsg, FormFields, Load, Modal, StatusBadge, useAction, useScope } from '../../components/manage/kit'
import { TENANT_FIELDS, validateTenant } from '../../components/manage/tenantFields'
import { Button, Notice, inputCls } from '../../components/ui'
import * as m from '../../services/manage'
import { formatDate } from '../../services/format'

const stayOf = (t) => t.bookings.find((b) => ['active', 'pending'].includes(b.status)) ?? null

export default function Tenants() {
  const { property } = useScope()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState('current')
  const navigate = useNavigate()
  const registering = params.get('new') === '1'

  return (
    <Load loader={() => m.loadTenants(property)} deps={[property]}>
      {(list, reload) => {
        const rows = list.map((t) => {
          const stay = stayOf(t)
          const last = t.bookings[0]
          return {
            ...t, room: stay?.rooms?.room_no ?? '', stay,
            state: stay ? (stay.notice_date ? 'on notice' : 'staying') : last ? 'past' : 'registered',
            approval: t.tenant_profiles?.approval_status ?? 'pending', police: t.tenant_profiles?.police_status ?? 'pending',
            risk: t.tenant_profiles?.risk_flag, since: stay?.check_in, leaving: stay?.expected_checkout ?? last?.actual_checkout,
          }
        })
        const shown = rows.filter((r) => filter === 'all' || (filter === 'current' && r.stay) || (filter === 'past' && r.state === 'past')
          || (filter === 'approval' && r.approval === 'pending') || (filter === 'police' && !['verified', 'not_required'].includes(r.police) && r.stay))
        return (
          <>
            <DataTable title="Tenants" rows={shown} onRowClick={(r) => navigate(`/admin/tenants/${r.id}`)}
              filters={(
                <>
                  <label className="text-sm"><span className="sr-only">Show</span>
                    <select className={`${inputCls} !w-auto`} value={filter} onChange={(e) => setFilter(e.target.value)}>
                      <option value="current">Staying now</option><option value="approval">Awaiting approval</option>
                      <option value="police">Police verification pending</option><option value="past">Checked out</option><option value="all">Everyone</option>
                    </select>
                  </label>
                  <Button className="!py-1.5" onClick={() => setParams({ new: '1' })}>Register tenant</Button>
                  <Button variant="outline" className="!py-1.5" to="/admin/checkin">Check in</Button>
                </>
              )}
              columns={[
                { key: 'full_name', label: 'Name', render: (r) => <span className="font-medium">{r.full_name}{r.risk && <span className="ml-1 text-xs text-red-700">⚠ late payer</span>}</span>, value: (r) => r.full_name },
                { key: 'phone', label: 'Mobile' }, { key: 'room', label: 'Room' },
                { key: 'state', label: 'Stay', render: (r) => <StatusBadge value={r.state} tones={{ staying: 'green', 'on notice': 'amber', past: 'gray', registered: 'gray' }} /> },
                { key: 'since', label: 'Check-in', render: (r) => formatDate(r.since) },
                { key: 'leaving', label: 'Check-out', render: (r) => formatDate(r.leaving) },
                { key: 'approval', label: 'Approval', render: (r) => <StatusBadge value={r.approval} /> },
                { key: 'police', label: 'Police verification', render: (r) => <StatusBadge value={r.police} /> },
              ]} />
            {registering && <RegisterTenant onClose={() => setParams({})} onDone={(id) => { reload(); navigate(`/admin/tenants/${id}`) }} prefill={Object.fromEntries(params)} />}
          </>
        )
      }}
    </Load>
  )
}

// PRD 3.1 office registration: creates the login (phone OTP; email optional), then the tenant record.
// Opened from an enquiry ("Convert to tenant") it arrives pre-filled.
export function RegisterTenant({ onClose, onDone, prefill = {} }) {
  const { property, properties } = useScope()
  const [v, setV] = useState({
    ...Object.fromEntries(TENANT_FIELDS.map((f) => [f.key, f.type === 'checkbox' ? false : ''])),
    full_name: prefill.name ?? '', phone: prefill.phone ?? '', email: prefill.email ?? '', property_id: prefill.property ?? property ?? properties[0]?.id ?? '',
  })
  const a = useAction()
  const submit = async (e) => {
    e.preventDefault()
    const bad = validateTenant(v)
    if (bad) { a.run(() => Promise.reject(new Error(bad))); return }
    const res = await a.run(async () => {
      const { id } = await m.createUser({ role: 'customer', full_name: v.full_name, phone: v.phone, email: v.email, property_id: v.property_id })
      await m.saveTenant(id, { ...v, approve: true })
      if (prefill.enquiry) await m.updateEnquiry(prefill.enquiry, { converted_customer_id: id, status: 'negotiation' }).catch(() => {})
      return id
    })
    if (res) onDone(res)
  }
  return (
    <Modal title="Register tenant" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <FormFields value={v} onChange={setV} fields={[
          { key: 'property_id', label: 'Property', type: 'select', required: true, options: properties.map((p) => [p.id, p.name]) },
          ...TENANT_FIELDS,
        ]} />
        <Notice>The tenant can sign in with this mobile number (one-time code). ID documents, agreement and bed are added on the next screen.</Notice>
        <ActionMsg action={a} />
        <div className="flex gap-2"><Button type="submit" disabled={a.busy}>{a.busy ? 'Saving…' : 'Register'}</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  )
}
