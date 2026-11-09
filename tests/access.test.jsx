import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

import { asRole, setAuth } from './helpers/authMock.js'
import { Where, renderRoute } from './helpers/render.jsx'
import Navbar, { homeFor } from '../src/components/Navbar'
import RequireRole from '../src/components/RequireRole'

beforeEach(() => setAuth())

describe('homeFor', () => {
  it('sends each role to its own dashboard', () => {
    expect(homeFor('customer')).toBe('/account')
    expect(homeFor('employee')).toBe('/staff')
    expect(homeFor('admin')).toBe('/admin')
  })
  it('sends unknown or missing roles to the login page', () => {
    expect(homeFor(null)).toBe('/login')
    expect(homeFor('hacker')).toBe('/login')
  })
})

describe('Navbar', () => {
  const show = (route = '/') => render(<MemoryRouter initialEntries={[route]}><Navbar /><Where /></MemoryRouter>)

  it('shows the section links, each pointing at the right page or anchor', () => {
    show()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const hrefs = Object.fromEntries(within(nav).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')]))
    expect(hrefs).toEqual({ Rooms: '/rooms', Amenities: '/amenities', Location: '/location', FAQ: '/#faq', Contact: '/#contact' })
  })
  it('logo links home and has an accessible name', () => {
    show('/rooms')
    expect(screen.getByRole('link', { name: 'YOLO nest home' })).toHaveAttribute('href', '/')
  })
  it('highlights the current page link', () => {
    show('/rooms')
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Rooms' })).toHaveAttribute('aria-current', 'page')
  })
  it('signed out + Supabase configured: offers Log in', () => {
    show()
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
  })
  it('without Supabase: no auth buttons at all', () => {
    setAuth({ configured: false })
    show()
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument()
  })
  it.each([
    ['customer', '/account'],
    ['employee', '/staff'],
    ['admin', '/admin'],
  ])('signed in as %s: Dashboard goes to %s', (role, path) => {
    asRole(role)
    show()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', path)
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument()
  })
  it('Log out signs out and returns home', async () => {
    const auth = asRole('customer')
    show('/account')
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalled()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })
  it('mobile menu toggles with aria-expanded and lists the links', async () => {
    show()
    const toggle = screen.getByRole('button', { name: 'Menu' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const mobile = screen.getByRole('navigation', { name: 'Mobile' })
    expect(within(mobile).getAllByRole('link')).toHaveLength(5)
  })
  it('choosing a link in the mobile menu closes it', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Mobile' })).getByRole('link', { name: 'Rooms' }))
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/rooms')
  })
  it('the header is sticky', () => {
    show()
    expect(screen.getByRole('banner').className).toContain('sticky')
  })
})

describe('RequireRole', () => {
  const guarded = (roles = ['customer'], loginPath = '/login') => (
    <RequireRole roles={roles} loginPath={loginPath}><p>secret area</p></RequireRole>
  )
  const open = (ui, path = '/account') => renderRoute(ui, { path })

  it('explains that Supabase is needed when it is not configured', () => {
    setAuth({ configured: false })
    open(guarded())
    expect(screen.getByText(/needs Supabase/)).toBeInTheDocument()
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })
  it('shows a spinner while the session loads', () => {
    setAuth({ loading: true })
    open(guarded())
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })
  it('redirects visitors to the login page and remembers where they were going', () => {
    open(guarded())
    expect(screen.getByTestId('where')).toHaveTextContent('/login?next=%2Faccount')
  })
  it('uses the area-specific login page for staff and admin', () => {
    open(guarded(['admin'], '/admin/login'), '/admin')
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/login?next=%2Fadmin')
  })
  it('blocks deactivated accounts (no role) and offers log out', async () => {
    const auth = setAuth({ user: { id: 'u' }, role: null })
    open(guarded())
    expect(screen.getByText('This account is not active. Contact the PG office.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalled()
  })
  it('stops a customer from opening the admin area', () => {
    asRole('customer')
    open(guarded(['admin'], '/admin/login'), '/admin')
    expect(screen.getByText('Your account (customer) cannot open this area.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute('href', '/account')
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })
  it('stops an employee from opening the admin area', () => {
    asRole('employee')
    open(guarded(['admin']), '/admin')
    expect(screen.getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute('href', '/staff')
  })
  it.each([
    [['customer'], 'customer'],
    [['employee', 'admin'], 'employee'],
    [['employee', 'admin'], 'admin'],
    [['admin'], 'admin'],
  ])('lets roles %j in as %s', (roles, role) => {
    asRole(role)
    open(guarded(roles))
    expect(screen.getByText('secret area')).toBeInTheDocument()
  })
})
