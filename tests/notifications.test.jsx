// The customer's bell on /account shows only customer-facing notices, never manager or staff alerts.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))

const { db, resetMock } = await import('./helpers/supabaseMock.js')
const { asRole } = await import('./helpers/authMock.js')
const { isCustomerNotice, loadMyNotifications } = await import('../src/services/manage')
const { default: NotificationBell } = await import('../src/components/NotificationBell')

const notices = [
  { id: 1, kind: 'addon', subject: 'Extra furniture approved', body: '', link: '/account#my-stay', status: 'queued', created_at: '2026-11-27T04:39:00Z' },
  { id: 2, kind: 'addon', subject: 'Extra furniture request', body: '', link: '/admin/inventory?wing=P1', status: 'queued', created_at: '2026-11-27T04:38:00Z' },
  { id: 3, kind: 'registration', subject: 'New registration', body: '', link: '/admin/register?wing=P1&tab=new', status: 'queued', created_at: '2026-11-27T04:27:00Z' },
  { id: 4, kind: 'complaint', subject: 'Complaint #4 assigned to you', body: '', link: '/staff#tasks', status: 'queued', created_at: '2026-11-27T04:20:00Z' },
  { id: 5, kind: 'lead', subject: 'New lead: Ravi', body: '', link: null, status: 'queued', created_at: '2026-11-27T04:10:00Z' },
  { id: 6, kind: 'receipt', subject: 'Payment received', body: '', link: null, status: 'queued', created_at: '2026-11-27T04:00:00Z' },
]

beforeEach(() => {
  resetMock()
  asRole('customer')
  db.tables.notifications = { data: notices, error: null }
})

describe('customer notifications', () => {
  it('drops staff kinds and anything linking into /admin or /staff', () => {
    expect(notices.filter(isCustomerNotice).map((n) => n.id)).toEqual([1, 6])
    expect(isCustomerNotice({ kind: 'registration', link: '/administrator' })).toBe(true)
  })

  it('keeps everything for staff and filters only when asked', async () => {
    expect(await loadMyNotifications('u1')).toHaveLength(6)
    expect((await loadMyNotifications('u1', { customer: true })).map((n) => n.id)).toEqual([1, 6])
  })

  it('shows only customer notices in the customer bell', async () => {
    render(<MemoryRouter><NotificationBell customer /></MemoryRouter>)
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 new' })
    await userEvent.click(bell)
    expect(screen.getByText('Extra furniture approved')).toBeInTheDocument()
    expect(screen.getByText('Payment received')).toBeInTheDocument()
    expect(screen.queryByText('Extra furniture request')).not.toBeInTheDocument()
    expect(screen.queryByText('New registration')).not.toBeInTheDocument()
    expect(screen.queryByText(/assigned to you/)).not.toBeInTheDocument()
    expect(screen.queryByText(/New lead/)).not.toBeInTheDocument()
  })
})
