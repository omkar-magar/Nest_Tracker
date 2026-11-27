// Coupons: managers make and share them; guests apply a code on the registration payment.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
import { asRole } from './helpers/authMock'
import { db, resetMock, supabase } from './helpers/supabaseMock'
import Coupons from '../src/components/manage/Coupons'
import RegistrationPay from '../src/components/register/RegistrationPay'
import { ScopeProvider } from '../src/components/manage/kit'
import { couponMessage } from '../src/services/coupons'
import App from '../src/App'
import ManagerDashboard from '../src/pages/staff/ManagerDashboard'

const scoped = (page) => render(<MemoryRouter><ScopeProvider properties={[{ id: 'P1', name: 'A wing', wing: 'A' }]} initial="P1">{page}</ScopeProvider></MemoryRouter>)
beforeEach(() => resetMock())

describe('manager coupons', () => {
  beforeEach(() => asRole('manager'))
  it('lists coupons with who made them and shares them on WhatsApp', async () => {
    db.rpcs.coupons_list = { data: [{ code: 'LEAD10', kind: 'percent', value: 10, property_id: 'P1', phone: '9800000000', enquiry_name: 'Asha',
      used_count: 0, max_uses: 1, is_active: true, created_by_name: 'Priya', description: '10% off' }] }
    scoped(<Coupons />)
    expect(await screen.findByText('LEAD10')).toBeInTheDocument()
    expect(screen.getByText(/for enquiry Asha · used 0 of 1 · by Priya/)).toBeInTheDocument()
    const share = screen.getByRole('link', { name: 'Share on WhatsApp' })
    expect(share.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919800000000\?text=.*LEAD10/)
  })
  it('creates a coupon for a wing', async () => {
    db.rpcs.coupons_list = { data: [] }
    db.rpcs.create_coupon = { data: 'WELCOME500' }
    scoped(<Coupons />)
    fireEvent.click(await screen.findByRole('button', { name: 'New coupon' }))
    fireEvent.change(screen.getByLabelText('Amount off (₹) *'), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText('Code (leave empty to make one)'), { target: { value: 'welcome500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create coupon' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('create_coupon', { p: expect.objectContaining({ code: 'welcome500', kind: 'flat', value: '500', property_id: 'P1' }) }))
  })
  it('writes a share message with the offer and the sign-up link', () => {
    expect(couponMessage({ code: 'WELCOME500', kind: 'flat', value: 500 }, { name: 'Asha', site: 'https://x.test' }))
      .toBe('Hi Asha, here is an exclusive YOLO Nest offer: ₹500 off. Use code WELCOME500 when you pay for your registration. Register here: https://x.test/signup')
  })
})

describe('guest applies a coupon', () => {
  const reg = { state: 'pending', approval: 'pending', stay_type: 'pg', payment_mode: 'online', payment_status: 'waiting', amount_due: 14000, amount_paid: 0, discount: 0, to_pay: 14000 }
  it('sends the code and shows the discount', async () => {
    asRole('customer')
    db.rpcs.apply_registration_coupon = { data: { code: 'LEAD10', discount: 1400, to_pay: 12600 } }
    const changed = vi.fn()
    const { rerender } = render(<RegistrationPay registration={reg} onChanged={changed} />)
    fireEvent.change(screen.getByLabelText('Coupon code'), { target: { value: ' lead10 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(changed).toHaveBeenCalled())
    expect(supabase.rpc).toHaveBeenCalledWith('apply_registration_coupon', { p_code: 'lead10' })
    rerender(<RegistrationPay registration={{ ...reg, coupon_code: 'LEAD10', discount: 1400, to_pay: 12600 }} onChanged={changed} />)
    expect(screen.getByText('−₹1,400')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay ₹12,600 (demo success)' })).toBeInTheDocument()
  })
  it('shows why a code does not work', async () => {
    db.rpcs.apply_registration_coupon = { error: { message: 'This coupon is for another mobile number' } }
    render(<RegistrationPay registration={reg} onChanged={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Coupon code'), { target: { value: 'LEAD10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('another mobile number')
  })
})

describe('coupons tab', () => {
  const wings = () => {
    db.tables.properties = { data: [{ id: 'P1', name: 'A wing' }, { id: 'P2', name: 'B wing' }], error: null }
    db.tables.property_members = { data: [{ property_id: 'P2', is_default: true }], error: null }
    db.rpcs.coupons_list = { data: [] }
  }
  const openConsole = (role, path = '/admin') => {
    asRole(role)
    wings()
    return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  }
  it('is in the console menu for the owner and managers, not for sales', async () => {
    for (const role of ['admin', 'manager']) {
      const { unmount } = openConsole(role)
      const nav = await screen.findByRole('navigation', { name: 'Modules' })
      expect(within(nav).getByRole('link', { name: 'Coupons' })).toHaveAttribute('href', '/admin/coupons')
      unmount()
    }
    openConsole('sales')
    const nav = await screen.findByRole('navigation', { name: 'Modules' })
    expect(within(nav).queryByRole('link', { name: 'Coupons' })).not.toBeInTheDocument()
  })
  it('opens on its own page in the console and is closed to sales', async () => {
    const { unmount } = openConsole('manager', '/admin/coupons')
    expect(await screen.findByRole('button', { name: 'New coupon' })).toBeInTheDocument()
    unmount()
    openConsole('sales', '/admin/coupons')
    expect(await screen.findByText('Your account (sales) cannot open this area.')).toBeInTheDocument()
  })
  it('is a tab on the manager page, with the wings to choose from', async () => {
    asRole('manager')
    wings()
    db.rpcs.create_coupon = { data: 'B500' }
    render(<MemoryRouter><ManagerDashboard /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Coupons' }))
    fireEvent.click(await screen.findByRole('button', { name: 'New coupon' }))
    expect(screen.getByRole('option', { name: 'B wing' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Amount off (₹) *'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create coupon' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('create_coupon', { p: expect.objectContaining({ value: '500', property_id: 'P2' }) }))
  })
})
