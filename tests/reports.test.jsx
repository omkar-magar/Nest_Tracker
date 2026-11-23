// Admin screens that count the guest register as well as app bookings: bed board, reports, room-wise rent, search.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))

const { db, resetMock, supabase, queryFor, opArgs } = await import('./helpers/supabaseMock.js')
const { asRole } = await import('./helpers/authMock.js')
const pg = await import('../src/services/pg')
const rep = await import('../src/services/reports')
const { guestsByRoom, searchGuests } = await import('../src/services/register')
const { default: Beds } = await import('../src/pages/manage/Beds')
const { default: Reports } = await import('../src/pages/manage/Reports')
const { default: Tenants } = await import('../src/pages/manage/Tenants')
const { ScopeProvider } = await import('../src/components/manage/kit')

beforeEach(() => resetMock())
afterEach(() => vi.restoreAllMocks())

const guest = (over) => ({ id: 1, property_id: 'P1', room_no: 'A-101', name: 'Asha', rent: 8000, rent_status: 'paid', ...over })

describe('register helpers', () => {
  it('groups named guests by wing and room', () => {
    const by = guestsByRoom([guest(), guest({ id: 2, name: '  ' }), guest({ id: 3, name: 'Bala', property_id: 'P2' })])
    expect(Object.keys(by)).toEqual(['P1|A-101', 'P2|A-101'])
    expect(by['P1|A-101'].map((g) => g.name)).toEqual(['Asha'])
  })

  it('leaves register-occupied space out of the vacancy message', () => {
    const room = { room_no: '101', ac_type: 'AC', room_type: 'double', price: 7000, billing_period: 'month', beds: [{ status: 'available' }, { status: 'available' }] }
    const opts = { brandName: 'YOLO Nest', phone: '1', url: 'u' }
    expect(pg.vacancyMessage([room], opts)).toContain('2 beds free')
    expect(pg.vacancyMessage([room], { ...opts, taken: () => 1 })).toContain('1 bed free')
    expect(pg.vacancyMessage([room], { ...opts, taken: () => 3 })).toContain('full')
  })

  it('counts months back to a start date, capped at 36', () => {
    const today = new Date(2026, 10, 24)
    expect(rep.monthsSince('2026-11-01', today)).toBe(1)
    expect(rep.monthsSince('2026-01-01', today)).toBe(11)
    expect(rep.monthsSince('2020-01-01', today)).toBe(36)
  })

  it('adds register rent to P&L rows, per wing and in the combined row', () => {
    const rows = [
      { month: '2026-11-01', property_id: 'P1', rent: 1500, charges: 0, late_fees: 0, deposits_kept: 0, other_income: 0, total_income: 1500, utilities: 0, salaries: 0,
        maintenance: 0, food: 0, other_expense: 200, total_expense: 200, profit: 1300 },
      { month: '2026-11-01', property_id: 'ALL', rent: 1500, total_income: 1500, total_expense: 200, profit: 1300 },
    ]
    const out = rep.withRegisterPL(rows, {
      P1: [{ month: '2026-10-01', amount: 0 }, { month: '2026-11-01', amount: 5000 }],
      P2: [{ month: '2026-11-01', amount: 3000 }, { month: '2025-01-01', amount: 99 }],
    }, '2026-01-01', '2026-11-24')
    expect(out.map((r) => r.property_id)).toEqual(['P1', 'P2', 'ALL'])
    expect(out[0]).toMatchObject({ rent: 6500, register_rent: 5000, total_income: 6500, profit: 6300 })
    expect(out[1]).toMatchObject({ rent: 3000, total_income: 3000, total_expense: 0, profit: 3000 })
    expect(out[2]).toMatchObject({ rent: 9500, register_rent: 8000, total_income: 9500, total_expense: 200, profit: 9300 })
  })

  it('adds register rent to trend revenue and profit', () => {
    const out = rep.withRegisterTrends([{ month: '2026-11-01', revenue: 1500, expenses: 500, profit: 1000, occupancy_pct: 0 }], [{ month: '2026-11-01', amount: 4000 }])
    expect(out[0]).toMatchObject({ revenue: 5500, register_rent: 4000, profit: 5000 })
  })

  it('puts register guests on occupancy rows by room', () => {
    const out = rep.withRegisterOccupancy([{ room_id: 'r1' }, { room_id: 'r2' }],
      [{ id: 'r1', property_id: 'P1', wing: 'A', room_no: '101' }, { id: 'r2', property_id: 'P1', wing: 'A', room_no: '102' }],
      [guest(), guest({ id: 2, name: 'Chitra' })])
    expect(out.map((r) => r.register_guests)).toEqual([2, 0])
  })

  it('works out room-wise rent from app bills and register guests', () => {
    const rooms = [{ id: 'r1', property_id: 'P1', wing: 'A', room_no: '101', price: 8000, beds: [{ is_active: true }, { is_active: true }] },
      { id: 'r2', property_id: 'P1', wing: 'A', room_no: '102', price: 8000, beds: [{ is_active: true }] }]
    const bills = [{ room_id: 'r1', kind: 'rent', tenant: 'Ravi', billed: 1500, collected: 1000, outstanding: 500 }, { room_id: 'r1', kind: 'deposit', billed: 9000, collected: 0, outstanding: 9000 }]
    const [r1, r2] = rep.roomRent(rooms, bills, [guest(), guest({ id: 2, name: 'Dev', rent: 7000, rent_status: 'pending' }), guest({ id: 3, name: 'Esha', rent: 6000, rent_status: 'not_updated' })])
    expect(r1).toMatchObject({ room: 'P1 · A-101', beds: 2, tenants: 'Ravi, Asha, Dev, Esha', expected: 22500, collected: 9000, due: 7500, unknown: 1 })
    expect(r2).toMatchObject({ tenants: '', expected: 0, due: 0 })
  })

  it('builds the wing report with a grand total row', () => {
    const rows = rep.registerReportRows({ totals: { guests: 3 }, properties: [{ id: 'P1', name: 'A wing', guests: 2 }, { id: 'P2', name: 'B wing', guests: 1 }] })
    expect(rows.map((r) => [r.wing, r.guests])).toEqual([['A wing', 2], ['B wing', 1], ['All wings (total)', 3]])
    expect(rep.registerReportRows({ totals: {}, properties: [{ id: 'P1', name: 'A wing' }] })).toHaveLength(1)
  })

  it('searches staying guests and keeps or() syntax out of the text', async () => {
    await searchGuests('Asha, (x)*', 'P1')
    const q = queryFor('register_guests').at(-1)
    expect(opArgs(q, 'or')[0]).toBe('name.ilike.*Asha x*,contact.ilike.*Asha x*,room_no.ilike.*Asha x*')
    expect(opArgs(q, 'eq')).toEqual(['property_id', 'P1'])
    expect(await searchGuests(' , ')).toEqual([])
  })
})

describe('bed board with the guest register', () => {
  it('shows register guests on their room and keeps them out of shared vacancies', async () => {
    asRole('admin')
    db.tables.rooms = { data: [{ id: 'r1', property_id: 'P1', wing: 'A', room_no: '101', floor: 1, room_type: 'double', ac_type: 'AC', is_active: true, price: 7000, deposit: 7000, billing_period: 'month',
      beds: [{ id: 'b1', code: 'B1', label: 'A', status: 'available', is_active: true }, { id: 'b2', code: 'B2', label: 'B', status: 'available', is_active: true }] }] }
    db.tables.reservations = { data: [] }
    db.tables.booking_beds = { data: [] }
    db.tables.register_guests = { data: [guest(), guest({ id: 2, name: 'Zoya', room_no: 'A-999' })] }
    render(<MemoryRouter><Beds /></MemoryRouter>)
    expect(await screen.findByText('In register: 1 of 2 beds')).toBeInTheDocument()
    expect(screen.getByText(/2 guests staying in 1 room \(1 in rooms not on this board\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Share vacancies' }))
    expect(within(screen.getByRole('dialog')).getByText(/Room 101 .*: 1 bed free/)).toBeInTheDocument()
  })

  it('does not ask for the register for sales logins', async () => {
    asRole('sales')
    db.tables.rooms = { data: [] }
    render(<MemoryRouter><Beds /></MemoryRouter>)
    await screen.findByText(/No rooms yet/)
    expect(queryFor('register_guests')).toHaveLength(0)
  })
})

describe('reports', () => {
  it('adds register rent to profit & loss', async () => {
    asRole('admin')
    db.rpcs.report_profit_loss = { data: [], error: null }
    db.rpcs.register_rent_paid = { data: { months: [{ month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`, amount: 52000 }] }, error: null }
    render(<MemoryRouter><ScopeProvider properties={[{ id: 'P1', name: 'A wing' }]}><Reports /></ScopeProvider></MemoryRouter>)
    await userEvent.selectOptions(screen.getByLabelText('Report'), 'pl')
    const table = await screen.findByRole('table')
    expect(within(table).getAllByText('₹52,000').length).toBeGreaterThan(0)
    expect(screen.getByText(/includes rent marked paid in the guest register/)).toBeInTheDocument()
  })

  it('has a guest register report by wing', async () => {
    asRole('admin')
    db.rpcs.register_summary = { data: { totals: {}, properties: [{ id: 'P1', name: 'YOLO Nest A wing', guests: 58, rooms_occupied: 29, rooms_total: 30, rent_roll: 556139 }] }, error: null }
    render(<MemoryRouter><Reports /></MemoryRouter>)
    await userEvent.selectOptions(screen.getByLabelText('Report'), 'register')
    expect(await screen.findByText('YOLO Nest A wing')).toBeInTheDocument()
    expect(screen.getByText('₹5,56,139')).toBeInTheDocument()
    expect(supabase.rpc).toHaveBeenCalledWith('register_summary', { p_property: null })
  })
})

describe('tenant search', () => {
  it('also lists matching guests from the register, linked to their wing', async () => {
    asRole('admin')
    db.tables.profiles = { data: [] }
    db.tables.register_guests = { data: [guest({ property_id: 'P2', room_no: 'B-204', name: 'Mahendra', rent_status: 'pending' })] }
    render(
      <MemoryRouter initialEntries={['/admin/tenants?q=Mahe']}>
        <Routes><Route path="/admin/tenants" element={<Tenants />} /></Routes>
      </MemoryRouter>,
    )
    const link = await screen.findByRole('link', { name: /Mahendra · P2 · Room B-204 · rent Pending/ })
    expect(link).toHaveAttribute('href', '/admin/register?wing=P2&q=Mahendra')
  })
})
