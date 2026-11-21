import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

import { asRole, setAuth } from './helpers/authMock.js'
import { db, resetMock, supabase } from './helpers/supabaseMock.js'
import App from '../src/App'
import ManagerDashboard from '../src/pages/staff/ManagerDashboard'
import { homeFor } from '../src/components/Navbar'

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const go = (route) => render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)

beforeEach(() => {
  resetMock()
  setAuth()
  document.head.innerHTML = ''
  db.tables.rooms = { data: [], error: null }
  db.tables.attendance = { data: null, error: null }
  db.rpcs.owner_dashboard = { data: {
    beds: { total: 10, occupied: 7, vacant: 3, reserved: 0, occupancy_pct: 70 },
    money: { collected: 50000, pending: 12000, overdue: 4000 },
    complaints: { open: 2, overdue: 1 },
    upcoming_checkins: [{ date: day(2), name: 'Ravi Kumar', bed: '101-A' }, { date: day(20), name: 'Later Guest', bed: '102-B' }],
    upcoming_checkouts: [{ date: day(3), name: 'Meera Shah', room: '103', customer_id: 'c1' }],
  }, error: null }
})

describe('/staff picks a page by role and designation', () => {
  it('a manager lands on the manager page', async () => {
    asRole('manager')
    go('/staff')
    expect(await screen.findByRole('heading', { level: 1, name: 'Manager' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Guest register' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab')[0]).toHaveAccessibleName('Guest register')
  })
  it('a caretaker lands on the caretaker page', async () => {
    asRole('employee')
    db.tables.staff_members = { data: { id: 's1', full_name: 'Test User', designation: 'caretaker', property_id: 'P1' }, error: null }
    db.tables.employee_permissions = { data: {}, error: null }
    go('/staff')
    expect(await screen.findByRole('heading', { level: 1, name: 'Caretaker' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'My complaints' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Customers and dues' })).not.toBeInTheDocument()
  })
  it('other employees keep the general staff dashboard', async () => {
    asRole('employee')
    db.tables.staff_members = { data: { id: 's2', designation: 'cook' }, error: null }
    db.tables.employee_permissions = { data: {}, error: null }
    go('/staff')
    expect(await screen.findByRole('heading', { level: 1, name: 'Staff dashboard' })).toBeInTheDocument()
  })
  it('an employee cannot open the manager page', async () => {
    asRole('employee')
    go('/staff/manager')
    expect(await screen.findByText('Your account (employee) cannot open this area.')).toBeInTheDocument()
  })
  it('a manager cannot open the caretaker page', async () => {
    asRole('manager')
    go('/staff/caretaker')
    expect(await screen.findByText('Your account (manager) cannot open this area.')).toBeInTheDocument()
  })
  it('the Dashboard link sends a manager to their page', () => {
    expect(homeFor('manager')).toBe('/staff/manager')
  })
})

describe('Manager page', () => {
  const open = () => {
    asRole('manager')
    return render(<MemoryRouter><ManagerDashboard /></MemoryRouter>)
  }

  it('shows beds, rent and only this week’s arrivals and departures', async () => {
    open()
    await userEvent.click(screen.getByRole('tab', { name: 'Today' }))
    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument()
    expect(screen.getByText('Meera Shah')).toBeInTheDocument()
    expect(screen.queryByText('Later Guest')).not.toBeInTheDocument()
    expect(screen.getByText('of 10 beds')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Full console' })).toHaveAttribute('href', '/admin')
  })
  it('Team shows who has checked in and lets the manager approve leave', async () => {
    db.tables.staff_members = { data: [
      { id: 's1', full_name: 'Anil Caretaker', designation: 'caretaker', phone: '9000000001' },
      { id: 's2', full_name: 'Sunita Caretaker', designation: 'caretaker', phone: '' },
    ], error: null }
    db.tables.attendance = { data: [{ staff_id: 's2', status: 'leave' }], error: null }
    db.tables.leave_requests = { data: [{ id: 'l1', staff_id: 's1', leave_type: 'casual', from_date: day(1), to_date: day(1), days: 1, reason: 'Family' }], error: null }
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'Team' }))
    expect(await screen.findByText('Sunita Caretaker')).toBeInTheDocument()
    expect(screen.getByText('Leave')).toBeInTheDocument()
    expect(screen.getByText('Not marked yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Call 9000000001' })).toHaveAttribute('href', 'tel:9000000001')
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(supabase.rpc).toHaveBeenCalledWith('decide_leave', { p_id: 'l1', p_approve: true })
  })
  it('Complaints lists only open tickets', async () => {
    db.tables.complaints = { data: [
      { id: 'c1', ticket_no: 11, title: 'Tap leaking', category: 'plumbing', status: 'assigned', priority: 'high', rooms: { room_no: '101' }, due_at: '2026-11-22T10:00:00Z' },
      { id: 'c2', ticket_no: 12, title: 'Old fan issue', category: 'electrical', status: 'closed', priority: 'low', rooms: { room_no: '102' } },
    ], error: null }
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'Complaints' }))
    expect(await screen.findByText('Tap leaking')).toBeInTheDocument()
    expect(screen.queryByText('Old fan issue')).not.toBeInTheDocument()
    expect(screen.getByText('Open complaints (1)')).toBeInTheDocument()
  })
})
