import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

import { asRole, setAuth } from './helpers/authMock.js'
import { db, resetMock, setConfigured, supabase } from './helpers/supabaseMock.js'
import { Where, renderAt, renderRoute } from './helpers/render.jsx'
import Login from '../src/pages/Login'
import Signup from '../src/pages/Signup'
import Rooms from '../src/pages/Rooms'
import Book from '../src/pages/Book'
import Home from '../src/pages/Home'
import Amenities from '../src/pages/Amenities'
import Location from '../src/pages/Location'
import { Privacy, Terms } from '../src/pages/Legal'
import { brand, categories, nearby, rooms as staticRooms } from '../src/data/site'

beforeEach(() => {
  resetMock()
  setAuth()
})

// Builds the table rows loadCatalog() reads, from compact room specs.
function seedCatalog(specs) {
  db.tables.categories = { data: categories.map((c) => ({ id: c.id, name: c.name })), error: null }
  db.tables.rooms = {
    data: specs.map((s) => ({
      id: s.id, category_id: s.category ?? 'monthly-pg', room_no: s.no, floor: 1, ac_type: s.type ?? 'AC', description: '', features: ['Furnished'], image_url: null,
      rent_basis: s.basis ?? 'bed', billing_period: s.billing ?? 'month', price: s.price, deposit: s.deposit ?? 0, is_demo_price: false, is_active: true,
    })),
    error: null,
  }
  db.tables.beds = {
    data: specs.flatMap((s) => (s.beds ?? ['free', 'free']).map((st, i) => ({
      id: `${s.id}-${i}`, room_id: s.id, label: String.fromCharCode(65 + i),
      status: st === 'maint' ? 'maintenance' : 'available', is_occupied: st === 'taken',
    }))),
    error: null,
  }
  db.tables.amenities = { data: [], error: null }
}

// ------------------------------------------------------------------ Login
describe('Login', () => {
  const at = (audience = 'customer', route = '/login') => renderRoute(<Login audience={audience} />, { path: '/login', route })

  it('explains that accounts need Supabase when it is not configured', () => {
    setAuth({ configured: false })
    at()
    expect(screen.getByText(/not available until Supabase is configured/)).toBeInTheDocument()
  })
  it('shows a spinner while the session loads', () => {
    setAuth({ loading: true })
    at()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
  it.each([
    ['customer', 'Log in'],
    ['employee', 'Staff log in'],
    ['admin', 'Admin log in'],
  ])('%s audience has the title "%s"', (audience, title) => {
    at(audience)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  })
  it('only the customer login offers sign-up', () => {
    const { unmount } = at('customer')
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup')
    unmount()
    at('employee')
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument()
  })
  it('has labelled, required email and password fields', () => {
    at()
    expect(screen.getByLabelText('Email')).toBeRequired()
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Password')).toBeRequired()
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })
  it('submits the trimmed email and the password', async () => {
    const auth = setAuth()
    at()
    await userEvent.type(screen.getByLabelText('Email'), '  asha@example.com ')
    await userEvent.type(screen.getByLabelText('Password'), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(auth.signIn).toHaveBeenCalledWith('asha@example.com', 'secret123')
  })
  it('shows the error returned by Supabase', async () => {
    setAuth({ signIn: vi.fn(async () => ({ error: { message: 'Invalid login credentials' } })) })
    at()
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpass')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled()
  })
  it('disables the button while signing in', async () => {
    let done
    setAuth({ signIn: vi.fn(() => new Promise((r) => { done = r })) })
    at()
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Password'), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
    done({ error: null })
  })
  it.each([
    ['customer', 'customer', '/account'],
    ['employee', 'employee', '/staff'],
    ['employee', 'admin', '/staff'],
    ['admin', 'admin', '/admin'],
  ])('%s login: a signed-in %s goes straight to %s', (audience, role, dest) => {
    asRole(role)
    at(audience)
    expect(screen.getByTestId('where')).toHaveTextContent(dest)
  })
  it('a signed-in customer on the admin login sees a wrong-area message instead of a form', () => {
    asRole('customer')
    at('admin')
    expect(screen.getByText(/which cannot open this area/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute('href', '/account')
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })
  it('wrong-area message can log out', async () => {
    const auth = asRole('employee')
    at('admin')
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalled()
  })
  it('after login, goes to ?next= when it is an in-site path', async () => {
    asRole('customer')
    at('customer', '/login?next=/book/pg-101')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/book/pg-101'))
  })
  it('ignores an external ?next= URL', async () => {
    asRole('customer')
    at('customer', '/login?next=https://evil.example')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/account'))
  })
})

// ------------------------------------------------------------------ Signup
describe('Signup', () => {
  const at = () => renderRoute(<Signup />, { path: '/signup' })
  const fill = async ({ name = ' Asha Rao ', phone = '9876543210', email = ' asha@example.com ', password = 'secret123' } = {}) => {
    await userEvent.type(screen.getByLabelText('Full name'), name)
    await userEvent.type(screen.getByLabelText('Mobile number'), phone)
    await userEvent.type(screen.getByLabelText('Email'), email)
    await userEvent.type(screen.getByLabelText('Password (8+ characters)'), password)
  }

  it('explains that accounts need Supabase when it is not configured', () => {
    setAuth({ configured: false })
    at()
    expect(screen.getByText(/not available until Supabase is configured/)).toBeInTheDocument()
  })
  it('validates in the browser: required fields, 8+ char password, phone pattern', () => {
    at()
    expect(screen.getByLabelText('Full name')).toBeRequired()
    expect(screen.getByLabelText('Email')).toBeRequired()
    expect(screen.getByLabelText('Password (8+ characters)')).toHaveAttribute('minlength', '8')
    const phone = screen.getByLabelText('Mobile number')
    expect(phone).toBeRequired()
    expect(new RegExp(`^(?:${phone.getAttribute('pattern')})$`).test('9876543210')).toBe(true)
    expect(new RegExp(`^(?:${phone.getAttribute('pattern')})$`).test('12345')).toBe(false)
    expect(new RegExp(`^(?:${phone.getAttribute('pattern')})$`).test('abcdefghij')).toBe(false)
  })
  it('links to terms, privacy and login', () => {
    at()
    expect(screen.getByRole('link', { name: 'terms' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  })
  it('creates the account with trimmed name and email', async () => {
    const auth = setAuth({ signUp: vi.fn(async () => ({ data: { session: { user: {} } }, error: null })) })
    at()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(auth.signUp).toHaveBeenCalledWith('asha@example.com', 'secret123', 'Asha Rao', '9876543210')
  })
  it('asks the customer to confirm their email when no session is returned', async () => {
    at()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText(/Check your email to confirm your account/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'log in' })).toHaveAttribute('href', '/login')
  })
  it('shows the sign-up error (e.g. email already registered)', async () => {
    setAuth({ signUp: vi.fn(async () => ({ data: null, error: { message: 'User already registered' } })) })
    at()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('User already registered')
  })
  it('sends an already signed-in user to their account', () => {
    asRole('customer')
    at()
    expect(screen.getByTestId('where')).toHaveTextContent('/account')
  })
})

// ------------------------------------------------------------------ Rooms
describe('Rooms page (no backend)', () => {
  beforeEach(() => setConfigured(false))

  const cards = () => screen.getAllByRole('article')
  const titles = () => cards().map((c) => within(c).getByRole('heading', { level: 3 }).textContent)

  it('lists every static room and warns that availability is not live and prices are demo', async () => {
    renderAt(<Rooms />, '/rooms')
    expect(await screen.findByText(`${staticRooms.length} rooms`)).toBeInTheDocument()
    expect(screen.getByText(/Live availability is not connected/)).toBeInTheDocument()
    expect(screen.getByText(/Prices shown are demo values/)).toBeInTheDocument()
    expect(cards()).toHaveLength(staticRooms.length)
  })
  it('availability filter is disabled without a backend', async () => {
    renderAt(<Rooms />, '/rooms')
    await screen.findByText(/rooms$/)
    expect(screen.getByLabelText('Availability')).toBeDisabled()
  })
  it('filters by category from the URL', async () => {
    renderAt(<Rooms />, '/rooms?category=airbnb')
    expect(await screen.findByText('1 room')).toBeInTheDocument()
    expect(screen.getByLabelText('Category')).toHaveValue('airbnb')
    expect(titles()).toEqual(['Room 501'])
  })
  it('filters by category from the dropdown', async () => {
    renderAt(<Rooms />, '/rooms')
    await screen.findByText(/rooms$/)
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'lodge')
    expect(screen.getByText('1 room')).toBeInTheDocument()
    expect(titles()).toEqual(['Room 401'])
  })
  it('filters AC vs Non-AC', async () => {
    renderAt(<Rooms />, '/rooms')
    await screen.findByText(/rooms$/)
    await userEvent.selectOptions(screen.getByLabelText('Room type'), 'Non-AC')
    expect(titles()).toEqual(['Room 102'])
  })
  it('combines filters and shows an empty state when nothing matches', async () => {
    renderAt(<Rooms />, '/rooms?category=lodge&type=Non-AC')
    expect(await screen.findByText('0 rooms')).toBeInTheDocument()
    expect(screen.getByText('No rooms match these filters')).toBeInTheDocument()
  })
  it('sorts by price, low to high (nightly rooms compared as 30 nights)', async () => {
    renderAt(<Rooms />, '/rooms')
    await screen.findByText(/rooms$/)
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'price-asc')
    expect(titles().slice(0, 2)).toEqual(['Room 102', 'Room 101'])
    expect(titles().at(-1)).toBe('Room 501')
  })
  it('sorts by price, high to low', async () => {
    renderAt(<Rooms />, '/rooms')
    await screen.findByText(/rooms$/)
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'price-desc')
    expect(titles()[0]).toBe('Room 501')
    expect(titles().at(-1)).toBe('Room 102')
  })
  it('sorts by most beds', async () => {
    renderAt(<Rooms />, '/rooms')
    await screen.findByText(/rooms$/)
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'beds')
    expect(titles()[0]).toBe('Room 501') // 4 beds
  })
})

describe('Rooms page (with backend)', () => {
  beforeEach(() => {
    seedCatalog([
      { id: 'a', no: '1', price: 7000, beds: ['free', 'free'] },
      { id: 'b', no: '2', price: 6500, beds: ['taken', 'free'] },
      { id: 'c', no: '3', price: 8000, beds: ['taken', 'taken'] },
    ])
  })
  const titles = () => screen.getAllByRole('article').map((c) => within(c).getByRole('heading', { level: 3 }).textContent)

  it('shows live availability and no "not connected" warning', async () => {
    renderAt(<Rooms />, '/rooms')
    expect(await screen.findByText('3 rooms')).toBeInTheDocument()
    expect(screen.queryByText(/Live availability is not connected/)).not.toBeInTheDocument()
    expect(screen.queryByText(/demo values/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Availability')).toBeEnabled()
  })
  it.each([
    ['available', ['Room 1']],
    ['partial', ['Room 2']],
    ['full', ['Room 3']],
  ])('availability filter "%s"', async (status, expected) => {
    renderAt(<Rooms />, `/rooms?status=${status}`)
    await screen.findByText(`${expected.length} room${expected.length === 1 ? '' : 's'}`)
    expect(titles()).toEqual(expected)
  })
  it('shows an error with retry when loading fails', async () => {
    db.tables.rooms = { data: null, error: new Error('rooms table missing') }
    renderAt(<Rooms />, '/rooms')
    expect(await screen.findByRole('alert')).toHaveTextContent('rooms table missing')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ Book
describe('Book page', () => {
  const at = (id = 'pg-1') => render(
    <MemoryRouter initialEntries={[`/book/${id}`]}>
      <Routes>
        <Route path="/book/:roomId" element={<Book />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
  const money = (label) => screen.getByText(label).nextElementSibling.textContent

  beforeEach(() => {
    asRole('customer')
    seedCatalog([
      { id: 'pg-1', no: '101', price: 7500, deposit: 7500, beds: ['free', 'free', 'free'] },
      { id: 'night-1', no: '201', category: 'daily-pg', billing: 'night', price: 800, deposit: 0, beds: ['free', 'free'] },
      { id: 'flat-1', no: '301', category: 'flat-1bhk', basis: 'room', price: 18000, deposit: 18000, beds: ['free', 'free'] },
      { id: 'full-1', no: '401', price: 7000, deposit: 7000, beds: ['taken', 'taken'] },
    ])
  })

  it('needs Supabase', () => {
    setConfigured(false)
    setAuth({ configured: false })
    at()
    expect(screen.getByText(/Booking is not available until Supabase is configured/)).toBeInTheDocument()
  })
  it('sends signed-out visitors to log in and brings them back', async () => {
    setAuth()
    at()
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/login?next=%2Fbook%2Fpg-1'))
  })
  it('only customers can book', async () => {
    asRole('employee')
    at()
    expect(await screen.findByText(/Only customer accounts can book/)).toBeInTheDocument()
  })
  it('says so when the room does not exist', async () => {
    at('nope')
    expect(await screen.findByText(/That room does not exist/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all rooms' })).toHaveAttribute('href', '/rooms')
  })
  it('shows an error box when the catalogue cannot load', async () => {
    db.tables.beds = { data: null, error: new Error('beds down') }
    at()
    expect(await screen.findByRole('alert')).toHaveTextContent('beds down')
  })

  describe('monthly per-bed room', () => {
    it('shows the room, its price and free beds', async () => {
      at()
      expect(await screen.findByRole('heading', { name: 'Book room 101' })).toBeInTheDocument()
      expect(screen.getByText('₹7,500 / bed / month')).toBeInTheDocument()
      expect(screen.getByText(/3 of 3 beds free/)).toBeInTheDocument()
    })
    it('totals first month rent plus deposit for one bed', async () => {
      at()
      await screen.findByText('First month rent')
      expect(money('First month rent')).toBe('₹7,500')
      expect(money('Security deposit')).toBe('₹7,500')
      expect(money('Due now')).toBe('₹15,000')
    })
    it('scales rent and deposit with the number of beds', async () => {
      at()
      await screen.findByText('First month rent')
      await userEvent.selectOptions(screen.getByLabelText('Number of beds'), '2')
      expect(money('Due now')).toBe('₹30,000')
    })
    it('offers no more beds than are free', async () => {
      at()
      const select = await screen.findByLabelText('Number of beds')
      expect(within(select).getAllByRole('option').map((o) => o.value)).toEqual(['1', '2', '3'])
    })
    it('has no check-out field (open-ended stay)', async () => {
      at()
      await screen.findByText('First month rent')
      expect(screen.queryByLabelText('Check-out')).not.toBeInTheDocument()
    })
    it('books the room with null check-out and goes to the account page', async () => {
      db.rpcs.book_room = { data: 'booking-1', error: null }
      at()
      await screen.findByText('First month rent')
      await userEvent.selectOptions(screen.getByLabelText('Number of beds'), '2')
      await userEvent.click(screen.getByRole('button', { name: 'Reserve beds' }))
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/account'))
      const [name, args] = supabase.rpc.mock.calls.find((c) => c[0] === 'book_room')
      expect(name).toBe('book_room')
      expect(args).toMatchObject({ p_room_id: 'pg-1', p_bed_count: 2, p_check_out: null })
      expect(args.p_check_in).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
    it('shows the database error and refreshes availability when the booking fails', async () => {
      db.rpcs.book_room = { data: null, error: new Error('Only 1 bed is free') }
      at()
      await screen.findByText('First month rent')
      const before = supabase.from.mock.calls.length
      await userEvent.click(screen.getByRole('button', { name: 'Reserve beds' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Only 1 bed is free')
      await waitFor(() => expect(supabase.from.mock.calls.length).toBeGreaterThan(before))
      expect(screen.queryByTestId('where')).toBeNull() // stayed on the booking page
    })
  })

  describe('nightly room', () => {
    it('charges per night with no deposit and asks for a check-out date', async () => {
      at('night-1')
      await screen.findByText('Rent (1 night)')
      expect(money('Rent (1 night)')).toBe('₹800')
      expect(screen.queryByText('Security deposit')).not.toBeInTheDocument()
      expect(money('Due now')).toBe('₹800')
      expect(screen.getByLabelText('Check-out')).toBeRequired()
    })
    it('multiplies rent by the number of nights', async () => {
      at('night-1')
      const checkIn = await screen.findByLabelText('Check-in')
      fireEvent.change(checkIn, { target: { value: '2030-01-10' } })
      fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2030-01-13' } })
      expect(money('Rent (3 nights)')).toBe('₹2,400')
    })
    it('moves check-out forward when check-in is set to or past it', async () => {
      at('night-1')
      const checkIn = await screen.findByLabelText('Check-in')
      fireEvent.change(checkIn, { target: { value: '2030-02-01' } })
      expect(screen.getByLabelText('Check-out')).toHaveValue('2030-02-02')
    })
    it('disables booking when the stay is less than one night', async () => {
      at('night-1')
      await screen.findByLabelText('Check-out')
      fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2000-01-01' } })
      expect(screen.getByRole('button', { name: 'Reserve beds' })).toBeDisabled()
    })
    it('sends the check-out date', async () => {
      at('night-1')
      const checkIn = await screen.findByLabelText('Check-in')
      fireEvent.change(checkIn, { target: { value: '2030-01-10' } })
      fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2030-01-12' } })
      await userEvent.click(screen.getByRole('button', { name: 'Reserve beds' }))
      await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('book_room', {
        p_room_id: 'night-1', p_bed_count: 1, p_check_in: '2030-01-10', p_check_out: '2030-01-12',
      }))
    })
  })

  describe('whole-room rental', () => {
    it('takes every bed and has no bed picker', async () => {
      at('flat-1')
      expect(await screen.findByText(/rented as a whole, so the booking takes all 2 beds/)).toBeInTheDocument()
      expect(screen.queryByLabelText('Number of beds')).not.toBeInTheDocument()
      expect(money('First month rent')).toBe('₹18,000')
      expect(money('Due now')).toBe('₹36,000')
    })
  })

  describe('room with no free beds', () => {
    it('cannot be reserved', async () => {
      at('full-1')
      const button = await screen.findByRole('button', { name: 'Not available' })
      expect(button).toBeDisabled()
    })
  })
})

// ------------------------------------------------------------------ Home, Amenities, Location, Legal
describe('Home page', () => {
  beforeEach(() => setConfigured(false))

  it('has every section with the id the navbar links to', async () => {
    const { container } = renderAt(<Home />)
    await screen.findByText('Explore All Rooms')
    ;['home', 'rooms-preview', 'reviews', 'faq', 'contact'].forEach((id) => {
      expect(container.querySelector(`#${id}`), id).toBeInTheDocument()
    })
    ;['rooms-preview', 'reviews', 'faq', 'contact'].forEach((id) => {
      expect(container.querySelector(`section#${id}`).className).toContain('scroll-mt-16')
    })
  })
  it('previews three rooms and links to all rooms', async () => {
    renderAt(<Home />)
    const link = await screen.findByRole('link', { name: 'Explore All Rooms' })
    expect(link).toHaveAttribute('href', '/rooms')
    const preview = link.closest('section')
    expect(within(preview).getAllByRole('article')).toHaveLength(3)
  })
  it('shows the empty reviews state, the FAQ and the call button', async () => {
    renderAt(<Home />)
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument()
    expect(screen.getByText('How do I book a bed or room?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: `Call ${brand.phone}` })).toHaveAttribute('href', `tel:+91${brand.phone}`)
    expect(screen.getByText(brand.address)).toBeInTheDocument()
  })
  it('the hero button scrolls to the rooms preview section', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderAt(<Home />)
    await userEvent.click(screen.getByRole('button', { name: 'See available stays' }))
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
  it('shows an error box if the catalogue fails to load', async () => {
    setConfigured(true)
    db.tables.categories = { data: null, error: new Error('catalog failed') }
    renderAt(<Home />)
    expect(await screen.findByText('catalog failed')).toBeInTheDocument()
  })
})

describe('Amenities page', () => {
  beforeEach(() => setConfigured(false))

  it('lists every amenity with its description', async () => {
    renderAt(<Amenities />)
    expect(await screen.findByRole('heading', { name: /Gym/ })).toBeInTheDocument()
    ;['AC & Non-AC rooms', 'Gaming zone', 'Pickleball court', 'Chill café area', 'Security guard'].forEach((t) => {
      expect(screen.getByRole('heading', { name: new RegExp(t) })).toBeInTheDocument()
    })
  })
  it('labels real facility photos and uses an icon tile when there is no photo', async () => {
    renderAt(<Amenities />)
    await screen.findByRole('heading', { name: /Gym/ })
    expect(screen.getByAltText('Gym at YOLO Nest')).toBeInTheDocument()
    expect(screen.getAllByText('Actual photo · YOLO Nest').length).toBeGreaterThan(0)
    const guard = screen.getByRole('heading', { name: /Security guard/ }).closest('article')
    expect(within(guard).queryByRole('img')).not.toBeInTheDocument()
    expect(within(guard).queryByText('Actual photo · YOLO Nest')).not.toBeInTheDocument()
  })
  it('links to the rooms page', async () => {
    renderAt(<Amenities />)
    expect(await screen.findByRole('link', { name: 'See available rooms' })).toHaveAttribute('href', '/rooms')
  })
})

describe('Location page', () => {
  it('embeds the map for the PG address and links to directions', () => {
    renderAt(<Location />)
    const frame = screen.getByTitle('YOLO Nest on Google Maps')
    expect(frame.getAttribute('src')).toContain(encodeURIComponent(brand.mapQuery))
    expect(screen.getByRole('link', { name: 'Get directions' }).getAttribute('href')).toContain(encodeURIComponent(brand.mapQuery))
    expect(screen.getByRole('link', { name: `Call ${brand.phone}` })).toHaveAttribute('href', `tel:+91${brand.phone}`)
    expect(screen.getByText(brand.address)).toBeInTheDocument()
  })
  it('lists nearby places nearest first', () => {
    renderAt(<Location />)
    const names = within(screen.getByRole('heading', { name: 'Nearby places' }).nextElementSibling)
      .getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    const expected = [...nearby].sort((a, b) => parseFloat(a.km) - parseFloat(b.km)).map((n) => n.name)
    expect(names).toEqual(expected)
  })
  it('mentions the metro and the work hub', () => {
    renderAt(<Location />)
    expect(screen.getByText(/Metro: Hinjawadi Phase 1 Metro Station/)).toBeInTheDocument()
    expect(screen.getByText(/Work: Rajiv Gandhi Infotech Park/)).toBeInTheDocument()
  })
})

describe('Legal pages', () => {
  it('Privacy policy has its title and the draft warning', () => {
    renderAt(<Privacy />)
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeInTheDocument()
    expect(screen.getByText(/Draft text for the demo/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What we collect' })).toBeInTheDocument()
  })
  it('Terms page has its title and the draft warning', () => {
    renderAt(<Terms />)
    expect(screen.getByRole('heading', { level: 1, name: /Terms/ })).toBeInTheDocument()
    expect(screen.getByText(/Draft text for the demo/)).toBeInTheDocument()
  })
})
