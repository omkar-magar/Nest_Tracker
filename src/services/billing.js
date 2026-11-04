// Pure billing maths. Every figure comes from rows the database already holds; nothing here changes state.

const today = () => new Date().toISOString().slice(0, 10)

export const isOverdue = (bill) => bill.status === 'unpaid' && bill.due_date < today()

export function daysOverdue(bill) {
  if (!isOverdue(bill)) return 0
  return Math.round((new Date(today()) - new Date(bill.due_date)) / 86400000)
}

export function summarize(bills, payments) {
  const unpaid = bills.filter((b) => b.status === 'unpaid').sort((a, b) => a.due_date.localeCompare(b.due_date))
  const paid = payments.filter((p) => p.status === 'succeeded')
  return {
    unpaid,
    nextBill: unpaid[0] ?? null,
    amountPaid: paid.reduce((s, p) => s + p.amount, 0),
    outstanding: unpaid.reduce((s, b) => s + b.amount, 0),
    overdue: unpaid.filter(isOverdue),
    overdueAmount: unpaid.filter(isOverdue).reduce((s, b) => s + b.amount, 0),
  }
}

export const billLabel = (bill) => (isOverdue(bill) ? 'Overdue' : bill.status === 'unpaid' ? 'Due' : bill.status === 'paid' ? 'Paid' : 'Void')
