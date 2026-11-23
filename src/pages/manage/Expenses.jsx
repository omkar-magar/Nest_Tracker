import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import CrudPanel from '../../components/manage/CrudPanel'
import { FileButton, Load, Small, StatusBadge, Tabs, useAction, useScope } from '../../components/manage/kit'
import DataTable from '../../components/manage/DataTable'
import { Notice } from '../../components/ui'
import * as m from '../../services/manage'
import { label, monthStart, ymd } from '../../services/pg'
import { formatDate, rupees } from '../../services/format'

const MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other']

export default function Expenses() {
  const { role } = useAuth()
  const [tab, setTab] = useState('expenses')
  return (
    <div>
      <Tabs tab={tab} onTab={setTab} tabs={[['expenses', 'Expenses'], ['approvals', 'Waiting for approval'], ['recurring', 'Recurring'],
        ['income', 'Other income'], ...(role === 'admin' ? [['categories', 'Categories']] : [])]} />
      <Load loader={() => m.rows('expense_categories', '*', (q) => q.order('sort_order'))}>
        {(cats) => (
          <>
            {tab === 'expenses' && <ExpenseList cats={cats} />}
            {tab === 'approvals' && <Approvals />}
            {tab === 'recurring' && <Recurring cats={cats} />}
            {tab === 'income' && <OtherIncome />}
            {tab === 'categories' && <Categories />}
          </>
        )}
      </Load>
    </div>
  )
}

const catOptions = (cats) => cats.map((c) => [c.id, `${c.name} (${label(c.grp)})`])

function ExpenseList({ cats }) {
  const { property, properties } = useScope()
  const [from, setFrom] = useState(monthStart())
  const a = useAction()
  const receipt = (r, reload) => (r.receipt_path
    ? <Small onClick={() => a.run(async () => window.open(await m.fileUrl('expense-receipts', r.receipt_path), '_blank', 'noopener'))}>Receipt</Small>
    : <FileButton label="Add bill photo" busy={a.busy} onFile={(f) => a.run(async () => {
      const path = await m.uploadFile('expense-receipts', r.property_id, f)
      await m.updateRow('expenses', r.id, { receipt_path: path })
      reload()
    })} />)
  return (
    <>
      <label className="mb-3 block text-sm">From <input type="date" className="rounded-xl border border-navy/20 px-2 py-1" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <CrudPanel table="expenses" title="Expenses" deps={[property, from]} select="*, expense_categories(name, grp)"
        query={(q) => { let x = q.gte('spent_on', from).order('spent_on', { ascending: false }); if (property) x = x.eq('property_id', property); return x }}
        defaults={{ property_id: property || properties[0]?.id, spent_on: ymd(), payment_mode: 'cash' }}
        canEdit
        columns={[
          { key: 'spent_on', label: 'Date', render: (r) => formatDate(r.spent_on), value: (r) => r.spent_on },
          { key: 'property_id', label: 'Property' },
          { key: 'category', label: 'Category', value: (r) => r.expense_categories?.name },
          { key: 'amount', label: 'Amount', render: (r) => rupees(r.amount), value: (r) => r.amount },
          { key: 'vendor', label: 'Vendor / payee' }, { key: 'payment_mode', label: 'Paid by', value: (r) => label(r.payment_mode) },
          { key: 'source', label: 'Source', value: (r) => label(r.source) },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} />, value: (r) => r.status },
          { key: 'notes', label: 'Notes' },
        ]}
        extraActions={receipt}
        fields={[
          { key: 'property_id', label: 'Property', type: 'select', required: true, options: properties.map((p) => [p.id, p.name]) },
          { key: 'spent_on', label: 'Date', type: 'date', required: true },
          { key: 'category_id', label: 'Category', type: 'select', required: true, options: catOptions(cats) },
          { key: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1 },
          { key: 'vendor', label: 'Vendor / payee', keepEmpty: true }, { key: 'payment_mode', label: 'Payment mode', type: 'select', required: true, options: MODES },
          { key: 'notes', label: 'Notes', type: 'textarea', keepEmpty: true },
        ]} />
      {a.error && <p role="alert" className="mt-2 text-sm text-red-700">{a.error}</p>}
      <p className="mt-3 text-xs text-slate-500">Salaries, repair costs from complaints and marketing spend appear here automatically. Managers' entries above the approval limit wait for the owner.</p>
    </>
  )
}

function Approvals() {
  const { role } = useAuth()
  const a = useAction()
  return (
    <Load loader={() => m.rows('expenses', '*, expense_categories(name)', (q) => q.eq('status', 'pending').order('spent_on'))}>
      {(list, reload) => (
        <>
          {role !== 'admin' && <Notice>The owner approves these. You can still edit them.</Notice>}
          <DataTable title="Expenses awaiting approval" rows={list} empty="Nothing waiting" columns={[
            { key: 'spent_on', label: 'Date', render: (r) => formatDate(r.spent_on) }, { key: 'property_id', label: 'Property' },
            { key: 'cat', label: 'Category', value: (r) => r.expense_categories?.name }, { key: 'amount', label: 'Amount', render: (r) => rupees(r.amount) },
            { key: 'vendor', label: 'Vendor' }, { key: 'notes', label: 'Notes' },
            { key: 'x', label: '', noExport: true, render: (r) => role === 'admin' && (
              <span className="flex gap-1">
                <Small onClick={async () => (await a.run(() => m.approveExpense(r.id, true))) && reload()}>Approve</Small>
                <Small onClick={async () => (await a.run(() => m.approveExpense(r.id, false))) && reload()}>Reject</Small>
              </span>
            ) },
          ]} />
          {a.error && <p role="alert" className="text-sm text-red-700">{a.error}</p>}
        </>
      )}
    </Load>
  )
}

function Recurring({ cats }) {
  const { property, properties } = useScope()
  return (
    <CrudPanel table="recurring_expenses" title="Recurring expenses" select="*, expense_categories(name)" deps={[property]}
      query={(q) => (property ? q.eq('property_id', property) : q).order('day_of_month')}
      defaults={{ property_id: property || properties[0]?.id, day_of_month: 1, active: true, payment_mode: 'bank_transfer' }}
      columns={[
        { key: 'property_id', label: 'Property' }, { key: 'cat', label: 'Category', value: (r) => r.expense_categories?.name },
        { key: 'amount', label: 'Amount', render: (r) => rupees(r.amount) }, { key: 'vendor', label: 'Vendor' },
        { key: 'day_of_month', label: 'Day of month' }, { key: 'last_month', label: 'Last created', render: (r) => formatDate(r.last_month) },
        { key: 'active', label: 'Status', render: (r) => <StatusBadge value={r.active ? 'active' : 'stopped'} /> },
      ]}
      fields={[
        { key: 'property_id', label: 'Property', type: 'select', required: true, options: properties.map((p) => [p.id, p.name]) },
        { key: 'category_id', label: 'Category', type: 'select', required: true, options: catOptions(cats) },
        { key: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1 }, { key: 'vendor', label: 'Vendor', keepEmpty: true },
        { key: 'payment_mode', label: 'Payment mode', type: 'select', required: true, options: MODES },
        { key: 'day_of_month', label: 'Create on day', type: 'number', required: true, min: 1, max: 28 },
        { key: 'notes', label: 'Notes', type: 'textarea', keepEmpty: true }, { key: 'active', label: 'Active', type: 'checkbox' },
      ]} />
  )
}

function OtherIncome() {
  const { property, properties } = useScope()
  return (
    <CrudPanel table="other_income" title="Other income" deps={[property]} query={(q) => (property ? q.eq('property_id', property) : q).order('received_on', { ascending: false })}
      defaults={{ property_id: property || properties[0]?.id, received_on: ymd() }}
      columns={[{ key: 'received_on', label: 'Date', render: (r) => formatDate(r.received_on) }, { key: 'property_id', label: 'Property' },
        { key: 'source', label: 'Source' }, { key: 'amount', label: 'Amount', render: (r) => rupees(r.amount) }, { key: 'notes', label: 'Notes' }]}
      fields={[
        { key: 'property_id', label: 'Property', type: 'select', required: true, options: properties.map((p) => [p.id, p.name]) },
        { key: 'received_on', label: 'Date', type: 'date', required: true }, { key: 'source', label: 'Source', required: true },
        { key: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1 }, { key: 'notes', label: 'Notes', type: 'textarea', keepEmpty: true },
      ]} />
  )
}

function Categories() {
  return (
    <CrudPanel table="expense_categories" title="Expense categories" query={(q) => q.order('sort_order')} defaults={{ grp: 'other', sort_order: 100 }}
      columns={[{ key: 'name', label: 'Name' }, { key: 'grp', label: 'Group', value: (r) => label(r.grp) },
        { key: 'is_system', label: 'Linked automatically', value: (r) => (r.is_system ? 'yes' : '') }]}
      fields={[
        { key: 'id', label: 'Code (letters, no spaces)', required: true }, { key: 'name', label: 'Name', required: true },
        { key: 'grp', label: 'Group', type: 'select', required: true, options: ['utilities', 'salaries', 'maintenance', 'food', 'other'] },
        { key: 'sort_order', label: 'Order', type: 'number' },
      ]} />
  )
}
