import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

import { asRole, setAuth } from './helpers/authMock.js'
import { db, resetMock, supabase } from './helpers/supabaseMock.js'
import GuestRegister from '../src/components/register/GuestRegister'
import ManagerDashboard from '../src/pages/staff/ManagerDashboard'
import { roomUse } from '../src/components/dashboard/RoomsBoard'
import { buildPlan, clean, guideText, leavingSoon, parseImport, roomKey, roomSummary, toDate } from '../src/services/register'
import { ymd } from '../src/services/pg'

const guest = (id, room_no, name, extra = {}) => ({
  id, property_id: 'P1', room_no, sort_order: id, name, contact: '', rent: 5500, deposit: 5500,
  rent_status: 'not_updated', deposit_status: 'not_updated', check_in: null, expected_checkout: null, notes: '', ...extra,
})
const GUESTS = [
  guest(1, '101', 'Rahul Sinha', { contact: '9876543210', rent_status: 'paid' }),
  guest(2, '101', 'Amit Rao'),
  guest(3, '101', 'Third Bed'),
  guest(4, '102', 'Neha Joshi', { rent: 12000, rent_status: 'pending' }),
]
const ROOMS = ['101', '102', '103'].map((room_no) => ({ room_no, floor: 1 }))

describe('room counts follow the head count', () => {
  it('counts PG rooms with their people, rented rooms and empty rooms', () => {
    const s = roomSummary(GUESTS, ROOMS)
    expect(s).toMatchObject({ totalRooms: 3, people: 4, occupiedRooms: 2, pgRooms: 1, pgPeople: 3, rentedRooms: 1, emptyRooms: 1, rentPending: 1 })
    expect(s.rooms.map((r) => r.kind)).toEqual(['pg', 'rented', 'empty'])
  })
  it('turns a rented room into a PG room when a second guest is added', () => {
    expect(roomSummary([GUESTS[3]], ROOMS).rooms[1].kind).toBe('rented')
    expect(roomSummary([GUESTS[3], guest(9, '102', 'New')], ROOMS).rooms[1]).toMatchObject({ kind: 'pg', people: 2 })
  })
  it('does not count an unnamed placeholder as a person, and adds rooms only found in the register', () => {
    const s = roomSummary([guest(5, '103', ''), guest(6, '201', 'Someone')], ROOMS)
    expect(s.rooms.find((r) => r.room_no === '103').kind).toBe('empty')
    expect(s.rooms.find((r) => r.room_no === '201')).toMatchObject({ floor: 2, kind: 'rented' })
  })
  it('splits the bed board into PG and rented rooms', () => {
    const beds = (n, taken) => Array.from({ length: n }, (_, i) => ({ id: `${n}${i}`, is_occupied: i < taken }))
    expect(roomUse([
      { rent_basis: 'bed', beds: beds(3, 2) }, { rent_basis: 'bed', beds: beds(2, 0) }, { rent_basis: 'room', beds: beds(2, 2) },
    ])).toEqual({ pgRooms: 1, pgPeople: 2, rentedRooms: 1, rentedPeople: 2 })
  })
})

describe('values', () => {
  it('reads Indian and ISO dates, money with symbols, and status labels', () => {
    expect(toDate('05/11/2026')).toBe('2026-11-05')
    expect(toDate('2026-11-05T10:00:00Z')).toBe('2026-11-05')
    expect(toDate('soon')).toBeNull()
    expect(clean({ rent: '₹5,500', deposit: '', rent_status: 'Partially Paid', check_in: '', name: ' A ' }))
      .toEqual({ rent: 5500, deposit: null, rent_status: 'partially_paid', check_in: null, name: 'A' })
  })
  it('flags guests leaving within 7 days', () => {
    expect(leavingSoon({ expected_checkout: '2026-11-25' }, 7, '2026-11-21')).toBe(true)
    expect(leavingSoon({ expected_checkout: '2026-12-25' }, 7, '2026-11-21')).toBe(false)
    expect(leavingSoon({ expected_checkout: null }, 7, '2026-11-21')).toBe(false)
  })
})

describe('change links', () => {
  const roomNos = ROOMS.map((r) => r.room_no)
  it('builds the ops from the old link format too (flat, "Paid", delete)', () => {
    const plan = buildPlan([
      { op: 'update', match: { flat: '101', name: 'rahul sinha' }, set: { rent_status: 'Pending' } },
      { op: 'add', flat: '103', name: 'New Guest', contact: '9876500000', rent: '6000', rent_status: 'Paid' },
      { op: 'delete', match: { room_no: '102', name: 'Neha Joshi' } },
    ], GUESTS, roomNos, '2026-11-21')
    expect(plan.items.every((i) => i.ok)).toBe(true)
    expect(plan.ops).toEqual([
      { op: 'update', id: 1, set: { rent_status: 'pending' } },
      { op: 'add', set: { room_no: '103', name: 'New Guest', contact: '9876500000', rent: 6000, rent_status: 'paid' } },
      { op: 'checkout', id: 4, date: '2026-11-21', note: '' },
    ])
    expect(plan.items[2].text).toBe('Check out Neha Joshi (room 102) on 2026-11-21')
  })
  it('skips items it cannot place, with the reason', () => {
    const plan = buildPlan([
      { op: 'update', match: { room_no: '101' }, set: { notes: 'x' } },
      { op: 'add', set: { room_no: '999', name: 'X' } },
      { op: 'update', match: { name: 'Rahul' }, set: { rent_status: 'paid' } },
      { op: 'update', match: { name: 'Neha' }, set: { payment: 'Paid' } },
    ], GUESTS, roomNos)
    expect(plan.ops).toEqual([])
    expect(plan.items.map((i) => i.err)).toEqual([
      expect.stringMatching(/3 guests match/), 'Unknown room "999"', 'Already set, no change', expect.stringMatching(/rent_status/)])
  })
  it('writes a guide with the link base and the room list', () => {
    const t = guideText('https://x.test/staff/manager', roomNos)
    expect(t).toContain('https://x.test/staff/manager?changes=')
    expect(t).toContain('room_no must be one of: 101, 102, 103')
  })
})

describe('import from the old page', () => {
  it('maps the backup, skips duplicates and blanks, and offers deleted guests as past guests', () => {
    const backup = {
      guests: [
        { flat: '101', type: 'PG (Bed Wise)', name: 'Rahul Sinha', contact: '9876543210', rent: '5500', deposit: '5,500', rent_status: 'Paid', deposit_status: 'Pending', notes: '' },
        { flat: '102', type: 'Rented Flat', name: 'Old Format', contact: '12345', rent: 'monthly 8k', payment: 'Partially Paid' },
        { flat: '103', type: 'Empty', name: '', contact: '' },
        { flat: '', name: 'No Room' },
      ],
      history: [
        { op: 'DELETE', changed_at: '2026-09-14T08:00:00Z', old_row: { flat: '104', name: 'Gone Guest', rent: '5000' } },
        { op: 'UPDATE', changed_at: '2026-09-15T08:00:00Z', old_row: { flat: '101', name: 'x' }, new_row: {} },
      ],
    }
    const out = parseImport(backup, [{ room_no: '101', name: 'RAHUL SINHA' }])
    expect(out.skipped).toEqual(['Row 1: Rahul Sinha (room 101) is already in the register', 'Row 4: no room'])
    expect(out.ops).toEqual([{ op: 'add', set: expect.objectContaining({
      room_no: '102', name: 'Old Format', contact: '', rent: null, rent_status: 'partially_paid', deposit_status: 'partially_paid',
      notes: 'Rent: monthly 8k · Contact: 12345',
    }) }])
    expect(out.past).toEqual([{ op: 'add', set: expect.objectContaining({ room_no: '104', name: 'Gone Guest', rent: 5000, checked_out_on: '2026-09-14' }) }])
  })
  it('reads CSV rows with the export headers', () => {
    const out = parseImport([{ room: '201', guest: 'Csv Guest', rent_: '7000', check_in: '01/10/2026', expected_check_out: '31/12/2026' }])
    expect(out.ops[0].set).toMatchObject({ room_no: '201', name: 'Csv Guest', rent: 7000, check_in: '2026-10-01', expected_checkout: '2026-12-31' })
  })
})

const show = (ui, route = '/staff/manager') => render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>)

beforeEach(() => {
  resetMock()
  setAuth()
  localStorage.clear()
  db.tables.properties = { data: [{ id: 'P1', name: 'Yolo Nest' }], error: null }
  db.rpcs.my_property_ids = { data: ['P1'], error: null }
  db.tables.rooms = { data: ROOMS, error: null }
  db.tables.register_guests = { data: GUESTS, error: null }
})

describe('guest register screen', () => {
  it('shows the PG / rented split and each room with its head count', async () => {
    asRole('manager')
    show(<GuestRegister />)
    await userEvent.click(await screen.findByRole('button', { name: 'By room' }))
    expect(await screen.findByText('PG · 3 people')).toBeInTheDocument()
    expect(screen.getByText('Rented · 1 person')).toBeInTheDocument()
    expect(screen.getByText('Empty')).toBeInTheDocument()
    expect(screen.getByText('Rooms occupied').nextSibling).toHaveTextContent('2/3')
    expect(screen.getByText('3 people sharing')).toBeInTheDocument()
  })

  it('asks for a check-out date (today by default) instead of deleting', async () => {
    asRole('manager')
    const user = userEvent.setup()
    show(<GuestRegister />)
    const row = (await screen.findByText('Neha Joshi')).closest('tr')
    expect(within(row).queryByRole('button', { name: 'Check out' })).not.toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Show details, Neha Joshi' }))
    await user.click(screen.getByRole('button', { name: 'Check out' }))
    const dialog = screen.getByRole('dialog', { name: 'Check out Neha Joshi' })
    expect(within(dialog).getByLabelText('Check-out date *')).toHaveValue(ymd())
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Deposit returned')
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('register_checkout', { p_id: 4, p_date: ymd(), p_note: 'Deposit returned' }))
    await waitFor(() => expect(screen.queryByText('Neha Joshi')).not.toBeInTheDocument())
    expect(screen.getByText('Rented rooms', { selector: 'p' }).nextSibling).toHaveTextContent('0')
  })

  it('lists every guest as a table row, with the room cards as the other view', async () => {
    asRole('manager')
    const user = userEvent.setup()
    show(<GuestRegister />)
    const table = await screen.findByRole('table', { name: 'Guest register' })
    expect(within(table).getByRole('columnheader', { name: 'Expected check-out' })).toBeInTheDocument()
    const rahul = within(table).getByText('Rahul Sinha').closest('tr')
    expect(rahul).toHaveTextContent('9876543210')
    expect(within(rahul).getByText('Paid')).toBeInTheDocument()
    expect(within(table).getByText('PG · 3')).toBeInTheDocument()
    expect(within(table).queryByText('No guest')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Room type'), 'empty')
    expect(within(screen.getByRole('table', { name: 'Guest register' })).getByText('No guest')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Room type'), '')
    await user.click(screen.getByRole('button', { name: 'By room' }))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Room 101' })).toBeInTheDocument()
    expect(localStorage.getItem('yolo.register.view')).toBe('rooms')
    await user.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByRole('table', { name: 'Guest register' })).toBeInTheDocument()
  })

  it('keeps list rows short and edits the rest under Details', async () => {
    asRole('manager')
    const user = userEvent.setup()
    show(<GuestRegister />)
    const table = await screen.findByRole('table', { name: 'Guest register' })
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(['Sr', 'Room', 'Type', 'Guest', 'Contact', 'Rent status', 'Check-in', 'Expected check-out', 'Details'])
    expect(within(table).queryByRole('button', { name: /Add guest to room/ })).not.toBeInTheDocument()
    expect(within(table).queryByLabelText('Deposit (₹)')).not.toBeInTheDocument()
    const toggle = within(table).getByRole('button', { name: 'Show details, Amit Rao' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const deposit = within(table).getByLabelText('Deposit (₹)')
    expect(deposit).toHaveValue(5500)
    await user.clear(deposit)
    await user.type(deposit, '6000')
    await user.tab()
    await waitFor(() => expect(supabase.from).toHaveBeenCalledWith('register_guests'))
    expect(await within(table).findByText('Saved')).toBeInTheDocument()
    await user.click(within(table).getByRole('button', { name: 'Hide details, Amit Rao' }))
    expect(within(table).queryByLabelText('Deposit (₹)')).not.toBeInTheDocument()
  })

  it('filters by rent status', async () => {
    asRole('manager')
    const user = userEvent.setup()
    show(<GuestRegister />)
    await screen.findByText('Rahul Sinha')
    await user.selectOptions(screen.getByLabelText('Rent status'), 'pending')
    expect(screen.getByText('Showing 1 of 4 entries')).toBeInTheDocument()
    expect(screen.queryByText('Rahul Sinha')).not.toBeInTheDocument()
  })

  it('is read-only for a caretaker', async () => {
    asRole('employee')
    show(<GuestRegister />)
    await screen.findByText('Rahul Sinha')
    expect(screen.queryByRole('button', { name: '+ Add guest' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Change history' })).not.toBeInTheDocument()
  })

  it('opens a change link on the register tab and applies it only after review', async () => {
    asRole('manager')
    const user = userEvent.setup()
    const changes = encodeURIComponent(JSON.stringify([{ op: 'update', match: { room_no: '101', name: 'Amit Rao' }, set: { rent_status: 'paid' } }]))
    show(<ManagerDashboard />, `/staff/manager?changes=${changes}`)
    const dialog = await screen.findByRole('dialog', { name: 'Review changes from link' })
    expect(screen.getByRole('tab', { name: 'Guest register' })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByText(/rent status not_updated → paid/)).toBeInTheDocument()
    expect(supabase.rpc).not.toHaveBeenCalledWith('register_apply', expect.anything())
    await user.click(within(dialog).getByRole('button', { name: 'Apply 1 change' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('register_apply',
      { p_property: 'P1', p_ops: [{ op: 'update', id: 2, set: { rent_status: 'paid' } }], p_import: false }))
    expect(await screen.findByText('1 change applied from link.')).toBeInTheDocument()
  })
})

describe('buildings with wings', () => {
  it('names rooms by wing and reads the floor from the number', () => {
    expect(roomKey({ wing: 'A', room_no: '101' })).toBe('A-101')
    expect(roomKey({ wing: null, room_no: '101' })).toBe('101')
    const s = roomSummary([guest(1, 'A-101', 'X'), guest(2, 'B-101', 'Y'), guest(3, 'B-101', 'Z')], [])
    expect(s.rooms.map((r) => [r.room_no, r.floor, r.kind])).toEqual([['A-101', 1, 'rented'], ['B-101', 1, 'pg']])
  })
  it('imports old room numbers into the chosen wing', () => {
    const out = parseImport({ guests: [{ flat: '305', name: 'Wing Guest' }], history: [{ op: 'DELETE', changed_at: '2026-11-18T00:00:00Z', old_row: { flat: '101', name: 'Gone' } }] },
      [{ room_no: 'A-305', name: 'Other' }], { wing: 'A' })
    expect(out.ops[0].set.room_no).toBe('A-305')
    expect(out.past[0].set.room_no).toBe('A-101')
  })
})
