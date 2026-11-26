import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
import { FirstBill } from '../src/components/register/GuestRegister'

describe('first due date line in the guest details', () => {
  it('shows the extra days and what is owed, with the total', () => {
    render(<FirstBill g={{ rent: 7500, due_date: '2026-12-05', first_bill: 2250, first_bill_days: 9, carry_forward: 8500 }} />)
    expect(screen.getByText(/9 extra days ₹2,250 \+ ₹8,500 still owed from registration = ₹10,750\. Usual rent after that\./)).toBeInTheDocument()
  })
  it('includes the usual rent when there are no extra days (joined on the 1st-10th)', () => {
    render(<FirstBill g={{ rent: 7500, due_date: '2027-01-03', first_bill: null, carry_forward: 12150 }} />)
    expect(screen.getByText(/rent ₹7,500 \+ ₹12,150 still owed from registration = ₹19,650/)).toBeInTheDocument()
  })
  it('shows only the extra days when nothing is owed', () => {
    render(<FirstBill g={{ rent: 7000, due_date: '2027-01-05', first_bill: 5833, first_bill_days: 25, carry_forward: 0 }} />)
    expect(screen.getByText(/: 25 extra days ₹5,833\. Usual rent after that\./)).toBeInTheDocument()
  })
})
