import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

import { asRole, setAuth } from './helpers/authMock.js'
import { db, opArgs, queryFor, resetMock, storageBucket, supabase } from './helpers/supabaseMock.js'
import Account from '../src/pages/Account'
import StaffDashboard from '../src/pages/staff/StaffDashboard'
import AdminDashboard from '../src/pages/admin/AdminDashboard'

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const stat = (label) => screen.getByText(label, { selector: 'p' }).nextElementSibling.textContent

let confirmSpy
beforeEach(() => {
  resetMock()
  setAuth()
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

// =================================================================== Account (customer dashboard)
describe('Account page', () => {
  const booking = (over = {}) => ({
    id: 'bk1', status: 'pending', check_in: '2026-11-10', check_out: null, rate: 7500, billing_period: 'month',
    hold_expires_at: '2026-11-05T18:30:00Z', rooms: { room_no: '101', floor: 1, ac_type: 'AC' },
    booking_beds: [{ active: true, beds: { label: 'A' } }, { active: false, beds: { label: 'B' } }], ...over,
  })
  const bill = (over = {}) => ({ id: 'b1', description: 'Rent Nov', amount: 7500, status: 'unpaid', due_date: day(5), ...over })

  function seed({ bookings = [booking()], bills = [bill()], payments = [], documents = [], review = null } = {}) {
    db.tables.bookings = { data: bookings, error: null }
    db.tables.bills = { data: bills, error: null }
    db.tables.payments = { data: payments, error: null }
    db.tables.customer_documents = { data: documents, error: null }
    db.tables.reviews = { data: review, error: null }
  }
  const open = (state) => {
    asRole('customer')
    return render(<MemoryRouter initialEntries={[{ pathname: '/account', state }]}><Account /></MemoryRouter>)
  }

  it('greets the customer by name', async () => {
    seed()
    open()
    expect(await screen.findByRole('heading', { level: 1, name: 'Hi Test User' })).toBeInTheDocument()
  })
  it('shows a confirmation after booking', async () => {
    seed()
    open({ justBooked: true })
    expect(await screen.findByText(/Your beds are reserved/)).toBeInTheDocument()
  })
  it('shows an error box with retry when data cannot be loaded', async () => {
    seed()
    db.tables.bills = { data: null, error: new Error('bills failed') }
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent('bills failed')
  })

  describe('summary', () => {
    it('totals paid and outstanding and shows the next bill', async () => {
      seed({
        bills: [bill({ id: 'x', amount: 500, due_date: day(9) }), bill({ id: 'y', amount: 300, due_date: day(2) }), bill({ id: 'z', status: 'paid', amount: 999 })],
        payments: [
          { id: 'p1', amount: 4000, status: 'succeeded', provider: 'demo', is_simulated: true, created_at: '2026-10-01T10:00:00Z', bills: { description: 'Rent Oct' } },
          { id: 'p2', amount: 700, status: 'failed', provider: 'demo', is_simulated: true, created_at: '2026-10-02T10:00:00Z', bills: { description: 'Rent Oct' } },
        ],
      })
      open()
      await screen.findByText('Amount paid')
      expect(stat('Amount paid')).toBe('₹4,000')
      expect(stat('Outstanding')).toBe('₹800')
      expect(stat('Next bill')).toBe('₹300')
    })
    it('flags overdue bills in red with a count', async () => {
      seed({ bills: [bill({ due_date: day(-4) })] })
      open()
      await screen.findByText('Amount paid')
      expect(screen.getByText('1 overdue')).toBeInTheDocument()
      expect(screen.getByText('4 days late')).toBeInTheDocument()
      expect(screen.getByText('Overdue', { selector: 'span' })).toBeInTheDocument()
    })
    it('shows dashes when there is nothing to pay', async () => {
      seed({ bills: [] })
      open()
      await screen.findByText('Amount paid')
      expect(stat('Next bill')).toBe('—')
      expect(stat('Next due date')).toBe('—')
      expect(screen.getByText('No bills yet')).toBeInTheDocument()
      expect(screen.getByText('No payments yet')).toBeInTheDocument()
    })
  })

  describe('current booking', () => {
    it('shows the room, bed and hold expiry for a pending booking', async () => {
      seed()
      open()
      expect(await screen.findByText('Room 101 · Floor 1')).toBeInTheDocument()
      expect(screen.getByText('AC · Bed A')).toBeInTheDocument() // inactive bed B is hidden
      expect(screen.getByText(/Beds held until/)).toBeInTheDocument()
      expect(screen.getByText('pending')).toBeInTheDocument()
    })
    it('an active booking has no hold notice and no cancel button', async () => {
      seed({ bookings: [booking({ status: 'active', hold_expires_at: null })] })
      open()
      await screen.findByText('Room 101 · Floor 1')
      expect(screen.queryByText(/Beds held until/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument()
    })
    it('with no booking, points to the Rooms page', async () => {
      seed({ bookings: [] })
      open()
      expect(await screen.findByText('No current booking')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Rooms page' })).toHaveAttribute('href', '/rooms')
    })
    it('cancelling asks for confirmation, then calls cancel_booking', async () => {
      seed()
      open()
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }))
      expect(confirmSpy).toHaveBeenCalled()
      expect(supabase.rpc).toHaveBeenCalledWith('cancel_booking', { p_booking_id: 'bk1' })
    })
    it('does nothing when the customer declines the confirmation', async () => {
      confirmSpy.mockReturnValue(false)
      seed()
      open()
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }))
      expect(supabase.rpc).not.toHaveBeenCalled()
    })
    it('shows the error if cancelling fails', async () => {
      db.rpcs.cancel_booking = { data: null, error: new Error('Already paid') }
      seed()
      open()
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Already paid')
    })
    it('past bookings appear in the history table', async () => {
      seed({ bookings: [booking(), booking({ id: 'old', status: 'completed', check_in: '2026-01-01', check_out: '2026-02-01', rooms: { room_no: '202', floor: 2, ac_type: 'AC' } })] })
      open()
      expect(await screen.findByRole('heading', { name: 'Booking history' })).toBeInTheDocument()
      expect(screen.getByText('Room 202')).toBeInTheDocument()
      expect(screen.getByText('completed')).toBeInTheDocument()
    })
  })

  describe('paying', () => {
    it('"Pay next bill" opens the payment dialog for the earliest unpaid bill', async () => {
      seed({ bills: [bill({ id: 'late', description: 'Later bill', amount: 900, due_date: day(20) }), bill({ id: 'soon', description: 'Sooner bill', amount: 600, due_date: day(1) })] })
      open()
      await userEvent.click(await screen.findByRole('button', { name: 'Pay next bill · ₹600' }))
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: 'Pay ₹600' })).toBeInTheDocument()
      expect(within(dialog).getByText('Sooner bill')).toBeInTheDocument()
    })
    it('each unpaid bill has its own Pay button; paid bills do not', async () => {
      seed({ bills: [bill({ id: 'a', description: 'Unpaid one', amount: 111 }), bill({ id: 'b', description: 'Paid one', status: 'paid', amount: 222 })] })
      open()
      await screen.findByText('Unpaid one')
      expect(screen.getAllByRole('button', { name: 'Pay' })).toHaveLength(1)
      await userEvent.click(screen.getByRole('button', { name: 'Pay' }))
      expect(screen.getByRole('heading', { name: 'Pay ₹111' })).toBeInTheDocument()
    })
    it('the dialog can be cancelled', async () => {
      seed()
      open()
      await userEvent.click(await screen.findByRole('button', { name: /Pay next bill/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    it('labels demo payments in the history', async () => {
      seed({ payments: [{ id: 'p1', amount: 7500, status: 'succeeded', provider: 'demo', is_simulated: true, created_at: '2026-10-01T10:00:00Z', bills: { description: 'Rent Oct' } }] })
      open()
      expect(await screen.findByText('Demo (simulated)')).toBeInTheDocument()
      expect(screen.getByText('succeeded')).toBeInTheDocument()
    })
  })

  describe('documents', () => {
    const doc = { id: 'd1', doc_type: 'id_proof', file_name: 'aadhaar.pdf', file_path: 'u1/aadhaar.pdf' }

    it('shows an empty message with no documents', async () => {
      seed()
      open()
      expect(await screen.findByText('No documents uploaded yet.')).toBeInTheDocument()
    })
    it('lists uploaded documents with their type', async () => {
      seed({ documents: [doc] })
      open()
      expect(await screen.findByText('aadhaar.pdf', { exact: false })).toBeInTheDocument()
      expect(screen.getAllByText('ID proof').length).toBeGreaterThan(0)
    })
    it('only accepts images and PDFs', async () => {
      seed()
      open()
      const input = (await screen.findByLabelText('Upload file'))
      expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,application/pdf')
    })
    it('uploads the chosen file with the chosen type, linked to the current booking', async () => {
      seed()
      open()
      await userEvent.selectOptions(await screen.findByLabelText('Document type'), 'address_proof')
      await userEvent.upload(screen.getByLabelText('Upload file'), new File(['x'], 'bill.pdf', { type: 'application/pdf' }))
      await waitFor(() => expect(storageBucket.upload).toHaveBeenCalled())
      expect(storageBucket.upload.mock.calls[0][0]).toMatch(/^u1\/\d+-bill\.pdf$/)
      await waitFor(() => expect(queryFor('customer_documents').some((q) => opArgs(q, 'insert'))).toBe(true))
      const insert = queryFor('customer_documents').find((q) => opArgs(q, 'insert'))
      expect(opArgs(insert, 'insert')[0]).toMatchObject({ doc_type: 'address_proof', booking_id: 'bk1', file_name: 'bill.pdf' })
    })
    it('shows the error if the upload is rejected', async () => {
      storageBucket.upload.mockResolvedValueOnce({ data: null, error: new Error('File too large') })
      seed()
      open()
      await userEvent.upload(await screen.findByLabelText('Upload file'), new File(['x'], 'big.pdf', { type: 'application/pdf' }))
      expect(await screen.findByText('File too large')).toBeInTheDocument()
    })
    it('View opens a short-lived signed link in a new tab', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      seed({ documents: [doc] })
      open()
      await userEvent.click(await screen.findByRole('button', { name: 'View' }))
      await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://signed.example/file', '_blank', 'noopener'))
      expect(storageBucket.createSignedUrl).toHaveBeenCalledWith('u1/aadhaar.pdf', 60)
    })
    it('Delete confirms, then removes the row and the stored file', async () => {
      seed({ documents: [doc] })
      open()
      await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
      expect(confirmSpy).toHaveBeenCalledWith('Delete aadhaar.pdf?')
      await waitFor(() => expect(storageBucket.remove).toHaveBeenCalledWith(['u1/aadhaar.pdf']))
    })
    it('Delete does nothing when declined', async () => {
      confirmSpy.mockReturnValue(false)
      seed({ documents: [doc] })
      open()
      await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
      expect(storageBucket.remove).not.toHaveBeenCalled()
    })
  })

  describe('reviews', () => {
    it('cannot be left before a stay has started', async () => {
      seed({ bookings: [booking({ status: 'pending' })] })
      open()
      expect(await screen.findByText('You can leave a review once your stay has started.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Submit review' })).not.toBeInTheDocument()
    })
    it('active residents can submit a rating and text', async () => {
      seed({ bookings: [booking({ status: 'active' })] })
      open()
      await userEvent.selectOptions(await screen.findByLabelText('Rating'), '4')
      await userEvent.type(screen.getByLabelText('Your review'), 'Clean rooms and friendly staff')
      await userEvent.click(screen.getByRole('button', { name: 'Submit review' }))
      await waitFor(() => expect(queryFor('reviews').some((q) => opArgs(q, 'insert'))).toBe(true))
      const insert = queryFor('reviews').find((q) => opArgs(q, 'insert'))
      expect(opArgs(insert, 'insert')[0]).toEqual({ customer_id: 'u1', author_name: 'Test User', rating: 4, body: 'Clean rooms and friendly staff' })
    })
    it('requires at least 10 characters', async () => {
      seed({ bookings: [booking({ status: 'active' })] })
      open()
      expect(await screen.findByLabelText('Your review')).toHaveAttribute('minlength', '10')
    })
    it.each([
      ['pending', /appear once the owner approves it/],
      ['published', /It is live on the site/],
      ['rejected', /It was not published/],
    ])('an existing %s review shows its state instead of the form', async (status, text) => {
      seed({ bookings: [booking({ status: 'active' })], review: { id: 'r1', status } })
      open()
      expect(await screen.findByText(text)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Submit review' })).not.toBeInTheDocument()
    })
  })

  describe('profile', () => {
    it('is prefilled and saves with digits-only phone', async () => {
      seed()
      open()
      const name = await screen.findByLabelText('Full name')
      expect(name).toHaveValue('Test User')
      expect(screen.getByLabelText('Mobile number')).toHaveValue('9876543210')
      await userEvent.clear(name)
      await userEvent.type(name, '  Asha Rao ')
      const phone = screen.getByLabelText('Mobile number')
      await userEvent.clear(phone)
      await userEvent.type(phone, '+91 98765-00000')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByText('Saved')).toBeInTheDocument()
      const q = queryFor('profiles')[0]
      expect(opArgs(q, 'update')[0]).toEqual({ full_name: 'Asha Rao', phone: '919876500000' })
      expect(q.ops).toContainEqual(['eq', ['id', 'u1']])
    })
  })
})

// =================================================================== Staff dashboard
describe('Staff dashboard', () => {
  const rooms = [{ id: 'r1', room_no: '101', floor: 1, ac_type: 'AC', beds: [{ id: 'b1', label: 'A', status: 'available', is_occupied: false }] }]
  const overview = [{ customer_id: 1, full_name: 'Asha Rao', room_no: '101', beds: 'A', phone: '9876543210', next_due_date: day(-2), days_overdue: 2, next_due_amount: 7500, booking_status: 'active' }]

  beforeEach(() => {
    db.tables.rooms = { data: rooms, error: null }
    db.rpcs.staff_customer_overview = { data: overview, error: null }
  })
  const open = (role, perms) => {
    asRole(role)
    db.tables.employee_permissions = { data: perms, error: null }
    return render(<MemoryRouter><StaffDashboard /></MemoryRouter>)
  }

  it('shows the staff title, the employee name and a working Log out', async () => {
    const auth = asRole('employee')
    db.tables.employee_permissions = { data: {}, error: null }
    render(<MemoryRouter><StaffDashboard /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Staff dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Test User')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalled()
  })
  it('an employee without customer access only sees rooms, with an explanatory notice', async () => {
    open('employee', { can_view_customers: false, can_manage_beds: false })
    expect(await screen.findByRole('tab', { name: 'Rooms and beds' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Customers and dues' })).not.toBeInTheDocument()
    expect(screen.getByText(/Customer details are switched off for your account/)).toBeInTheDocument()
  })
  it('an employee with no permission row gets the same restricted view', async () => {
    open('employee', null)
    await screen.findByRole('tab', { name: 'Rooms and beds' })
    expect(screen.queryByRole('tab', { name: 'Customers and dues' })).not.toBeInTheDocument()
  })
  it('with customer access, the Customers tab shows dues', async () => {
    open('employee', { can_view_customers: true })
    await userEvent.click(await screen.findByRole('tab', { name: 'Customers and dues' }))
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('2 days overdue')).toBeInTheDocument()
    expect(screen.queryByText(/switched off/)).not.toBeInTheDocument()
  })
  it('the Customers tab shows an error box if the overview fails', async () => {
    db.rpcs.staff_customer_overview = { data: null, error: new Error('overview denied') }
    open('employee', { can_view_customers: true })
    await userEvent.click(await screen.findByRole('tab', { name: 'Customers and dues' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('overview denied')
  })
  it('bed maintenance toggles only appear with the manage-beds permission', async () => {
    const { unmount } = open('employee', { can_manage_beds: false })
    await screen.findByText(/1 rooms/)
    expect(screen.queryByTitle('Toggle maintenance')).not.toBeInTheDocument()
    unmount()
    open('employee', { can_manage_beds: true })
    expect(await screen.findByTitle('Toggle maintenance')).toBeInTheDocument()
  })
  it('an admin opening the staff area gets every tab and bed control regardless of the permission row', async () => {
    open('admin', null)
    expect(await screen.findByRole('tab', { name: 'Customers and dues' })).toBeInTheDocument()
    expect(await screen.findByTitle('Toggle maintenance')).toBeInTheDocument()
  })
  it('shows an error if permissions cannot be loaded', async () => {
    asRole('employee')
    db.tables.employee_permissions = { data: null, error: new Error('perm fail') }
    render(<MemoryRouter><StaffDashboard /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('perm fail')
  })
})

// =================================================================== Admin dashboard
describe('Admin dashboard', () => {
  const stats = {
    rooms: 6, beds: 13, beds_available: 9, beds_occupied: 3, beds_maintenance: 1, customers_current: 3, customers_total: 8, employees: 2,
    bookings_active: 3, bookings_pending: 1, bookings_total: 10, overdue_count: 2, overdue_amount: 15000, received: 120000, received_demo: 7500, pending_amount: 22000,
  }
  beforeEach(() => {
    asRole('admin')
    db.rpcs.admin_dashboard_stats = { data: stats, error: null }
  })
  const open = async (tab) => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    if (tab) await userEvent.click(screen.getByRole('tab', { name: tab }))
  }

  it('has a tab for every admin area, starting on Overview', async () => {
    await open()
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['Overview', 'Customers', 'Rooms', 'Payments', 'Dues', 'Employees', 'Reviews', 'Activity'])
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  })

  describe('Overview', () => {
    it('shows headline numbers', async () => {
      await open()
      await screen.findByText('Beds', { selector: 'p' })
      expect(stat('Rooms')).toBe('6')
      expect(stat('Beds')).toBe('13')
      expect(stat('Available beds')).toBe('9')
      expect(stat('Occupied beds')).toBe('3')
      expect(screen.getByText('1 under maintenance')).toBeInTheDocument()
      expect(screen.getByText('8 registered')).toBeInTheDocument()
      expect(stat('Overdue')).toBe('₹15,000')
    })
    it('keeps real and demo revenue separate', async () => {
      await open()
      const note = await screen.findByText(/Real payments received/)
      expect(note).toHaveTextContent('₹1,20,000')
      expect(note).toHaveTextContent('₹7,500')
      expect(note).toHaveTextContent('not counted as revenue')
    })
    it('shows an error if stats fail', async () => {
      db.rpcs.admin_dashboard_stats = { data: null, error: new Error('not admin') }
      await open()
      expect(await screen.findByRole('alert')).toHaveTextContent('not admin')
    })
  })

  describe('Customers', () => {
    const customer = {
      id: 'c1', full_name: 'Asha Rao', phone: '9876543210', is_active: true, created_at: '2026-09-01T00:00:00Z',
      bookings: [{ id: 'bk1', status: 'active', check_in: '2026-09-02', check_out: null, rooms: { room_no: '101' }, booking_beds: [] }],
      bills: [{ id: 'bl1', amount: 7500, status: 'unpaid', due_date: day(-3), description: 'Rent Nov' }, { id: 'bl2', amount: 5000, status: 'paid', due_date: '2026-10-01', description: 'Rent Oct' }],
      customer_documents: [{ id: 'd1', doc_type: 'id_proof', file_name: 'aadhaar.pdf', file_path: 'c1/aadhaar.pdf' }],
    }
    beforeEach(() => { db.tables.profiles = { data: [customer], error: null } })

    it('lists customers with room, booking status and outstanding amount', async () => {
      await open('Customers')
      const row = (await screen.findByText('Asha Rao')).closest('tr')
      expect(within(row).getByText('Room 101')).toBeInTheDocument()
      expect(within(row).getByText('active')).toBeInTheDocument()
      expect(within(row).getByText('₹7,500')).toBeInTheDocument()
      expect(within(row).getByRole('link', { name: 'WhatsApp' })).toBeInTheDocument()
    })
    it('shows an empty state with no customers', async () => {
      db.tables.profiles = { data: [], error: null }
      await open('Customers')
      expect(await screen.findByText('No customers yet')).toBeInTheDocument()
    })
    it('Details expands bookings, bills (with overdue flag) and documents, and can be hidden again', async () => {
      await open('Customers')
      const toggle = await screen.findByRole('button', { name: 'Details' })
      await userEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('Account active', { exact: false })).toBeInTheDocument()
      expect(screen.getByText('overdue')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'aadhaar.pdf' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Hide' }))
      expect(screen.queryByText('Account active', { exact: false })).not.toBeInTheDocument()
    })
    it('loads customers a page at a time with a Load more button', async () => {
      const page = Array.from({ length: 30 }, (_, i) => ({ ...customer, id: 'c' + i, full_name: 'Guest ' + i }))
      db.tables.profiles = { data: page, error: null }
      await open('Customers')
      await screen.findByText('Guest 0')
      expect(queryFor('profiles')[0].ops).toContainEqual(['range', [0, 29]])
      db.tables.profiles = { data: [{ ...customer, id: 'last', full_name: 'Last Guest' }], error: null }
      await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
      expect(await screen.findByText('Last Guest')).toBeInTheDocument()
      expect(screen.getByText('Guest 0')).toBeInTheDocument() // earlier pages stay
      expect(queryFor('profiles')[1].ops).toContainEqual(['range', [30, 59]])
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument() // short page = the end
    })
    it('has no Load more button when everything fits on one page', async () => {
      await open('Customers')
      await screen.findByText('Asha Rao')
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    })
    it('End stay confirms, then ends the booking', async () => {
      await open('Customers')
      await userEvent.click(await screen.findByRole('button', { name: 'Details' }))
      await userEvent.click(screen.getByRole('button', { name: 'End stay' }))
      expect(confirmSpy).toHaveBeenCalledWith('End this stay and free the beds?')
      expect(supabase.rpc).toHaveBeenCalledWith('admin_end_booking', { p_booking_id: 'bk1' })
    })
    it('opening a document uses a signed link', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      await open('Customers')
      await userEvent.click(await screen.findByRole('button', { name: 'Details' }))
      await userEvent.click(screen.getByRole('button', { name: 'aadhaar.pdf' }))
      await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://signed.example/file', '_blank', 'noopener'))
    })
  })

  describe('Rooms', () => {
    beforeEach(() => {
      db.tables.categories = { data: [{ id: 'monthly-pg', name: 'Monthly PG' }], error: null }
      db.tables.beds = { data: [], error: null }
      db.tables.amenities = { data: [], error: null }
      db.tables.rooms = {
        data: [{
          id: 'pg-101', room_no: '101', floor: 1, ac_type: 'AC', category_id: 'monthly-pg', rent_basis: 'bed', billing_period: 'month',
          price: 7500, deposit: 7500, is_demo_price: true, is_active: true, features: [], image_url: null, beds: [{ id: 'b1', label: 'A', status: 'available', is_occupied: false }],
        }],
        error: null,
      }
    })

    it('shows the live bed board and a price editor per room', async () => {
      await open('Rooms')
      expect(await screen.findByLabelText('Price for room 101')).toHaveValue(7500)
      expect(screen.getByLabelText('Deposit for room 101')).toHaveValue(7500)
      expect(screen.getByRole('heading', { name: 'Prices' })).toBeInTheDocument()
      expect(await screen.findByTitle('Toggle maintenance')).toBeInTheDocument() // admin can manage beds
    })
    it('Save is disabled until a value changes', async () => {
      await open('Rooms')
      const price = await screen.findByLabelText('Price for room 101')
      const row = price.closest('tr')
      expect(within(row).getByRole('button', { name: 'Save' })).toBeDisabled()
      await userEvent.clear(price)
      await userEvent.type(price, '8000')
      expect(within(row).getByRole('button', { name: 'Save' })).toBeEnabled()
    })
    it('saving a price updates the room and marks it as a real (non-demo) price', async () => {
      await open('Rooms')
      const price = await screen.findByLabelText('Price for room 101')
      await userEvent.clear(price)
      await userEvent.type(price, '8000')
      await userEvent.click(within(price.closest('tr')).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(queryFor('rooms').some((q) => opArgs(q, 'update'))).toBe(true))
      const q = queryFor('rooms').find((x) => opArgs(x, 'update'))
      expect(opArgs(q, 'update')[0]).toEqual({ price: 8000, deposit: 7500, is_demo_price: false })
      expect(q.ops).toContainEqual(['eq', ['id', 'pg-101']])
    })
    it('shows the error if saving is refused', async () => {
      await open('Rooms')
      const price = await screen.findByLabelText('Price for room 101')
      db.tables.rooms = { data: null, error: new Error('Not allowed') }
      await userEvent.clear(price)
      await userEvent.type(price, '9000')
      await userEvent.click(within(price.closest('tr')).getByRole('button', { name: 'Save' }))
      expect(await screen.findByText('Not allowed')).toBeInTheDocument()
    })
  })

  describe('Payments', () => {
    it('shows revenue split and the payment list with demo payments labelled', async () => {
      db.tables.payments = {
        data: [
          { id: 'p1', amount: 7500, status: 'succeeded', provider: 'razorpay', is_simulated: false, created_at: '2026-10-01T10:00:00Z', profiles: { full_name: 'Asha Rao' }, bills: { description: 'Rent Oct' } },
          { id: 'p2', amount: 500, status: 'failed', provider: 'demo', is_simulated: true, created_at: '2026-10-02T10:00:00Z', profiles: { full_name: 'Bala' }, bills: { description: 'Rent Oct' } },
        ],
        error: null,
      }
      await open('Payments')
      await screen.findByText('Received (real)')
      expect(stat('Received (real)')).toBe('₹1,20,000')
      expect(stat('Received (demo)')).toBe('₹7,500')
      expect(stat('Pending')).toBe('₹22,000')
      const real = screen.getByText('Asha Rao').closest('tr')
      expect(within(real).getByText('razorpay')).toBeInTheDocument()
      expect(within(real).getByText('succeeded')).toBeInTheDocument()
      const demo = screen.getByText('Bala').closest('tr')
      expect(within(demo).getByText('Demo')).toBeInTheDocument()
      expect(within(demo).getByText('failed')).toBeInTheDocument()
    })
    it('shows an empty state', async () => {
      db.tables.payments = { data: [], error: null }
      await open('Payments')
      expect(await screen.findByText('No payments yet')).toBeInTheDocument()
    })
  })

  describe('Dues', () => {
    const b = (over) => ({ id: 'x', status: 'unpaid', amount: 1000, description: 'Rent', due_date: day(3), profiles: { full_name: 'Asha Rao', phone: '9876543210' }, bookings: { rooms: { room_no: '101' } }, ...over })

    it('splits unpaid bills into overdue and upcoming, ignoring paid ones', async () => {
      db.tables.bills = { data: [b({ id: '1', due_date: day(-5), profiles: { full_name: 'Late Lata', phone: null } }), b({ id: '2', profiles: { full_name: 'Soon Sam', phone: null } }), b({ id: '3', status: 'paid', profiles: { full_name: 'Paid Pat', phone: null } })], error: null }
      await open('Dues')
      expect(await screen.findByRole('heading', { name: 'Overdue (1)' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Upcoming (1)' })).toBeInTheDocument()
      expect(screen.getByText('Late Lata')).toBeInTheDocument()
      expect(screen.getByText('Soon Sam')).toBeInTheDocument()
      expect(screen.queryByText('Paid Pat')).not.toBeInTheDocument()
      expect(screen.getByText('5d late')).toBeInTheDocument()
    })
    it('shows empty states for both lists', async () => {
      db.tables.bills = { data: [], error: null }
      await open('Dues')
      expect(await screen.findByText('Nothing overdue')).toBeInTheDocument()
      expect(screen.getByText('No upcoming bills')).toBeInTheDocument()
    })
    it('Mark paid confirms, then records a cash payment', async () => {
      db.tables.bills = { data: [b({ id: 'bill-77' })], error: null }
      await open('Dues')
      await userEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
      expect(confirmSpy).toHaveBeenCalled()
      expect(supabase.rpc).toHaveBeenCalledWith('admin_record_cash_payment', { p_bill_id: 'bill-77' })
    })
    it('Mark paid does nothing if declined', async () => {
      confirmSpy.mockReturnValue(false)
      db.tables.bills = { data: [b()], error: null }
      await open('Dues')
      await userEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
      expect(confirmSpy).toHaveBeenCalled()
      expect(supabase.rpc).not.toHaveBeenCalledWith('admin_record_cash_payment', expect.anything())
    })
    it('shows the error if recording fails', async () => {
      db.rpcs.admin_record_cash_payment = { data: null, error: new Error('Bill already paid') }
      db.tables.bills = { data: [b()], error: null }
      await open('Dues')
      await userEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Bill already paid')
    })
    it('includes a pre-written WhatsApp reminder', async () => {
      db.tables.bills = { data: [b()], error: null }
      await open('Dues')
      const href = decodeURIComponent((await screen.findByRole('link', { name: 'WhatsApp' })).getAttribute('href'))
      expect(href).toContain('Hi Asha Rao, this is YOLO Nest. Your payment of ₹1,000 (Rent)')
    })
  })

  describe('Employees', () => {
    const emp = (over = {}) => ({
      id: 'e1', full_name: 'Ravi Kumar', phone: '9000000000', is_active: true, created_at: '2026-09-01T00:00:00Z',
      employee_permissions: { can_view_customers: true, can_view_contacts: false, can_view_payments: false, can_manage_beds: true }, ...over,
    })
    beforeEach(() => { db.tables.profiles = { data: [emp()], error: null } })

    it('lists employees with their permission checkboxes', async () => {
      await open('Employees')
      expect(await screen.findByRole('heading', { name: 'Ravi Kumar' })).toBeInTheDocument()
      const group = screen.getByRole('group', { name: 'Permissions for Ravi Kumar' })
      expect(within(group).getByLabelText('See customers and dues')).toBeChecked()
      expect(within(group).getByLabelText('See phone numbers / WhatsApp')).not.toBeChecked()
      expect(within(group).getByLabelText('See bill amounts')).not.toBeChecked()
      expect(within(group).getByLabelText('Mark beds under maintenance')).toBeChecked()
    })
    it('toggling a permission sends the full permission set with only that flag flipped', async () => {
      await open('Employees')
      await userEvent.click(await screen.findByLabelText('See phone numbers / WhatsApp'))
      expect(supabase.rpc).toHaveBeenCalledWith('admin_set_employee_permissions', {
        p_employee: 'e1',
        p_perms: { can_view_customers: true, can_view_contacts: true, can_view_payments: false, can_manage_beds: true },
      })
    })
    it('disables an active employee', async () => {
      await open('Employees')
      await userEvent.click(await screen.findByRole('button', { name: 'Disable' }))
      expect(supabase.rpc).toHaveBeenCalledWith('admin_set_user_active', { p_user: 'e1', p_active: false })
    })
    it('re-enables a disabled employee', async () => {
      db.tables.profiles = { data: [emp({ is_active: false })], error: null }
      await open('Employees')
      expect(await screen.findByText('Disabled')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Enable' }))
      expect(supabase.rpc).toHaveBeenCalledWith('admin_set_user_active', { p_user: 'e1', p_active: true })
    })
    it('treats an employee with no permission row as having no permissions', async () => {
      db.tables.profiles = { data: [emp({ employee_permissions: null })], error: null }
      await open('Employees')
      const group = await screen.findByRole('group', { name: /Permissions for/ })
      within(group).getAllByRole('checkbox').forEach((c) => expect(c).not.toBeChecked())
    })
    it('shows an empty state but still offers the add form', async () => {
      db.tables.profiles = { data: [], error: null }
      await open('Employees')
      expect(await screen.findByText('No employees yet')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Add an employee' })).toBeInTheDocument()
    })
    it('shows the error when a permission change is refused', async () => {
      db.rpcs.admin_set_employee_permissions = { data: null, error: new Error('Admins only') }
      await open('Employees')
      await userEvent.click(await screen.findByLabelText('See bill amounts'))
      expect(await screen.findByText('Admins only')).toHaveAttribute('role', 'alert')
    })

    describe('add employee form', () => {
      const fill = async () => {
        await userEvent.type(await screen.findByLabelText('Full name'), 'New Person')
        await userEvent.type(screen.getByLabelText('Mobile'), '9111111111')
        await userEvent.type(screen.getByLabelText('Email'), 'new@example.com')
        await userEvent.type(screen.getByLabelText('Temporary password (8+)'), 'temp-pass-1')
      }
      it('requires name, email and an 8+ character password', async () => {
        await open('Employees')
        expect(await screen.findByLabelText('Full name')).toBeRequired()
        expect(screen.getByLabelText('Email')).toBeRequired()
        expect(screen.getByLabelText('Temporary password (8+)')).toHaveAttribute('minlength', '8')
      })
      it('creates the employee through the edge function, clears the form and confirms', async () => {
        db.fnResult = { data: { id: 'e2' }, error: null }
        await open('Employees')
        await fill()
        await userEvent.click(screen.getByRole('button', { name: 'Create employee' }))
        expect(await screen.findByText(/Employee created/)).toBeInTheDocument()
        expect(supabase.functions.invoke).toHaveBeenCalledWith('create-employee', {
          body: { full_name: 'New Person', phone: '9111111111', email: 'new@example.com', password: 'temp-pass-1' },
        })
        expect(screen.getByLabelText('Full name')).toHaveValue('')
      })
      it("shows the function's error message and keeps what was typed", async () => {
        db.fnResult = { data: null, error: { message: 'x', context: { json: async () => ({ error: 'Email already registered' }) } } }
        await open('Employees')
        await fill()
        await userEvent.click(screen.getByRole('button', { name: 'Create employee' }))
        expect(await screen.findByText('Email already registered')).toBeInTheDocument()
        expect(screen.getByLabelText('Email')).toHaveValue('new@example.com')
      })
    })
  })

  describe('Reviews', () => {
    const review = (over) => ({ id: 'r1', author_name: 'Asha', rating: 5, body: 'Great stay', status: 'pending', ...over })

    it('lists reviews with their status', async () => {
      db.tables.reviews = { data: [review(), review({ id: 'r2', author_name: 'Bala', status: 'published' })], error: null }
      await open('Reviews')
      expect(await screen.findAllByText('Great stay')).toHaveLength(2)
      expect(screen.getByText('pending')).toBeInTheDocument()
      expect(screen.getByText('published')).toBeInTheDocument()
    })
    it('pending reviews can be published or rejected; published ones only rejected', async () => {
      db.tables.reviews = { data: [review(), review({ id: 'r2', status: 'published' })], error: null }
      await open('Reviews')
      await screen.findAllByText('Great stay')
      expect(screen.getAllByRole('button', { name: 'Publish' })).toHaveLength(1)
      expect(screen.getAllByRole('button', { name: 'Reject' })).toHaveLength(2)
    })
    it('Publish sets the status to published', async () => {
      db.tables.reviews = { data: [review()], error: null }
      await open('Reviews')
      await userEvent.click(await screen.findByRole('button', { name: 'Publish' }))
      await waitFor(() => expect(queryFor('reviews').some((q) => opArgs(q, 'update'))).toBe(true))
      const q = queryFor('reviews').find((x) => opArgs(x, 'update'))
      expect(opArgs(q, 'update')[0]).toEqual({ status: 'published' })
      expect(q.ops).toContainEqual(['eq', ['id', 'r1']])
    })
    it('Reject sets the status to rejected', async () => {
      db.tables.reviews = { data: [review()], error: null }
      await open('Reviews')
      await userEvent.click(await screen.findByRole('button', { name: 'Reject' }))
      await waitFor(() => expect(queryFor('reviews').some((q) => opArgs(q, 'update'))).toBe(true))
      expect(opArgs(queryFor('reviews').find((x) => opArgs(x, 'update')), 'update')[0]).toEqual({ status: 'rejected' })
    })
    it('shows an empty state', async () => {
      db.tables.reviews = { data: [], error: null }
      await open('Reviews')
      expect(await screen.findByText('No reviews submitted yet')).toBeInTheDocument()
    })
  })

  describe('Activity', () => {
    it('lists the audit trail, naming the system when there is no user', async () => {
      db.tables.activity_log = {
        data: [
          { id: 1, created_at: '2026-10-01T10:00:00Z', profiles: { full_name: 'Admin Anil' }, action: 'bed_status_changed', entity: 'bed', details: { status: 'maintenance' } },
          { id: 2, created_at: '2026-10-02T10:00:00Z', profiles: null, action: 'booking_expired', entity: 'booking', details: {} },
        ],
        error: null,
      }
      await open('Activity')
      expect(await screen.findByText('Admin Anil')).toBeInTheDocument()
      expect(screen.getByText('bed_status_changed')).toBeInTheDocument()
      expect(screen.getByText(/"status":"maintenance"/)).toBeInTheDocument()
      expect(screen.getByText('System')).toBeInTheDocument()
    })
    it('shows an empty state', async () => {
      db.tables.activity_log = { data: [], error: null }
      await open('Activity')
      expect(await screen.findByText('No activity yet')).toBeInTheDocument()
    })
  })
})
