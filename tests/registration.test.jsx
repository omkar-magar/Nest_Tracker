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

const at = (page) => render(<MemoryRouter>{page}</MemoryRouter>)
beforeEach(() => {
  resetMock(); setAuth(); localStorage.clear()
  db.tables.properties = { data: [{ id: 'P1', name: 'A wing' }] }
})

describe('demo registration and resident states', () => {
  it('fills the form and accepts a nonnumeric demo OTP through the trusted demo login', async () => {
    const auth = setAuth()
    db.fnResult = { data: { token_hash: 'demo-hash' }, error: null }
    supabase.auth.verifyOtp = vi.fn(async () => ({ data: { session: {} }, error: null }))
    at(<Signup />)
    await screen.findByRole('option', { name: 'A wing' })
    fireEvent.click(screen.getByRole('button', { name: 'Fill demo registration' }))
    expect(screen.getByLabelText('Email')).toHaveValue('customer@yolonest.test')
    expect(screen.getByLabelText(/I have read, understood/)).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    fireEvent.change(screen.getByLabelText('Demo OTP'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify demo OTP and register' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('submit_resident_registration', { p: expect.objectContaining({ email: 'customer@yolonest.test', property_id: 'P1' }) }))
    expect(auth.signUp).not.toHaveBeenCalled()
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'demo-hash', type: 'email' })
  })
  it.each([
    ['pending', /Waiting for manager’s approval/],
    ['active', /Your registration is approved/],
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
  it('lets the manager review registration details and supply the stay terms before approval', async () => {
    db.tables.tenant_profiles = { data: [{ user_id: 'c1', property_id: 'P1', email: 'customer@yolonest.test', profiles: { full_name: 'Demo Customer', phone: '9800000000' } }] }
    db.tables.rooms = { data: [{ room_no: '101', wing: 'A' }] }
    db.rpcs.approve_resident_registration = { data: 1 }
    const approved = vi.fn()
    at(<NewRegistrations pid="P1" onApproved={approved} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review and approve' }))
    await screen.findByRole('option', { name: 'A-101' })
    for (const [label, value] of [['Room *', 'A-101'], ['Monthly rent (₹) *', '6000'], ['Deposit (₹) *', '6000'], ['Rent due date *', '2026-12-03']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Approve and add to guest register' }))
    await waitFor(() => expect(approved).toHaveBeenCalled())
    expect(supabase.rpc).toHaveBeenCalledWith('approve_resident_registration', { p_user: 'c1', p: expect.objectContaining({ room_no: 'A-101', rent: '6000', due_date: '2026-12-03' }) })
  })
})
