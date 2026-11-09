import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { billLabel, daysOverdue, isOverdue, summarize } from '../src/services/billing'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-05T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const bill = (over = {}) => ({ id: 'b', amount: 1000, status: 'unpaid', due_date: '2026-11-10', ...over })

describe('isOverdue', () => {
  it('is true for an unpaid bill past its due date', () => {
    expect(isOverdue(bill({ due_date: '2026-11-04' }))).toBe(true)
  })
  it('is false when due today or later', () => {
    expect(isOverdue(bill({ due_date: '2026-11-05' }))).toBe(false)
    expect(isOverdue(bill({ due_date: '2026-12-01' }))).toBe(false)
  })
  it('is false for paid or void bills even if the date has passed', () => {
    expect(isOverdue(bill({ status: 'paid', due_date: '2026-01-01' }))).toBe(false)
    expect(isOverdue(bill({ status: 'void', due_date: '2026-01-01' }))).toBe(false)
  })
})

describe('daysOverdue', () => {
  it('counts whole days late', () => {
    expect(daysOverdue(bill({ due_date: '2026-11-01' }))).toBe(4)
  })
  it('is 0 when not overdue', () => {
    expect(daysOverdue(bill({ due_date: '2026-11-20' }))).toBe(0)
    expect(daysOverdue(bill({ status: 'paid', due_date: '2026-10-01' }))).toBe(0)
  })
})

describe('summarize', () => {
  const bills = [
    bill({ id: 'late', amount: 500, due_date: '2026-11-01' }),
    bill({ id: 'later', amount: 700, due_date: '2026-12-01' }),
    bill({ id: 'soon', amount: 300, due_date: '2026-11-08' }),
    bill({ id: 'done', amount: 9999, status: 'paid', due_date: '2026-10-01' }),
  ]
  const payments = [
    { amount: 2000, status: 'succeeded' },
    { amount: 1500, status: 'succeeded' },
    { amount: 800, status: 'failed' },
    { amount: 400, status: 'created' },
  ]
  const s = summarize(bills, payments)

  it('sorts unpaid bills by due date and picks the earliest as next', () => {
    expect(s.unpaid.map((b) => b.id)).toEqual(['late', 'soon', 'later'])
    expect(s.nextBill.id).toBe('late')
  })
  it('totals only succeeded payments', () => {
    expect(s.amountPaid).toBe(3500)
  })
  it('totals outstanding across unpaid bills only', () => {
    expect(s.outstanding).toBe(1500)
  })
  it('separates overdue bills and their amount', () => {
    expect(s.overdue.map((b) => b.id)).toEqual(['late'])
    expect(s.overdueAmount).toBe(500)
  })
  it('handles an empty account', () => {
    expect(summarize([], [])).toMatchObject({ nextBill: null, amountPaid: 0, outstanding: 0, overdueAmount: 0 })
  })
})

describe('billLabel', () => {
  it('maps status to a customer-facing label', () => {
    expect(billLabel(bill({ due_date: '2026-11-01' }))).toBe('Overdue')
    expect(billLabel(bill())).toBe('Due')
    expect(billLabel(bill({ status: 'paid' }))).toBe('Paid')
    expect(billLabel(bill({ status: 'void' }))).toBe('Void')
  })
})
