import { brand } from '../data/site'

// Receipts, invoices, payslips and agreements as real PDF files. jsPDF loads only when one is asked for.
// jsPDF's built-in font has no ₹ glyph, so amounts are written as "Rs".
const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN')}`
const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')

async function start(title, ref) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'pt' })
  doc.setFillColor(28, 31, 74)
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 70, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.text(brand.name, 40, 42)
  doc.setFontSize(10)
  doc.text(title, doc.internal.pageSize.getWidth() - 40, 34, { align: 'right' })
  if (ref) doc.text(ref, doc.internal.pageSize.getWidth() - 40, 50, { align: 'right' })
  doc.setTextColor(28, 31, 74)
  doc.setFontSize(9)
  doc.text(`${brand.address} · ${brand.phone}`, 40, 90)
  return { doc, autoTable }
}

const kv = (autoTable, doc, y, pairs) => autoTable(doc, {
  startY: y, theme: 'plain', styles: { fontSize: 10, cellPadding: 2 },
  columnStyles: { 0: { fontStyle: 'bold', cellWidth: 150 } }, body: pairs.map(([k, v]) => [k, String(v ?? '-')]),
})

export async function receiptPdf({ payment, bill, tenant }) {
  const { doc, autoTable } = await start('PAYMENT RECEIPT', payment.receipt_no || payment.id.slice(0, 8))
  kv(autoTable, doc, 110, [
    ['Received from', tenant?.full_name], ['Amount', rs(payment.amount)], ['Towards', bill?.description],
    ['Invoice', bill?.invoice_no], ['Paid on', date(payment.paid_on || payment.completed_at)],
    ['Mode', payment.is_simulated ? 'Demo (simulated - not real money)' : payment.provider.replace('_', ' ')],
    ['Reference', payment.reference || payment.provider_payment_id], ['Status', payment.status],
  ])
  doc.setFontSize(8)
  doc.text('This is a computer-generated receipt and needs no signature.', 40, doc.lastAutoTable.finalY + 30)
  doc.save(`receipt-${payment.receipt_no || payment.id.slice(0, 8)}.pdf`)
}

export async function invoicePdf({ bill, tenant, room }) {
  const { doc, autoTable } = await start('INVOICE', bill.invoice_no)
  kv(autoTable, doc, 110, [
    ['Billed to', tenant?.full_name], ['Room', room], ['Period', bill.period_start ? `${date(bill.period_start)} to ${date(bill.period_end)}` : '-'],
    ['Due date', date(bill.due_date)],
  ])
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 14, head: [['Item', 'Amount']], headStyles: { fillColor: [28, 31, 74] },
    body: [...(bill.bill_lines || []).map((l) => [l.description, rs(l.amount)]),
      ['Total', rs(bill.amount)], ['Paid', rs(bill.amount_paid)], ['Balance due', rs(bill.amount - bill.amount_paid)]],
    columnStyles: { 1: { halign: 'right' } },
  })
  doc.save(`invoice-${bill.invoice_no}.pdf`)
}

export async function payslipPdf({ slip, staff }) {
  const month = new Date(slip.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const { doc, autoTable } = await start('PAYSLIP', month)
  kv(autoTable, doc, 110, [
    ['Employee', staff.full_name], ['Designation', staff.designation], ['Property', slip.property_id],
    ['Days in month', slip.days_in_month], ['Payable days', slip.payable_days], ['Present / half days', `${slip.present_days} / ${slip.half_days}`],
    ['Paid leave / unpaid', `${slip.paid_leave_days} / ${slip.unpaid_days}`], ['Overtime hours', slip.overtime_hours],
  ])
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 14, head: [['Earnings', '', 'Deductions', '']], headStyles: { fillColor: [28, 31, 74] },
    body: [
      ['Basic', rs(slip.earned_basic), 'PF', rs(slip.pf)],
      ['Allowances', rs(slip.earned_allowances), 'ESI', rs(slip.esi)],
      ['Overtime', rs(slip.overtime_pay), 'Advance recovery', rs(slip.advance_recovery)],
      ['Bonus', rs(slip.bonus), 'Other', rs(slip.other_deductions)],
      ['Gross', rs(slip.gross), 'Net pay', rs(slip.net)],
    ],
  })
  if (slip.status === 'paid') doc.text(`Paid on ${date(slip.paid_on)} by ${slip.mode}${slip.reference ? ` (${slip.reference})` : ''}`, 40, doc.lastAutoTable.finalY + 24)
  doc.save(`payslip-${staff.full_name.replace(/\W+/g, '-')}-${slip.month}.pdf`)
}

export async function agreementPdf({ agreement, tenant }) {
  const { doc } = await start('RENTAL AGREEMENT', `${date(agreement.start_date)} - ${date(agreement.end_date)}`)
  doc.setFontSize(10)
  const text = agreement.body || [
    `Tenant: ${tenant?.full_name}`, `Period: ${date(agreement.start_date)} to ${date(agreement.end_date)}`,
    `Rent: ${rs(agreement.rent)} per month. Deposit: ${rs(agreement.deposit)}.`,
    `Lock-in: ${agreement.lock_in_months} month(s). Notice: ${agreement.notice_period_days} day(s).`, '', 'House rules', agreement.rules,
  ].join('\n')
  const lines = doc.splitTextToSize(text.replace(/₹/g, 'Rs '), doc.internal.pageSize.getWidth() - 80)
  let y = 115
  for (const l of lines) {
    if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 50 }
    doc.text(l, 40, y)
    y += 14
  }
  y += 16
  doc.text(agreement.accepted_at
    ? `Accepted by ${agreement.accepted_name || tenant?.full_name} on ${new Date(agreement.accepted_at).toLocaleString('en-IN')} (${agreement.acceptance_method})`
    : 'Not yet accepted.', 40, y)
  doc.save(`agreement-${(tenant?.full_name || 'tenant').replace(/\W+/g, '-')}.pdf`)
}
