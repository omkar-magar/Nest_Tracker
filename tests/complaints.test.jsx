// Complaint management screens: the resident's complaints on /account and the office board at /admin/complaints.
// Permissions are enforced in SQL and tested in tests/db/complaints.test.js; these check the screens offer the
// right actions to each role and send the right calls.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))

const { db, resetMock, supabase, storageBucket } = await import('./helpers/supabaseMock.js')
const { asRole } = await import('./helpers/authMock.js')
const { MyComplaints } = await import('../src/pages/account/TenantSections')
const { default: Complaints } = await import('../src/pages/manage/Complaints')
const { ScopeProvider } = await import('../src/components/manage/kit')
const cx = await import('../src/services/complaints')

const rpcCalls = (name) => supabase.rpc.mock.calls.filter(([n]) => n === name).map(([, args]) => args)
const base = { ticket_no: 7, category: 'plumbing', title: 'Tap leaking', description: 'Bathroom tap drips', photos: [], after_photos: [],
  priority: 'medium', room_label: 'A-101', created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z', reopen_count: 0 }

beforeEach(() => { resetMock(); vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => vi.restoreAllMocks())

describe('resident complaints', () => {
  const renderMine = () => { asRole('customer'); return render(<MyComplaints />) }

  it('asks residents without a stay to wait', async () => {
    renderMine()
    expect(await screen.findByText(/once your stay has started/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit complaint' })).not.toBeInTheDocument()
  })

  it('validates, uploads images to the resident\'s own folder and submits the complaint', async () => {
    db.rpcs.my_complaint_place = { data: { property_id: 'P1', room_label: 'A-101' }, error: null }
    renderMine()
    await userEvent.click(await screen.findByRole('button', { name: 'Submit complaint' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a category')
    expect(rpcCalls('raise_complaint')).toEqual([])

    await userEvent.selectOptions(screen.getByLabelText('Category *'), 'Electricity')
    await userEvent.type(screen.getByLabelText('Title *'), 'Fan not working')
    await userEvent.type(screen.getByLabelText('Description *'), 'Ceiling fan stopped last night')
    await userEvent.upload(screen.getByLabelText('Add images (optional)'), new File(['x'], 'fan.jpg', { type: 'image/jpeg' }))
    expect(screen.getByText('fan.jpg')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Submit complaint' }))

    expect(await screen.findByText(/Complaint submitted/)).toBeInTheDocument()
    expect(storageBucket.upload.mock.calls[0][0]).toMatch(/^u1\/\d+-fan\.jpg$/)
    const [{ p }] = rpcCalls('raise_complaint')
    expect(p).toMatchObject({ category: 'electrical', title: 'Fan not working', description: 'Ceiling fan stopped last night' })
    expect(p.photos).toEqual([storageBucket.upload.mock.calls[0][0]])
  })

  it('shows the manager, progress and resolution, and lets the resident confirm or reopen', async () => {
    db.rpcs.my_complaint_place = { data: { property_id: 'P1', room_label: 'A-101' }, error: null }
    db.rpcs.my_complaints = { data: [{ ...base, id: 'c1', status: 'resolved', assignee_name: 'Anil', resolution: 'Washer replaced' }], error: null }
    renderMine()
    expect(await screen.findByText('Anil')).toBeInTheDocument()
    expect(screen.getByText('Washer replaced')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Progress: Resolved' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Still not fixed' }))
    const reopen = screen.getByRole('button', { name: 'Reopen complaint' })
    expect(reopen).toBeDisabled()                               // a reason is required
    await userEvent.type(screen.getByLabelText('What is still wrong? *'), 'Still dripping')
    await userEvent.click(reopen)
    expect(window.confirm).toHaveBeenCalled()
    expect(rpcCalls('update_complaint')).toEqual([{ p_id: 'c1', p: { status: 'reopen', note: 'Still dripping' } }])
  })

  it('closes with a rating when the resident confirms the fix', async () => {
    db.rpcs.my_complaints = { data: [{ ...base, id: 'c1', status: 'resolved', assignee_name: 'Anil' }], error: null }
    renderMine()
    await userEvent.selectOptions(await screen.findByLabelText('How did we do?'), '4')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm fixed' }))
    expect(rpcCalls('update_complaint')).toEqual([{ p_id: 'c1', p: { status: 'closed', rating: 4, feedback: '' } }])
  })
})

describe('office board', () => {
  const people = [{ id: 'u1', full_name: 'Anil', role: 'manager' }, { id: 'u2', full_name: 'Bina', role: 'manager' }]
  const stats = { total: 3, open: 1, unassigned: 1, assigned: 1, in_progress: 1, pending: 2, resolved: 0, closed: 0, overdue: 0,
    avg_resolution_hours: 5.5, by_assignee: [{ id: 'u1', name: 'Anil', role: 'manager', active: 1, resolved: 2, total: 3, avg_hours: 4 }] }
  const board = [
    { ...base, id: 'c1', ticket_no: 1, property_id: 'P2', status: 'new', assigned_to: null, title: 'Wi-Fi down' },
    { ...base, id: 'c2', ticket_no: 2, property_id: 'P1', status: 'assigned', assigned_to: 'u2', title: 'Door stuck' },
    { ...base, id: 'c3', ticket_no: 3, property_id: 'P1', status: 'in_progress', assigned_to: 'u1', title: 'Fan noise' },
  ]
  const open = (role, id) => {
    asRole(role)
    db.tables.complaints = { data: board, error: null }
    db.rpcs.complaint_stats = { data: stats, error: null }
    db.rpcs.complaint_assignees = { data: people, error: null }
    db.rpcs.complaint_timeline = { data: [{ id: 1, created_at: '2026-11-20T10:00:00Z', action: 'created', actor_name: 'Ravi', actor_role: 'customer', to_status: 'new', note: 'Raised', details: {} }], error: null }
    return render(
      <MemoryRouter initialEntries={[`/admin/complaints${id ? `?open=${id}` : ''}`]}>
        <ScopeProvider properties={[{ id: 'P1', name: 'A wing' }, { id: 'P2', name: 'B wing' }]} initial="P1">
          <Routes><Route path="/admin/complaints" element={<Complaints />} /></Routes>
        </ScopeProvider>
      </MemoryRouter>,
    )
  }

  it('shows every building to a manager, with stats, per-manager load and filters', async () => {
    open('manager')
    expect(await screen.findByText('Wi-Fi down')).toBeInTheDocument()   // B wing complaint even though the manager's wing is A
    expect(screen.getByText('5.5 h')).toBeInTheDocument()
    expect(screen.getByText(/1 active · 2 resolved/)).toBeInTheDocument()
    const filters = screen.getByRole('group', { name: 'Filter complaints' })
    await userEvent.click(within(filters).getByRole('button', { name: /Unassigned/ }))
    expect(screen.queryByText('Door stuck')).not.toBeInTheDocument()
    expect(screen.getByText('Wi-Fi down')).toBeInTheDocument()
    await userEvent.click(within(filters).getByRole('button', { name: /Assigned to me/ }))
    expect(screen.getByText('Fan noise')).toBeInTheDocument()
    expect(screen.queryByText('Wi-Fi down')).not.toBeInTheDocument()
  })

  it('lets a manager take an unassigned complaint but not assign it to someone else', async () => {
    open('manager', 'c1')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText('Assign to')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Start work' })).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign to me' }))
    expect(window.confirm).toHaveBeenCalledWith('Take responsibility for this complaint?')
    expect(rpcCalls('update_complaint')).toEqual([{ p_id: 'c1', p: { assigned_to: 'u1', note: '' } }])
  })

  it('gives a manager no actions on the other manager\'s complaint', async () => {
    open('manager', 'c2')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Assigned to Bina\. Only the admin can reassign it\./)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Start work|Mark resolved|Add note|Assign to me/ })).not.toBeInTheDocument()
  })

  it('lets a manager work on and resolve their own complaint, but not close it', async () => {
    open('manager', 'c3')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Close complaint' })).toBeNull()
    await userEvent.type(await within(dialog).findByLabelText('Resolution notes (needed to mark it resolved)'), 'Fan bearing oiled')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark resolved' }))
    const [{ p }] = rpcCalls('update_complaint')
    expect(p).toMatchObject({ status: 'resolved', resolution: 'Fan bearing oiled' })
    expect(within(dialog).queryByLabelText('Priority')).not.toBeInTheDocument()
  })

  it('lets the admin reassign, change priority and close', async () => {
    open('admin', 'c2')
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Raised the complaint')).toBeInTheDocument()  // timeline
    await userEvent.selectOptions(within(dialog).getByLabelText('Assign to'), 'u1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reassign' }))
    expect(window.confirm).toHaveBeenCalledWith('Reassign this complaint to Anil?')
    await userEvent.selectOptions(within(dialog).getByLabelText('Priority'), 'urgent')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save priority' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close complaint' }))
    expect(rpcCalls('update_complaint')).toEqual([
      { p_id: 'c2', p: { assigned_to: 'u1', note: '' } },
      { p_id: 'c2', p: { priority: 'urgent' } },
      { p_id: 'c2', p: { status: 'closed', note: '' } },
    ])
  })
})

describe('complaint helpers', () => {
  it('checks image count, type and size', () => {
    const img = (name, type = 'image/png', size = 10) => ({ name, type, size })
    expect(cx.checkImages([img('a.png')])).toBe('')
    expect(cx.checkImages([img('a.pdf', 'application/pdf')])).toMatch(/not a JPG/)
    expect(cx.checkImages([img('big.png', 'image/png', 6 * 1024 * 1024)])).toMatch(/larger than 5 MB/)
    expect(cx.checkImages([img('a.png'), img('b.png')], 4)).toBe('Attach at most 5 images')
  })

  it('words each timeline action', () => {
    expect(cx.timelineText({ action: 'reassigned', from_assignee_name: 'Anil', to_assignee_name: 'Bina' })).toBe('Reassigned from Anil to Bina')
    expect(cx.timelineText({ action: 'priority_changed', details: { from: 'medium', to: 'high' } })).toBe('Priority changed from medium to high')
    expect(cx.timelineText({ action: 'work_updated', details: { resolution: 'x', photos_added: 2 } })).toBe('Updated resolution notes, added 2 resolution images')
    expect(cx.timelineText({ action: 'updated' })).toBe('Updated')
  })
})
