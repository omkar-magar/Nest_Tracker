// Enquiries: not approached / approached tabs, budget filter, sorting and sending a coupon from the list.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
import { asRole } from './helpers/authMock'
import { db, resetMock, supabase } from './helpers/supabaseMock'
import Enquiries, { isApproached } from '../src/pages/manage/Enquiries'
import { ScopeProvider } from '../src/components/manage/kit'

const enquiry = (id, name, extra = {}) => ({ id, name, phone: '98000000' + id, property_id: 'P1', status: 'new', source: 'website', temperature: 'warm',
  received_at: `2026-11-${10 + Number(id)}T10:00:00Z`, budget: null, ...extra })
const page = () => render(<MemoryRouter><ScopeProvider properties={[{ id: 'P1', name: 'A wing', wing: 'A' }]} initial="P1"><Enquiries /></ScopeProvider></MemoryRouter>)
const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1].textContent)

beforeEach(() => {
  resetMock()
  asRole('manager')
  db.tables.enquiries = { data: [
    enquiry('11', 'Asha', { budget: 9000 }),
    enquiry('12', 'Ravi', { budget: 6000 }),
    enquiry('13', 'Neha', { budget: 7500, received_at: '2026-11-01T09:00:00Z' }),
    enquiry('14', 'Kiran', { status: 'contacted', approached_at: '2026-11-25T10:00:00Z' }),
    enquiry('15', 'Sita', { coupon_code: 'LEAD10' }),
  ] }
  db.tables.profiles = { data: [] }
  db.tables.follow_ups = { data: [] }
})

describe('enquiries', () => {
  it('splits not approached from approached (called, messaged or sent a coupon)', async () => {
    expect(isApproached({ status: 'new' })).toBe(false)
    expect(isApproached({ status: 'new', coupon_code: 'X' })).toBe(true)
    page()
    expect(await screen.findByRole('tab', { name: 'Not approached (3)' })).toBeInTheDocument()
    expect(names()).toEqual(['Ravi', 'Asha', 'Neha'])
    fireEvent.click(screen.getByRole('tab', { name: 'Approached (2)' }))
    expect(names().sort()).toEqual(['Kiran', 'Sita'])
    expect(screen.getByText('LEAD10')).toBeInTheDocument()
  })
  it('sorts by budget and by date and time, and filters a budget range', async () => {
    page()
    await screen.findByRole('tab', { name: 'Not approached (3)' })
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'budget_high' } })
    expect(names()).toEqual(['Asha', 'Neha', 'Ravi'])
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'oldest' } })
    expect(names()).toEqual(['Neha', 'Asha', 'Ravi'])
    fireEvent.change(screen.getByLabelText('Budget from'), { target: { value: '7000' } })
    fireEvent.change(screen.getByLabelText('Budget to'), { target: { value: '8000' } })
    expect(names()).toEqual(['Neha'])
  })
  it('sends a coupon from the list and offers to share it on WhatsApp', async () => {
    db.rpcs.create_coupon = { data: 'YNABC123' }
    page()
    await screen.findByRole('tab', { name: 'Not approached (3)' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Send coupon' })[0])
    fireEvent.change(screen.getByLabelText('Amount off (₹) *'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create coupon' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('create_coupon', { p: expect.objectContaining({ enquiry_id: '12', value: '500' }) }))
    const share = await screen.findByRole('link', { name: 'Send on WhatsApp' })
    expect(share.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919800000012\?text=Hi%20Ravi.*YNABC123/)
  })
  it('hides coupons from the sales team', async () => {
    asRole('sales')
    page()
    await screen.findByRole('tab', { name: 'Not approached (3)' })
    expect(screen.queryByRole('tab', { name: 'Coupons' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send coupon' })).not.toBeInTheDocument()
  })
})

describe('calling from the list', () => {
  it('logs the call so the enquiry moves to Approached', async () => {
    page()
    const row = (await screen.findByText('Ravi')).closest('tr')
    const call = within(row).getByRole('link', { name: 'Call' })
    expect(call).toHaveAttribute('href', 'tel:+919800000012')
    call.addEventListener('click', (ev) => ev.preventDefault()) // do not follow tel: in the test
    fireEvent.click(call)
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('log_lead_activity', expect.objectContaining({ p_enquiry: '12', p_kind: 'call' })))
  })
})
