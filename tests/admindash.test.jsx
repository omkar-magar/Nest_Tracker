// Admin dashboard: the grouping / sorting helpers and the page drawn from mocked RPCs and tables.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))

const { db, resetMock, supabase } = await import('./helpers/supabaseMock.js')
const { asRole } = await import('./helpers/authMock.js')
const dash = await import('../src/services/dashboard')
const { default: Dashboard } = await import('../src/pages/manage/Dashboard')
const { default: ManageLayout } = await import('../src/pages/manage/ManageLayout')

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dash.ymd(d) }
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString()

describe('dashboard helpers', () => {
  it('works out % change, and none without a previous month', () => {
    expect(dash.pctChange(108, 100)).toBe(8)
    expect(dash.pctChange(95, 100)).toBe(-5)
    expect(dash.pctChange(50, 0)).toBeNull()
  })
  it('groups approved expenses in a fixed order with percentages', () => {
    const b = dash.expenseBreakdown([
      { grp: 'utilities', amount: 3000, status: 'approved' }, { grp: 'salaries', amount: 1000, status: 'approved' },
      { grp: 'food', amount: 9999, status: 'pending' },
    ])
    expect(b.total).toBe(4000)
    expect(b.groups.map((g) => [g.grp, g.pct, g.slot])).toEqual([
      ['utilities', 75, 1], ['salaries', 25, 2], ['maintenance', 0, 3], ['food', 0, 4], ['other', 0, 5]])
  })
  it('finds the next due date of a monthly bill', () => {
    const today = new Date(2026, 10, 22)
    expect(dash.nextDue(22, today)).toBe('2026-11-22')
    expect(dash.nextDue(25, today)).toBe('2026-11-25')
    expect(dash.nextDue(5, today)).toBe('2026-12-05')
  })
  it('sorts bills by due date and adds unpaid salaries', () => {
    const today = new Date(2026, 10, 22)
    const bills = dash.upcomingBills([
      { id: 'a', amount: 1200, day_of_month: 27, expense_categories: { name: 'Internet / Wi-Fi', grp: 'utilities' } },
      { id: 'b', amount: 1000, day_of_month: 22, expense_categories: { name: 'Water', grp: 'utilities' } },
    ], [{ net: 8000 }, { net: 7000 }], today)
    expect(bills.map((x) => [x.name, x.days, x.amount])).toEqual([['Staff salary', null, 15000], ['Water', 0, 1000], ['Internet / Wi-Fi', 5, 1200]])
  })
  it('merges activity newest first and says how long ago', () => {
    const list = dash.recentActivities({
      payments: [{ amount: 8000, completed_at: hoursAgo(2), profiles: { full_name: 'Rahul' } }],
      checkins: [{ check_in: day(-1), rooms: { room_no: '204' }, profiles: { full_name: 'Amit' } }],
      checkouts: [], complaints: [{ title: 'Tap leaking', created_at: hoursAgo(5), profiles: { full_name: 'Sagar' }, rooms: { room_no: '105' } }],
    })
    expect(list.map((a) => a.kind)).toEqual(['payment', 'complaint', 'checkin'])
    expect(list[0].text).toBe('Rahul paid ₹8,000')
    expect(dash.ago(list[0].at)).toBe('2 hours ago')
    expect(dash.ago(day(-1))).toBe('Yesterday')
  })
  it('counts tenants who owe rent and those already late', () => {
    expect(dash.rentDue([{ customer_id: 'a', days_overdue: 3 }, { customer_id: 'a', days_overdue: 0 }, { customer_id: 'b', days_overdue: 0 }]))
      .toEqual({ tenants: 2, overdueTenants: 1 })
  })
})

describe('admin dashboard page', () => {
  beforeEach(() => {
    resetMock()
    asRole('admin', { profile: { id: 'u1', full_name: 'Omkar Magar', role: 'admin', is_active: true } })
    db.rpcs.owner_dashboard = { data: {
      beds: { total: 50, occupied: 42, vacant: 8, reserved: 0, maintenance: 0, occupancy_pct: 84 },
      money: { collected: 185000, expenses: 62000, pending: 18000, overdue: 6000 },
      complaints: { open: 4, overdue: 0 },
      properties: [{ id: 'P1', name: 'A wing', beds: 50, occupied: 42, occupancy_pct: 84, revenue: 185000, expenses: 62000, profit: 123000, pending: 18000, complaints_open: 4 }],
      upcoming_checkins: [], upcoming_checkouts: [{ date: day(3), name: 'Meera', room: '103', customer_id: 'c1' }, { date: day(30), name: 'Later', room: '104', customer_id: 'c2' }],
    }, error: null }
    db.rpcs.report_trends = { data: [
      { month: '2026-10-01', revenue: 171000, expenses: 59000, occupancy_pct: 82 },
      { month: '2026-11-01', revenue: 185000, expenses: 62000, occupancy_pct: 84 },
    ], error: null }
    db.rpcs.report_expenses = { data: [{ grp: 'utilities', amount: 21700, status: 'approved' }, { grp: 'salaries', amount: 40300, status: 'approved' }], error: null }
    db.rpcs.report_outstanding = { data: [{ customer_id: 'a', days_overdue: 4 }, { customer_id: 'b', days_overdue: 0 }, { customer_id: 'c', days_overdue: 1 }], error: null }
    db.tables.recurring_expenses = { data: [{ id: 'r1', amount: 1000, day_of_month: new Date().getDate() > 28 ? 1 : new Date().getDate(), vendor: 'Tanker', expense_categories: { name: 'Water', grp: 'utilities' } }], error: null }
    db.tables.payslips = { data: [], error: null }
    db.tables.payments = { data: [{ id: 'p1', amount: 8000, completed_at: hoursAgo(2), profiles: { full_name: 'Rahul' } }], error: null }
    db.tables.bookings = { data: [], error: null }
    db.tables.complaints = { data: [], error: null }
  })

  const open = () => render(<MemoryRouter><Dashboard /></MemoryRouter>)

  it('shows the KPI cards with change vs last month', async () => {
    open()
    expect(screen.getByRole('heading', { name: 'Welcome back, Omkar!' })).toBeInTheDocument()
    const kpi = within(await screen.findByRole('region', { name: 'Key figures' }))
    expect(kpi.getByText('₹1,85,000')).toBeInTheDocument()
    expect(kpi.getByText('₹1,23,000')).toBeInTheDocument()
    expect(kpi.getByText('₹18,000')).toBeInTheDocument()
    expect(kpi.getByText('3 tenants · ₹6,000 overdue')).toBeInTheDocument()
    expect(screen.getByText('↑ 8%', { exact: false })).toBeInTheDocument()
    expect(supabase.rpc).toHaveBeenCalledWith('report_trends', { p_property: null, p_months: 6 })
  })
  it('names the foreign key wherever a table links to profiles more than once', async () => {
    open()
    await screen.findByRole('region', { name: 'Key figures' })
    // payments, bookings and complaints each have several links to profiles; a bare profiles(...) embed is rejected
    const selects = supabase.from.mock.calls.map(([t], i) => [t, supabase.from.mock.results[i]])
    expect(selects.map(([t]) => t)).toEqual(expect.arrayContaining(['payments', 'bookings', 'complaints']))
    for (const q of db.queries.filter((x) => ['payments', 'bookings', 'complaints'].includes(x.table))) {
      const select = q.ops.find(([m]) => m === 'select')[1][0]
      expect(select).not.toMatch(/(^|[ ,])profiles\(/)
    }
  })
  it('shows the expense breakdown, alerts, occupancy, activity and bills', async () => {
    open()
    const pie = await screen.findByRole('region', { name: 'Expense breakdown' })
    expect(within(pie).getByText('Staff & salaries')).toBeInTheDocument()
    expect(within(pie).getByText('65%')).toBeInTheDocument()
    const alerts = screen.getByRole('region', { name: 'Quick alerts' })
    expect(within(alerts).getByRole('link', { name: /Overdue rent.*2 tenants/ })).toHaveAttribute('href', '/admin/billing')
    expect(within(alerts).getByText('1 tenant in 7 days')).toBeInTheDocument()
    expect(within(alerts).getByText('4 requests')).toBeInTheDocument()
    expect(screen.getByText('84%')).toBeInTheDocument()
    expect(screen.getByText('+2 pts ↑ vs last month')).toBeInTheDocument()
    expect(screen.getByText('Rahul paid ₹8,000')).toBeInTheDocument()
    const bills = screen.getByRole('region', { name: 'Upcoming bills and payments' })
    expect(within(bills).getByText('Water')).toBeInTheDocument()
    expect(within(bills).getByText(/Due today|Due in/)).toBeInTheDocument()
  })
  it('has the quick actions and still shows the wing table', async () => {
    open()
    const actions = await screen.findByRole('navigation', { name: 'Quick actions' })
    expect(within(actions).getByRole('link', { name: 'Raise maintenance' })).toHaveAttribute('href', '/admin/complaints?new=1')
    expect(within(actions).getByRole('link', { name: 'Add tenant' })).toHaveAttribute('href', '/admin/tenants?new=1')
    expect(screen.getByRole('heading', { name: 'Wing by wing' })).toBeInTheDocument()
  })
  it('switching to last month loads that month’s expenses', async () => {
    open()
    await screen.findByRole('region', { name: 'Key figures' })
    await userEvent.selectOptions(screen.getByLabelText('Period'), 'Last month')
    expect(within(await screen.findByRole('region', { name: 'Key figures' })).getByText('₹1,71,000')).toBeInTheDocument()
    const { from } = dash.monthRange(-1)
    expect(supabase.rpc).toHaveBeenCalledWith('report_expenses', expect.objectContaining({ p_from: from }))
  })
})

describe('header search', () => {
  it('opens Tenants with the search filled in', async () => {
    resetMock()
    asRole('admin')
    const Where = () => <p>at {useLocation().pathname}{useLocation().search}</p>
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes><Route path="/admin" element={<ManageLayout />}><Route index element={<p>home</p>} /><Route path="tenants" element={<Where />} /></Route></Routes>
      </MemoryRouter>,
    )
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search tenants, rooms' }), 'room 204{enter}')
    expect(await screen.findByText('at /admin/tenants?q=room%20204')).toBeInTheDocument()
  })
})
