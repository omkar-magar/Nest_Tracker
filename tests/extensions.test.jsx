// Daily-stay guests ask to extend; managers extend (also after check-out) and answer requests.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
import { asRole } from './helpers/authMock'
import { db, resetMock, supabase } from './helpers/supabaseMock'
import MyStay from '../src/pages/account/MyStay'
import ExtensionRequests from '../src/components/register/ExtensionRequests'
import ExtendStay from '../src/components/register/ExtendStay'

const at = (page) => render(<MemoryRouter>{page}</MemoryRouter>)
beforeEach(() => { resetMock(); asRole('customer') })

const daily = { guest_id: 9, room_no: 'A-101', stay_type: 'pg_daily', rent: 2400, rent_status: 'paid', deposit: 1000, check_in: '2099-01-01',
  expected_checkout: '2099-01-04', months: [], inventory: {}, addons: [], addon_prices: {} }

describe('guest on a daily stay', () => {
  it('sees the stay charge and asks the manager to extend', async () => {
    db.rpcs.my_stay = { data: daily }
    db.rpcs.my_extension = { data: null }
    db.rpcs.request_extension = { data: 1 }
    at(<MyStay />)
    expect(await screen.findByText(/Your stay ends on/)).toBeInTheDocument()
    expect(screen.getByText('Stay charge')).toBeInTheDocument()
    expect(screen.queryByText(/This month ·/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Stay until')).toHaveAttribute('min', '2099-01-05')
    fireEvent.change(screen.getByLabelText('Stay until'), { target: { value: '2099-01-08' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask manager to extend' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('request_extension', { p_until: '2099-01-08', p_note: '' }))
  })
  it('sees a waiting request and can cancel it', async () => {
    db.rpcs.my_stay = { data: daily }
    db.rpcs.my_extension = { data: { id: 3, guest_id: 9, status: 'requested', requested_until: '2099-01-08' } }
    at(<MyStay />)
    expect(await screen.findByText('Waiting for your manager')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ask manager to extend' })).not.toBeInTheDocument()
  })
})

describe('manager', () => {
  beforeEach(() => asRole('manager'))
  it('approves a request with the dates, charge and rent status they choose', async () => {
    db.rpcs.extension_requests = { data: [{ id: 3, guest_id: 9, guest: 'Asha', room_no: 'A-101', current_until: '2099-01-04', requested_until: '2099-01-08',
      note: 'Project extended', status: 'requested', open: true, rent: 2400 }] }
    db.rpcs.extend_stay = { data: null }
    at(<ExtensionRequests pid="P1" />)
    expect(await screen.findByText(/Extension requests \(1 waiting\)/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(screen.getByLabelText('New check-out date *')).toHaveValue('2099-01-08')
    fireEvent.change(screen.getByLabelText('New check-out date *'), { target: { value: '2099-01-07' } })
    fireEvent.change(screen.getByLabelText('Extra charge added to rent (₹)'), { target: { value: '2400' } })
    fireEvent.change(screen.getByLabelText('Rent status *'), { target: { value: 'partially_paid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Extend stay' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('extend_stay', {
      p_guest: 9, p_until: '2099-01-07', p_charge: 2400, p_status: 'partially_paid', p_note: '', p_request: 3 }))
  })
  it('extends a checked-out guest and explains they come back', async () => {
    const done = vi.fn()
    db.rpcs.extend_stay = { data: null }
    at(<ExtendStay guest={{ id: 5, name: 'Ravi', room_no: 'A-102', checked_out_on: '2099-01-04', rent: 2400 }} onClose={vi.fn()} onDone={done} />)
    expect(screen.getByText(/Extending brings them back as a current guest/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('New check-out date *'), { target: { value: '2099-01-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Extend stay' }))
    await waitFor(() => expect(done).toHaveBeenCalled())
  })
})
