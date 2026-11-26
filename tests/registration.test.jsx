import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
vi.mock('../src/services/registration', async (original) => ({ ...await original(), demoEnabled: true }))
import { asRole, setAuth } from './helpers/authMock'
import { db, resetMock, supabase } from './helpers/supabaseMock'
import Signup from '../src/pages/Signup'
import Account from '../src/pages/Account'
import NewRegistrations from '../src/components/register/NewRegistrations'
import { approveRegistration, registrationStayError } from '../src/services/registration'

const at = (page) => render(<MemoryRouter>{page}</MemoryRouter>)
beforeEach(() => {
  resetMock(); setAuth(); localStorage.clear()
  db.tables.properties = { data: [{ id: 'P1', name: 'A wing' }] }
})

describe('demo registration and resident states', () => {
  it('accepts a nonnumeric demo OTP first, then fills the demo form for the guest to finish', async () => {
    const auth = setAuth()
    db.fnResult = { data: { token_hash: 'demo-hash' }, error: null }
    db.rpcs.registration_rooms = { data: [{ room_no: 'A-101', floor: 1, free: 1, beds: 2 }] }
    supabase.auth.verifyOtp = vi.fn(async () => ({ data: { session: {} }, error: null }))
    at(<Signup />)
    fireEvent.click(screen.getByRole('button', { name: 'Use the demo account' }))
    fireEvent.change(screen.getByLabelText('Demo OTP'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify demo OTP' }))
    expect(await screen.findByLabelText(/I have read, understood/)).toBeChecked()
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'demo-hash', type: 'email' })
    expect(auth.signUp).not.toHaveBeenCalled()
    expect(await screen.findByLabelText('Property')).toHaveValue('P1')
    fireEvent.change(await screen.findByLabelText('Room *'), { target: { value: 'A-101' } })
    fireEvent.change(screen.getByLabelText('Move-in date *'), { target: { value: '2099-01-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send registration and continue to payment' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('submit_resident_registration', { p: expect.objectContaining({
      email: 'customer@yolonest.test', property_id: 'P1', room_no: 'A-101', due_day: 5 }) }))
  })
  it('shows a sent registration waiting for payment with the chosen stay', async () => {
    asRole('customer')
    db.rpcs.my_registration = { data: { state: 'pending', approval: 'pending', stay_type: 'pg', room_no: 'A-101', move_in_date: '2099-01-20',
      due_day: 4, first_due: '2099-02-04', payment_status: 'waiting', payment_mode: 'online', amount_due: 14000, stays: [] } }
    at(<Account />)
    expect(await screen.findByText(/Waiting for payment/)).toBeInTheDocument()
    expect(screen.getByText('PG (monthly)')).toBeInTheDocument()
    expect(screen.getByText('₹14,000')).toBeInTheDocument()
  })
  it.each([
    ['pending', /Waiting for manager’s approval/],
    ['ended', /Thank you for staying with us/],
  ])('shows the %s state and refreshes after a manager action', async (state, message) => {
    asRole('customer')
    db.rpcs.my_registration = { data: { state, stays: [] } }
    at(<Account />)
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText('Current booking')).not.toBeInTheDocument()
    db.rpcs.my_registration = { data: { state: 'ended', stays: [{ id: 1, room_no: 'A-101', removed: true, rent: 6000, deposit: 6000 }] } }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    expect(await screen.findByText(/Room A-101 · Removed/)).toBeInTheDocument()
  })
  it('opens the full resident dashboard once approved: stay, rent this month and next, room items and extras', async () => {
    asRole('customer')
    db.rpcs.my_registration = { data: { state: 'active', payment: { amount: 1000, status: 'succeeded', is_simulated: true, paid_at: '2026-11-20T10:00:00Z' }, stays: [] } }
    db.rpcs.my_stay = { data: {
      room_no: 'A-102', property_name: 'A wing', rent: 6000, deposit: 6000, deposit_status: 'paid', check_in: '2026-11-01',
      months: [
        { month: '2026-11-01', due_date: '2026-11-05', rent: 6000, extras: [], total: 6000, status: 'paid' },
        { month: '2026-12-01', due_date: '2026-12-05', rent: 6000, extras: [{ item: 'chair', qty: 2, amount: 200 }], total: 6200, status: 'upcoming' },
      ],
      inventory: { bed: 5, mattress: 5, pillow: 5, chair: 1 },
      addons: [{ id: 7, item: 'chair', qty: 2, unit_price: 100, status: 'approved', charge_month: '2026-12-01', note: '' }],
      addon_prices: { chair: 100, table: 400, cupboard: 500 },
    } }
    db.rpcs.my_electricity_connection = { data: { room_label: 'A-102', consumer_id: '170681865295' } }
    db.rpcs.request_addon = { data: 8 }
    at(<Account />)
    expect(await screen.findByText(/Your registration is approved/)).toBeInTheDocument()
    expect(await screen.findByText('This month · November 2026')).toBeInTheDocument()
    expect(screen.getByText('Next rent · December 2026')).toBeInTheDocument()
    expect(screen.getByText('2 × Chair (extra)')).toBeInTheDocument()
    expect(screen.getByText('₹6,200')).toBeInTheDocument()
    expect(screen.getByText('Pillows')).toBeInTheDocument()
    expect(await screen.findByText('170681865295')).toBeInTheDocument()
    expect(screen.getByText(/Registration payment: ₹1,000 paid/)).toBeInTheDocument()
    expect(screen.queryByText('Current booking')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: 'cupboard' } })
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request · ₹1,000' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('request_addon', { p_item: 'cupboard', p_qty: 2 }))
  })
  it('lets the manager review registration details and supply the stay terms before approval', async () => {
    db.tables.tenant_profiles = { data: [{ user_id: 'c1', property_id: 'P1', email: 'customer@yolonest.test', profiles: { full_name: 'Demo Customer', phone: '9800000000' } }] }
    db.tables.rooms = { data: [{ room_no: '101', wing: 'A' }] }
    db.rpcs.approve_resident_registration = { data: 1 }
    const approved = vi.fn()
    at(<NewRegistrations pid="P1" onApproved={approved} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review and approve' }))
    await screen.findByRole('option', { name: 'A-101' })
    for (const [label, value] of [['Room *', 'A-101'], ['Monthly rent (₹) *', '6000'], ['Deposit (₹) *', '6000'], ['First rent due date *', '2026-12-03']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.change(screen.getByLabelText('Check-in *'), { target: { value: '2026-11-25' } })
    const checkout = screen.getByLabelText('Expected check-out')
    expect(checkout).toHaveAttribute('min', '2026-11-25')
    fireEvent.change(checkout, { target: { value: '0234-02-21' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Expected check-out must be on or after check-in')
    expect(screen.getByRole('button', { name: 'Approve and add to guest register' })).toBeDisabled()
    expect(supabase.rpc).not.toHaveBeenCalled()
    fireEvent.change(checkout, { target: { value: '2026-11-26' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monthly rent (₹) *')).toHaveValue(6000)
    expect(screen.getByLabelText('Room *')).toHaveValue('A-101')
    fireEvent.click(screen.getByRole('button', { name: 'Approve and add to guest register' }))
    await waitFor(() => expect(approved).toHaveBeenCalled())
    expect(supabase.rpc).toHaveBeenCalledWith('approve_resident_registration', { p_user: 'c1', p: expect.objectContaining({ room_no: 'A-101', rent: '6000', due_date: '2026-12-03' }) })
  })
  it('lets the guest pay the stay online with the offline note, then shows it as paid', async () => {
    asRole('customer')
    const waiting = { state: 'pending', approval: 'pending', stay_type: 'pg', room_no: 'A-101', move_in_date: '2099-01-20', due_day: 4,
      payment_status: 'waiting', payment_mode: 'online', amount_due: 14000, amount_paid: 0, stays: [] }
    db.rpcs.my_registration = { data: waiting }
    db.rpcs.start_my_registration_payment = { data: { id: 'p1', amount: 14000 } }
    db.rpcs.demo_complete_my_registration_payment = { data: { id: 'p1', status: 'succeeded', amount: 14000 } }
    at(<Account />)
    expect(await screen.findByText(/Ask your manager if you want to pay offline, or wait if you have already paid offline/)).toBeInTheDocument()
    db.rpcs.my_registration = { data: { ...waiting, payment_status: 'paid', amount_paid: 14000 } }
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹14,000 (demo success)' }))
    expect(await screen.findByText(/Payment of ₹14,000 received/)).toBeInTheDocument()
    expect(supabase.rpc).toHaveBeenCalledWith('demo_complete_my_registration_payment', { p_id: 'p1', p_outcome: 'success' })
  })
  it('makes the manager wait for an online payment, or switch to offline and record what was collected', async () => {
    db.tables.tenant_profiles = { data: [{ user_id: 'c1', property_id: 'P1', stay_type: 'pg', room_no: 'A-101', move_in_date: '2099-01-20', due_day: 4,
      payment_mode: 'online', payment_status: 'waiting', amount_due: 14000, amount_paid: 0, profiles: { full_name: 'Asha', phone: '9800000000' } }] }
    db.tables.rooms = { data: [{ room_no: '101', wing: 'A' }] }
    db.rpcs.stay_quote = { data: { daily: false, rent: 7000, deposit: 7000, amount: 14000 } }
    db.rpcs.approve_resident_registration = { data: 1 }
    at(<NewRegistrations pid="P1" onApproved={vi.fn()} />)
    expect(await screen.findByText('Waiting for payment')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review and approve' }))
    await waitFor(() => expect(screen.getByLabelText('Monthly rent (₹) *')).toHaveValue(7000))
    expect(screen.getByLabelText('Room *')).toHaveValue('A-101')
    expect(screen.getByLabelText('First rent due date *')).toHaveValue('2099-02-04')
    const approve = screen.getByRole('button', { name: 'Approve and add to guest register' })
    expect(approve).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Payment *'), { target: { value: 'offline' } })
    fireEvent.change(screen.getByLabelText('Collected *'), { target: { value: 'partially_paid' } })
    fireEvent.change(screen.getByLabelText('Amount received (₹) *'), { target: { value: '5000' } })
    expect(screen.getByText(/added to the guest's first rent/)).toBeInTheDocument()
    fireEvent.click(approve)
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('approve_resident_registration', { p_user: 'c1', p: expect.objectContaining({
      payment_mode: 'offline', payment_status: 'partially_paid', amount_paid: '5000', rent: '7000', deposit: '7000' }) }))
  })
  it('revalidates checkout when check-in changes and allows blank or same-day checkout', () => {
    expect(registrationStayError({ check_in: '2026-11-25', expected_checkout: '' })).toBe('')
    expect(registrationStayError({ check_in: '2026-11-25', expected_checkout: '2026-11-25' })).toBe('')
    expect(registrationStayError({ check_in: '2026-11-26', expected_checkout: '2026-11-25' })).toContain('on or after check-in')
  })
  it('rejects the pictured invalid date before calling the database', async () => {
    await expect(approveRegistration('c1', { check_in: '2026-11-25', expected_checkout: '0234-02-21' })).rejects.toThrow('Expected check-out must be on or after check-in')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
  it('shows a useful message if the database rejects the date range', async () => {
    db.rpcs.approve_resident_registration = { error: { code: '23514', message: 'new row for relation "register_guests" violates check constraint "register_guests_check"' } }
    await expect(approveRegistration('c1', { check_in: '2026-11-25', expected_checkout: '' })).rejects.toThrow('Expected check-out must be on or after check-in')
  })
})
