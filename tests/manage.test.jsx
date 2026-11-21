// PG-management UI and helpers. The rules themselves are tested against Postgres in tests/db (npm run test:db).
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))

const { db, resetMock, supabase } = await import('./helpers/supabaseMock.js')
const { asRole } = await import('./helpers/authMock.js')
const pg = await import('../src/services/pg')
const { toCSV, parseCSV, xlsxBlob } = await import('../src/services/exporters')
const { validateTenant } = await import('../src/components/manage/tenantFields')
const { default: ManageLayout } = await import('../src/pages/manage/ManageLayout')
const { default: Beds } = await import('../src/pages/manage/Beds')
const { default: PayModal } = await import('../src/components/PayModal')
const { default: VisitForm } = await import('../src/components/VisitForm')
const { default: DataTable } = await import('../src/components/manage/DataTable')
const { summarize, billLabel } = await import('../src/services/billing')

beforeEach(() => resetMock())
afterEach(() => vi.restoreAllMocks())

describe('pure helpers', () => {
  it('derives bed status in the same order as the database', () => {
    expect(pg.bedState({ is_active: false, is_occupied: true })).toBe('inactive')
    expect(pg.bedState({ is_occupied: true, is_reserved: true })).toBe('occupied')
    expect(pg.bedState({ is_reserved: true, status: 'maintenance' })).toBe('reserved')
    expect(pg.bedState({ status: 'blocked' })).toBe('maintenance')
    expect(pg.bedState({ status: 'available' })).toBe('vacant')
  })
  it('labels invoices pending / part paid / overdue / paid', () => {
    expect(pg.invoiceState({ status: 'unpaid', due_date: '2999-01-01', amount_paid: 0 })).toBe('pending')
    expect(pg.invoiceState({ status: 'unpaid', due_date: '2999-01-01', amount_paid: 10 })).toBe('partially_paid')
    expect(pg.invoiceState({ status: 'unpaid', due_date: '2000-01-01' })).toBe('overdue')
    expect(pg.invoiceState({ status: 'paid' })).toBe('paid')
    expect(pg.owed({ status: 'unpaid', amount: 7000, amount_paid: 3000 })).toBe(4000)
  })
  it('buckets overdue days for ageing', () => {
    expect([0, 7, 8, 15, 16, 30, 31].map(pg.ageingBucket)).toEqual(['0-7', '0-7', '8-15', '8-15', '16-30', '16-30', '30+'])
  })
  it('only ever shows the last four ID characters', () => {
    expect(pg.lastFour('1234 5678 9012')).toBe('9012')
    expect(pg.maskId('9012')).toBe('XXXX-XXXX-9012')
  })
  it('allows only valid complaint moves for each role', () => {
    expect(pg.complaintMoves('new', { manage: true })).toEqual(['assigned', 'in_progress', 'resolved', 'closed'])
    expect(pg.complaintMoves('assigned', { staff: true })).toEqual(['in_progress', 'resolved'])
    expect(pg.complaintMoves('resolved', { tenant: true })).toEqual(['closed', 'reopen'])
    expect(pg.complaintMoves('in_progress', { tenant: true })).toEqual([])
  })
  it('scores leads hot / warm / cold by move-in date', () => {
    const today = new Date(2026, 10, 21)
    expect(pg.leadTemperature('2026-11-25', today)).toBe('hot')
    expect(pg.leadTemperature('2026-12-15', today)).toBe('warm')
    expect(pg.leadTemperature('2027-03-01', today)).toBe('cold')
    expect(pg.leadTemperature('', today)).toBe('warm')
  })
  it('builds a WhatsApp vacancy message from live beds only', () => {
    const rooms = [
      { room_no: '101', ac_type: 'AC', room_type: 'double', price: 7500, billing_period: 'month', beds: [{ status: 'available' }, { is_occupied: true }] },
      { room_no: '102', ac_type: 'AC', room_type: 'double', price: 7000, billing_period: 'month', beds: [{ is_reserved: true }] },
    ]
    const msg = pg.vacancyMessage(rooms, { brandName: 'YOLO Nest', phone: '1', url: 'u' })
    expect(msg).toContain('Room 101')
    expect(msg).toContain('1 bed free')
    expect(msg).not.toContain('Room 102')
    expect(pg.vacancyMessage([rooms[1]], { brandName: 'YOLO Nest', phone: '1', url: 'u' })).toContain('full')
  })
  it('needs an emergency contact to save a tenant', () => {
    expect(validateTenant({ full_name: 'A', phone: '9876543210' })).toMatch(/emergency contact/)
    expect(validateTenant({ full_name: 'A', phone: '98765', emergency1_name: 'B', emergency1_phone: '9811111111' })).toMatch(/mobile/)
    expect(validateTenant({ full_name: 'A', phone: '9876543210', emergency1_name: 'B', emergency1_phone: '9811111111' })).toBe('')
  })
  it('counts part payments in the tenant summary', () => {
    const bills = [{ id: 'a', status: 'unpaid', amount: 7000, amount_paid: 3000, due_date: '2999-01-01' }]
    expect(summarize(bills, []).outstanding).toBe(4000)
    expect(billLabel(bills[0])).toBe('Part paid')
  })
})

describe('exports and imports', () => {
  const cols = [{ key: 'name', label: 'Name' }, { key: 'amt', label: 'Amount', value: (r) => r.amt * 2 }]
  it('writes CSV with quoting', () => {
    expect(toCSV([{ name: 'Ravi, "R"', amt: 5 }], cols)).toBe('Name,Amount\r\n"Ravi, ""R""",10')
  })
  it('reads CSV with quotes, commas, BOM and blank lines', () => {
    const rows = parseCSV('﻿Name,Phone Number\r\n"Rao, Asha",98765 43210\r\n\r\nKiran,9123456780\n')
    expect(rows).toEqual([{ name: 'Rao, Asha', phone_number: '98765 43210' }, { name: 'Kiran', phone_number: '9123456780' }])
  })
  it('builds a real .xlsx (zip) file', async () => {
    const blob = xlsxBlob('Dues', [{ name: 'Ravi', amt: 5 }], cols)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])           // PK zip header
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('xl/worksheets/sheet1.xml')
    expect(text).toContain('<v>10</v>')
    expect(text).toContain('Ravi')
  })
  it('DataTable searches, sorts and offers CSV / Excel / PDF', async () => {
    render(<DataTable title="T" rows={[{ id: 1, n: 'Beta', v: 2 }, { id: 2, n: 'Alpha', v: 1 }]} columns={[{ key: 'n', label: 'Name' }, { key: 'v', label: 'Value' }]} />)
    for (const b of ['CSV', 'Excel', 'PDF']) expect(screen.getByRole('button', { name: b })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Name' }))
    const rows = screen.getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(rows[0]).toContain('Alpha')
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'bet')
    expect(screen.getAllByRole('row')).toHaveLength(2)
  })
})

describe('management console', () => {
  const at = (role, path = '/admin') => {
    asRole(role)
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/admin" element={<ManageLayout />}><Route index element={<p>home</p>} /></Route></Routes>
      </MemoryRouter>,
    )
  }
  it('shows every module to the owner', async () => {
    at('admin')
    const nav = await screen.findByRole('navigation', { name: 'Modules' })
    for (const m of ['Dashboard', 'Beds', 'Tenants', 'Rent & payments', 'Expenses', 'Complaints', 'Enquiries', 'Marketing & sales', 'Employees', 'Reports', 'Settings & users']) {
      expect(within(nav).getByRole('link', { name: m })).toBeInTheDocument()
    }
    expect(screen.getByRole('heading', { name: 'Admin dashboard' })).toBeInTheDocument()
  })
  it('gives a sales executive only beds, enquiries and sales', async () => {
    at('sales')
    const nav = await screen.findByRole('navigation', { name: 'Modules' })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Beds', 'Enquiries', 'Marketing & sales'])
  })
  it('hides owner-only settings from a manager and nudges the timed jobs', async () => {
    at('manager')
    const nav = await screen.findByRole('navigation', { name: 'Modules' })
    expect(within(nav).queryByRole('link', { name: 'Settings & users' })).not.toBeInTheDocument()
    expect(supabase.rpc).toHaveBeenCalledWith('run_scheduled_jobs', { p_force: false })
  })
})

describe('bed map', () => {
  it('colour-codes beds and opens a bed for allocation or reservation', async () => {
    asRole('admin')
    db.tables.rooms = { data: [{ id: 'r1', property_id: 'P1', room_no: '101', floor: 1, room_type: 'double', ac_type: 'AC', is_active: true, price: 7000, deposit: 7000, billing_period: 'month',
      beds: [{ id: 'b1', code: 'P1-F1-R101-B1', label: 'A', status: 'available', is_active: true }, { id: 'b2', code: 'P1-F1-R101-B2', label: 'B', status: 'available', is_occupied: true, is_active: true }] }] }
    db.tables.reservations = { data: [] }
    db.tables.booking_beds = { data: [{ bed_id: 'b2', bookings: { customer_id: 'c1', rate: 7000, check_in: '2026-11-01', profiles: { full_name: 'Ravi' } } }] }
    render(<MemoryRouter><Beds /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: /Bed P1-F1-R101-B2: Occupied, Ravi/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vacant: 1' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Bed P1-F1-R101-B1: Vacant/ }))
    const dialog = screen.getByRole('dialog', { name: 'Bed P1-F1-R101-B1' })
    expect(within(dialog).getByRole('button', { name: 'Allocate / check in' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reserve' }))
    expect(within(dialog).getByLabelText(/Hold until/)).toBeInTheDocument()
  })
})

describe('part payments', () => {
  it('pays only the part entered and says the rest is still due', async () => {
    db.rpcs.payment_create_order = { data: 'pay1', error: null }
    db.tables.payments = { data: { id: 'pay1', status: 'succeeded', is_simulated: true }, error: null }
    render(<PayModal bill={{ id: 'b1', amount: 7000, amount_paid: 1000, description: 'Rent' }} onClose={() => {}} onFinished={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Pay ₹6,000' })).toBeInTheDocument()
    const input = screen.getByLabelText(/Amount to pay now/)
    await userEvent.clear(input)
    await userEvent.type(input, '2500')
    await userEvent.click(screen.getByRole('button', { name: 'Simulate successful payment' }))
    expect(supabase.rpc).toHaveBeenCalledWith('payment_create_order', { p_bill_id: 'b1', p_provider: 'demo', p_amount: 2500 })
    expect(await screen.findByText(/rest of this bill is still due/)).toBeInTheDocument()
  })
  it('will not pay more than is owed', async () => {
    render(<PayModal bill={{ id: 'b1', amount: 7000, amount_paid: 1000, description: 'Rent' }} onClose={() => {}} onFinished={() => {}} />)
    const input = screen.getByLabelText(/Amount to pay now/)
    await userEvent.clear(input)
    await userEvent.type(input, '6001')
    expect(screen.getByRole('button', { name: 'Simulate successful payment' })).toBeDisabled()
  })
})

describe('website enquiry capture', () => {
  it('saves the visit request as an enquiry when a mobile number is given', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    sessionStorage.setItem('yolo.campaign', 'INSTA-NOV')
    const { container } = render(<VisitForm />)
    await userEvent.type(screen.getByLabelText('Your name'), 'Asha')
    await userEvent.type(screen.getByLabelText('Mobile number (optional)'), '9876543210')
    await userEvent.type(container.querySelector('input[type="date"]'), '2030-12-05')
    await userEvent.selectOptions(screen.getByLabelText('Preferred time'), screen.getAllByRole('option').find((o) => o.textContent.includes('AM')).textContent)
    await userEvent.click(screen.getByRole('button', { name: 'Request visit on WhatsApp' }))
    expect(supabase.rpc).toHaveBeenCalledWith('submit_enquiry', { p: expect.objectContaining({ name: 'Asha', phone: '9876543210', source: 'website', campaign_code: 'INSTA-NOV' }) })
    sessionStorage.clear()
  })
})
