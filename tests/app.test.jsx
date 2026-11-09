import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

import { asRole, setAuth } from './helpers/authMock.js'
import { db, resetMock, setConfigured } from './helpers/supabaseMock.js'
import App from '../src/App'

const go = (route) => render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)

beforeEach(() => {
  resetMock()
  setAuth()
  document.head.innerHTML = ''
})

describe('public routes', () => {
  beforeEach(() => setConfigured(false))

  it('/ renders the home page inside the public layout (navbar + footer)', async () => {
    go('/')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Premium co-living')
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    await screen.findByText('Explore All Rooms')
  })
  it.each([
    ['/rooms', 'Rooms'],
    ['/amenities', 'Amenities'],
    ['/location', 'Location'],
    ['/privacy', 'Privacy policy'],
    ['/terms', /Terms/],
  ])('%s renders its page', async (route, title) => {
    go(route)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })
  it('/login and /signup render their forms/notices', () => {
    setConfigured(true)
    go('/login')
    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument()
  })
  it('/signup renders the sign-up form', () => {
    go('/signup')
    expect(screen.getByRole('heading', { level: 1, name: 'Create your account' })).toBeInTheDocument()
  })
  it('an unknown URL shows the not-found page with a way home', () => {
    go('/no/such/page')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back home' })).toHaveAttribute('href', '/')
  })
  it('/book/:roomId is routed (Book explains Supabase is needed)', async () => {
    setAuth({ configured: false })
    go('/book/pg-101')
    expect(await screen.findByText(/Booking is not available until Supabase is configured/)).toBeInTheDocument()
  })
})

describe('protected routes', () => {
  it('/account sends signed-out visitors to /login', () => {
    go('/account')
    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument()
  })
  it('/staff sends signed-out visitors to the staff login, with no public navbar or footer', () => {
    go('/staff')
    expect(screen.getByRole('heading', { level: 1, name: 'Staff log in' })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  })
  it('/admin sends signed-out visitors to the admin login', () => {
    go('/admin')
    expect(screen.getByRole('heading', { level: 1, name: 'Admin log in' })).toBeInTheDocument()
  })
  it('a customer cannot open /admin', () => {
    asRole('customer')
    go('/admin')
    expect(screen.getByText('Your account (customer) cannot open this area.')).toBeInTheDocument()
  })
  it('an employee cannot open /admin but can open /staff', async () => {
    asRole('employee')
    db.tables.employee_permissions = { data: {}, error: null }
    db.tables.rooms = { data: [], error: null }
    const { unmount } = go('/admin')
    expect(screen.getByText('Your account (employee) cannot open this area.')).toBeInTheDocument()
    unmount()
    go('/staff')
    expect(await screen.findByRole('heading', { name: 'Staff dashboard' })).toBeInTheDocument()
  })
  it('an admin can open /admin', async () => {
    asRole('admin')
    db.rpcs.admin_dashboard_stats = { data: { rooms: 1, beds: 1, received: 0, received_demo: 0 }, error: null }
    go('/admin')
    expect(await screen.findByRole('heading', { name: 'Admin dashboard' })).toBeInTheDocument()
  })
  it('an employee cannot open /account (customers only)', () => {
    asRole('employee')
    go('/account')
    expect(screen.getByText('Your account (employee) cannot open this area.')).toBeInTheDocument()
  })
  it('a signed-in customer opens /account', async () => {
    asRole('customer')
    db.tables.bookings = { data: [], error: null }
    db.tables.bills = { data: [], error: null }
    db.tables.payments = { data: [], error: null }
    db.tables.customer_documents = { data: [], error: null }
    db.tables.reviews = { data: null, error: null }
    go('/account')
    expect(await screen.findByRole('heading', { name: 'Hi Test User' })).toBeInTheDocument()
  })
})

describe('PWA identity', () => {
  beforeEach(() => setConfigured(false))
  const manifest = () => document.head.querySelector('link[rel="manifest"]')?.getAttribute('href')

  it('public pages use the public manifest', () => {
    go('/location')
    expect(manifest()).toBe('/manifest.webmanifest')
  })
  it('the staff area uses the staff manifest', () => {
    go('/staff/login')
    expect(manifest()).toBe('/manifest-staff.webmanifest')
  })
  it('the admin area uses the admin manifest', () => {
    go('/admin/login')
    expect(manifest()).toBe('/manifest-admin.webmanifest')
  })
})

describe('scroll behaviour', () => {
  beforeEach(() => {
    setConfigured(false)
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('scrolls to the top on a new page', () => {
    const spy = vi.spyOn(window, 'scrollTo')
    go('/rooms')
    expect(spy).toHaveBeenCalledWith({ top: 0 })
  })
  it('scrolls to the section named in the #hash once the page has rendered', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    go('/#faq')
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(spy).toHaveBeenCalledWith({ behavior: 'smooth' })
    expect(spy.mock.contexts.some((el) => el?.id === 'faq')).toBe(true)
  })
})
