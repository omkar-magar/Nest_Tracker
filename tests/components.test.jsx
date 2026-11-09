import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

import { db, resetMock, setConfigured } from './helpers/supabaseMock.js'
import { renderAt } from './helpers/render.jsx'
import Img from '../src/components/Img'
import RoomCard from '../src/components/RoomCard'
import Faq from '../src/components/Faq'
import Footer from '../src/components/Footer'
import Reviews from '../src/components/Reviews'
import NearbyMap from '../src/components/NearbyMap'
import Hero from '../src/components/Hero'
import { FOCUS_MS, REST_MS } from '../src/hooks/useFocusTour'
import ContactButtons from '../src/components/dashboard/ContactButtons'
import DuesTable from '../src/components/dashboard/DuesTable'
import RoomsBoard, { bedCounts } from '../src/components/dashboard/RoomsBoard'
import { Badge, Button, Empty, ErrorBox, Field, Notice, PageHeader, Section, Spinner, Stat, Table } from '../src/components/ui'
import { brand, faqs, nearby } from '../src/data/site'

beforeEach(resetMock)

// ------------------------------------------------------------------ ui.jsx
describe('ui primitives', () => {
  it('Button renders a <button type=button> by default', () => {
    renderAt(<Button>Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button')
  })
  it('Button with `to` renders a router link', () => {
    renderAt(<Button to="/rooms">Rooms</Button>)
    expect(screen.getByRole('link', { name: 'Rooms' })).toHaveAttribute('href', '/rooms')
  })
  it('Button with `href` renders a plain anchor', () => {
    renderAt(<Button href="tel:+918483878098">Call</Button>)
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+918483878098')
  })
  it('Button fires onClick but not when disabled', async () => {
    const fn = vi.fn()
    renderAt(<><Button onClick={fn}>On</Button><Button disabled onClick={fn}>Off</Button></>)
    await userEvent.click(screen.getByRole('button', { name: 'On' }))
    await userEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('Button variants use theme colours only', () => {
    renderAt(<><Button variant="sun">S</Button><Button variant="danger">D</Button></>)
    expect(screen.getByText('S').className).toContain('bg-sun')
    expect(screen.getByText('D').className).toContain('text-red-700')
  })
  it('Button keeps a visible keyboard focus style', () => {
    renderAt(<Button>Focus</Button>)
    expect(screen.getByRole('button').className).toContain('focus-visible:outline-2')
  })
  it('Spinner announces its label', () => {
    render(<Spinner label="Loading rooms" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading rooms…')
  })
  it('ErrorBox renders nothing without an error', () => {
    const { container } = render(<ErrorBox error={null} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('ErrorBox shows the message and a working retry button', async () => {
    const retry = vi.fn()
    render(<ErrorBox error={new Error('Network down')} onRetry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Network down')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalled()
  })
  it('ErrorBox accepts a non-Error value', () => {
    render(<ErrorBox error="plain string" />)
    expect(screen.getByRole('alert')).toHaveTextContent('plain string')
  })
  it('Notice is a status region', () => {
    render(<Notice tone="warn">Heads up</Notice>)
    expect(screen.getByRole('status')).toHaveTextContent('Heads up')
  })
  it('Empty shows a title and optional detail', () => {
    render(<Empty title="Nothing here">Try later</Empty>)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('Try later')).toBeInTheDocument()
  })
  it('Badge applies its tone', () => {
    render(<Badge tone="green">Paid</Badge>)
    expect(screen.getByText('Paid').className).toContain('bg-green-100')
  })
  it('Stat shows label, value, hint, and red tone', () => {
    render(<Stat label="Outstanding" value="₹500" hint="1 overdue" tone="red" />)
    expect(screen.getByText('Outstanding')).toBeInTheDocument()
    expect(screen.getByText('₹500').className).toContain('text-red-700')
    expect(screen.getByText('1 overdue')).toBeInTheDocument()
  })
  it('Field labels its control', () => {
    render(<Field label="Email"><input /></Field>)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })
  it('Section has the id and the sticky-header scroll offset', () => {
    const { container } = render(<Section id="faq" title="FAQ">x</Section>)
    const s = container.querySelector('section')
    expect(s).toHaveAttribute('id', 'faq')
    expect(s.className).toContain('scroll-mt-16')
    expect(screen.getByRole('heading', { level: 2, name: 'FAQ' })).toBeInTheDocument()
  })
  it('PageHeader renders an h1 and intro', () => {
    render(<PageHeader title="Rooms" intro="All rooms" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Rooms' })).toBeInTheDocument()
    expect(screen.getByText('All rooms')).toBeInTheDocument()
  })
  it('Table renders column headers with scope=col and its rows', () => {
    render(<Table head={['Name', 'Amount']}><tr><td>Asha</td><td>10</td></tr></Table>)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Amount'])
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('scope', 'col')
    expect(screen.getByRole('cell', { name: 'Asha' })).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ Img
describe('Img', () => {
  it('renders a lazy image with alt text', () => {
    render(<Img src="/images/rooms/a.webp" alt="Room A" />)
    const img = screen.getByAltText('Room A')
    expect(img).toHaveAttribute('src', '/images/rooms/a.webp')
    expect(img).toHaveAttribute('loading', 'lazy')
  })
  it('falls back to the .jpg of the same name, then to a placeholder', () => {
    render(<Img src="/images/rooms/a.webp" alt="Room A" className="h-10" />)
    fireEvent.error(screen.getByAltText('Room A'))
    expect(screen.getByAltText('Room A')).toHaveAttribute('src', '/images/rooms/a.jpg')
    fireEvent.error(screen.getByAltText('Room A'))
    const placeholder = screen.getByRole('img', { name: 'Room A' })
    expect(placeholder.tagName).toBe('DIV')
    expect(placeholder.className).toContain('h-10')
  })
  it('goes straight to the placeholder when the source is already a .jpg', () => {
    render(<Img src="/x.jpg" alt="X" />)
    fireEvent.error(screen.getByAltText('X'))
    expect(screen.getByRole('img', { name: 'X' }).tagName).toBe('DIV')
  })
  it('priority loads at once and at high priority', () => {
    render(<Img src="/a.webp" alt="Top" priority />)
    const img = screen.getByAltText('Top')
    expect(img).toHaveAttribute('loading', 'eager')
    expect(img).toHaveAttribute('fetchpriority', 'high')
  })
  it('shows a pale block until the photo has loaded', () => {
    render(<Img src="/a.webp" alt="Pic" className="h-10" />)
    const img = screen.getByAltText('Pic')
    expect(img.className).toContain('bg-navy/5')
    fireEvent.load(img)
    expect(img.className).not.toContain('bg-navy/5')
  })
  it('drops srcSet when the file fails, so the fallback is not overridden', () => {
    render(<Img src="/a.webp" srcSet="/a-400.webp 400w, /a.webp 800w" sizes="400px" alt="Pic" />)
    expect(screen.getByAltText('Pic')).toHaveAttribute('srcset')
    fireEvent.error(screen.getByAltText('Pic'))
    expect(screen.getByAltText('Pic')).not.toHaveAttribute('srcset')
  })
  it('also falls back from .png', () => {
    render(<Img src="/x.png" alt="X" />)
    fireEvent.error(screen.getByAltText('X'))
    expect(screen.getByAltText('X')).toHaveAttribute('src', '/x.jpg')
  })
})

// ------------------------------------------------------------------ RoomCard
describe('RoomCard', () => {
  const bed = (over = {}) => ({ id: Math.random(), status: 'available', is_occupied: false, ...over })
  const room = (over = {}) => ({
    id: 'pg-101', category: 'monthly-pg', no: '101', floor: 1, type: 'AC', features: ['AC', 'Furnished'], image: '/images/rooms/pg-101.webp',
    rentBasis: 'bed', billing: 'month', price: 7500, deposit: 7500, beds: [bed(), bed()], totalBeds: 2, ...over,
  })
  const show = (r) => renderAt(<RoomCard room={r} categoryName="Monthly PG" />)

  it('shows number, category, floor, price and deposit', () => {
    show(room())
    expect(screen.getByRole('heading', { name: 'Room 101' })).toBeInTheDocument()
    expect(screen.getByText('Monthly PG · Floor 1')).toBeInTheDocument()
    expect(screen.getByText('₹7,500 / bed / month')).toBeInTheDocument()
    expect(screen.getByText('Deposit ₹7,500')).toBeInTheDocument()
    expect(screen.getByAltText('Room 101, AC')).toBeInTheDocument()
  })
  it('hides the deposit line when there is none', () => {
    show(room({ deposit: 0 }))
    expect(screen.queryByText(/Deposit/)).not.toBeInTheDocument()
  })
  it('lists each feature once (type is not repeated)', () => {
    show(room())
    const list = screen.getByRole('list', { name: 'Features' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['AC', 'Furnished'])
  })
  it('available: green badge, free beds and a Book link', () => {
    show(room())
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.getByText('2 of 2 beds free')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Book this room' })).toHaveAttribute('href', '/book/pg-101')
  })
  it('partially occupied: counts free beds', () => {
    show(room({ beds: [bed(), bed({ is_occupied: true })] }))
    expect(screen.getByText('Partially occupied')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 beds free')).toBeInTheDocument()
  })
  it('fully booked: a disabled button instead of a link', () => {
    show(room({ beds: [bed({ is_occupied: true }), bed({ is_occupied: true })] }))
    expect(screen.getByText('Fully booked', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fully booked' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: /Book/ })).not.toBeInTheDocument()
  })
  it('unavailable (maintenance): disabled "Unavailable" button', () => {
    show(room({ beds: [bed({ status: 'maintenance' }), bed({ status: 'maintenance' })] }))
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled()
  })
  it('whole-room rentals say so', () => {
    show(room({ rentBasis: 'room', billing: 'night', price: 1500, deposit: 0 }))
    expect(screen.getByText('2 beds, whole room')).toBeInTheDocument()
    expect(screen.getByText('₹1,500 / night')).toBeInTheDocument()
  })
  it('without a backend: availability is not connected but the room can still be opened', () => {
    show(room({ beds: null }))
    expect(screen.getByText('Availability not connected')).toBeInTheDocument()
    expect(screen.getByText('2 beds')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Book this room' })).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ Faq / Footer
describe('Faq', () => {
  it('renders every question as a collapsible <details> with its answer', () => {
    const { container } = render(<Faq />)
    expect(container.querySelectorAll('details')).toHaveLength(faqs.length)
    faqs.forEach((f) => {
      expect(screen.getByText(f.q)).toBeInTheDocument()
      expect(screen.getByText(f.a)).toBeInTheDocument()
    })
  })
  it('starts collapsed and opens on click', async () => {
    const { container } = render(<Faq />)
    const first = container.querySelector('details')
    expect(first.open).toBe(false)
    await userEvent.click(within(first).getByText(faqs[0].q))
    expect(first.open).toBe(true)
  })
})

describe('Footer', () => {
  it('links to the main pages and policies', () => {
    renderAt(<Footer />)
    const href = (name) => screen.getByRole('link', { name }).getAttribute('href')
    expect(href('Rooms')).toBe('/rooms')
    expect(href('Amenities')).toBe('/amenities')
    expect(href('Location')).toBe('/location')
    expect(href('Privacy policy')).toBe('/privacy')
    expect(href('Terms and conditions')).toBe('/terms')
    expect(href('Log in')).toBe('/login')
    expect(href('Create an account')).toBe('/signup')
  })
  it('shows the phone, WhatsApp link and address from brand data', () => {
    renderAt(<Footer />)
    expect(screen.getByRole('link', { name: brand.phone })).toHaveAttribute('href', `tel:+91${brand.phone}`)
    expect(screen.getByRole('link', { name: 'WhatsApp us' })).toHaveAttribute('href', `https://wa.me/91${brand.phone}`)
    expect(screen.getByText(brand.address)).toBeInTheDocument()
  })
  it('hides the social block while there are no links, and shows the current year', () => {
    renderAt(<Footer />)
    expect(screen.queryByLabelText('Social media')).not.toBeInTheDocument()
    expect(screen.getByText(new RegExp(String(new Date().getFullYear())))).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ Reviews
describe('Reviews', () => {
  it('without a backend says reviews appear once the site is connected', async () => {
    setConfigured(false)
    render(<Reviews />)
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument()
    expect(screen.getByText(/once the site is connected/)).toBeInTheDocument()
  })
  it('with a backend but no reviews points residents to their dashboard', async () => {
    db.tables.reviews = { data: [], error: null }
    renderAt(<Reviews />)
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'dashboard' })).toHaveAttribute('href', '/account')
  })
  it('lists published reviews with stars, author and date', async () => {
    db.tables.reviews = {
      data: [{ id: 1, author_name: 'Asha', rating: 4, body: 'Lovely place', created_at: '2026-10-01T00:00:00Z' }],
      error: null,
    }
    render(<Reviews />)
    expect(await screen.findByText(/Lovely place/)).toBeInTheDocument()
    expect(screen.getByText('Asha')).toBeInTheDocument()
    expect(screen.getByLabelText('4 out of 5 stars')).toBeInTheDocument()
  })
  it('shows an error box with retry when loading fails', async () => {
    db.tables.reviews = { data: null, error: new Error('db down') }
    render(<Reviews />)
    expect(await screen.findByRole('alert')).toHaveTextContent('db down')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ Hero / NearbyMap
describe('NearbyMap', () => {
  it('describes the map and exposes each place as a button', () => {
    render(<NearbyMap />)
    expect(screen.getByRole('img', { name: /Map of places near/ })).toBeInTheDocument()
    nearby.forEach((p) => expect(screen.getByRole('button', { name: `${p.name}, ${p.km} km` })).toBeInTheDocument())
  })
  it('starts on the featured place and switches the info card on click', async () => {
    render(<NearbyMap />)
    const featured = nearby.find((p) => p.featured)
    expect(screen.getByRole('button', { name: `${featured.name}, ${featured.km} km` })).toHaveAttribute('aria-pressed', 'true')
    const other = nearby.find((p) => !p.featured)
    await userEvent.click(screen.getByRole('button', { name: `${other.name}, ${other.km} km` }))
    expect(screen.getByRole('button', { name: `${other.name}, ${other.km} km` })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(other.note)).toBeInTheDocument()
  })
  it('is keyboard operable (Enter selects a place)', () => {
    render(<NearbyMap />)
    const other = nearby.find((p) => !p.featured)
    const pin = screen.getByRole('button', { name: `${other.name}, ${other.km} km` })
    fireEvent.keyDown(pin, { key: 'Enter' })
    expect(pin).toHaveAttribute('aria-pressed', 'true')
  })
  describe('auto rotation', () => {
    const pressed = () => screen.getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'true').getAttribute('aria-label')
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('moves to the next place every few seconds', () => {
      render(<NearbyMap />)
      const first = pressed()
      act(() => { vi.advanceTimersByTime(3500) })
      expect(pressed()).not.toBe(first)
    })
    it('stops rotating once the visitor picks a place', () => {
      render(<NearbyMap />)
      const target = nearby.find((p) => !p.featured)
      fireEvent.click(screen.getByRole('button', { name: `${target.name}, ${target.km} km` }))
      act(() => { vi.advanceTimersByTime(20000) })
      expect(pressed()).toBe(`${target.name}, ${target.km} km`)
    })
  })
})

describe('Hero', () => {
  it('has the home section id, a heading and a CTA that scrolls to rooms-preview', async () => {
    const scrollTo = vi.fn()
    const { container } = renderAt(<Hero scrollTo={scrollTo} />)
    expect(container.querySelector('section#home')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Premium co-living')
    await userEvent.click(screen.getByRole('button', { name: 'See available stays' }))
    expect(scrollTo).toHaveBeenCalledWith('rooms-preview')
  })
  it('downloads only the background photo for the current screen size', () => {
    const urls = (c) => [...c.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    const narrow = renderAt(<Hero scrollTo={() => {}} />)
    expect(urls(narrow.container)).toContain('/images/background/mbg.jpg')
    expect(urls(narrow.container)).not.toContain('/images/hero/bg.webp')
    narrow.unmount()

    const original = window.matchMedia
    window.matchMedia = (q) => ({ ...original(q), matches: true })
    try {
      const wide = renderAt(<Hero scrollTo={() => {}} />)
      expect(urls(wide.container)).toContain('/images/hero/bg.webp')
      expect(urls(wide.container)).not.toContain('/images/background/mbg.jpg')
    } finally {
      window.matchMedia = original
    }
  })
  it('shows amenity info on focus and hides it again on blur', () => {
    renderAt(<Hero scrollTo={() => {}} />)
    const gym = screen.getByRole('button', { name: 'Gym' })
    const info = screen.getByText('Fully equipped gym open all day for residents.')
    expect(info.parentElement.className).toContain('opacity-0')
    fireEvent.focus(gym)
    expect(info.parentElement.className).toContain('opacity-100')
    fireEvent.blur(gym)
    expect(info.parentElement.className).toContain('opacity-0')
  })

  describe('timed amenity tour', () => {
    const shown = (text) => screen.getByText(text).parentElement.className.includes('opacity-100')
    const GYM = 'Fully equipped gym open all day for residents.'
    const GAMING = 'Console and board games to unwind after work.'
    const advance = (ms) => act(() => { vi.advanceTimersByTime(ms) })

    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('focuses each photo in turn, with nothing in focus between them', () => {
      renderAt(<Hero scrollTo={() => {}} />)
      expect(shown(GYM)).toBe(false)
      advance(REST_MS)
      expect(shown(GYM)).toBe(true)
      advance(FOCUS_MS)
      expect(shown(GYM)).toBe(false)
      expect(shown(GAMING)).toBe(false)
      advance(REST_MS)
      expect(shown(GAMING)).toBe(true)
    })
    it('waits while the visitor has a photo open, then carries on', () => {
      renderAt(<Hero scrollTo={() => {}} />)
      const gaming = screen.getByRole('button', { name: 'Gaming Zone' })
      fireEvent.focus(gaming)
      advance((REST_MS + FOCUS_MS) * 3)
      expect(shown(GAMING)).toBe(true)
      expect(shown(GYM)).toBe(false)
      fireEvent.blur(gaming)
      expect(shown(GAMING)).toBe(false)
      advance(REST_MS)
      expect(shown(GYM)).toBe(true)
    })
    it('stops once the photos are mostly scrolled away, even if the browser still reports them as intersecting', () => {
      let report
      vi.stubGlobal('IntersectionObserver', class {
        constructor(callback) { report = (ratio) => callback([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]) }
        observe() {}
        disconnect() {}
      })
      try {
        renderAt(<Hero scrollTo={() => {}} />)
        advance(REST_MS)
        expect(shown(GYM)).toBe(false) // not reported on screen yet
        act(() => report(1))
        advance(REST_MS)
        expect(shown(GYM)).toBe(true)
        act(() => report(0.2))
        expect(shown(GYM)).toBe(false)
        advance((REST_MS + FOCUS_MS) * 3)
        expect(shown(GYM)).toBe(false)
        expect(shown(GAMING)).toBe(false)
      } finally {
        vi.unstubAllGlobals()
      }
    })
    it('stays still for visitors who prefer reduced motion', () => {
      const original = window.matchMedia
      window.matchMedia = (q) => ({ ...original(q), matches: q.includes('reduced-motion') })
      try {
        renderAt(<Hero scrollTo={() => {}} />)
        advance((REST_MS + FOCUS_MS) * 3)
        expect(shown(GYM)).toBe(false)
        expect(shown(GAMING)).toBe(false)
      } finally {
        window.matchMedia = original
      }
    })
  })
})

// ------------------------------------------------------------------ dashboard: ContactButtons
describe('ContactButtons', () => {
  it('shows "No contact access" without a phone number', () => {
    render(<ContactButtons phone={null} />)
    expect(screen.getByText('No contact access')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
  it('builds WhatsApp, call and SMS links with the +91 prefix for a 10-digit number', () => {
    render(<ContactButtons phone="9876543210" message="Pay now & thanks" />)
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/919876543210?text=Pay%20now%20%26%20thanks')
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+919876543210')
    expect(screen.getByRole('link', { name: 'SMS' })).toHaveAttribute('href', 'sms:+919876543210?body=Pay%20now%20%26%20thanks')
  })
  it('does not double the country code on a number that already has it', () => {
    render(<ContactButtons phone="919876543210" />)
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+919876543210')
  })
  it('omits the message parameters when there is no message', () => {
    render(<ContactButtons phone="9876543210" />)
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/919876543210')
    expect(screen.getByRole('link', { name: 'SMS' })).toHaveAttribute('href', 'sms:+919876543210')
  })
  it('opens WhatsApp in a new tab safely', () => {
    render(<ContactButtons phone="9876543210" />)
    const a = screen.getByRole('link', { name: 'WhatsApp' })
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noreferrer')
  })
})

// ------------------------------------------------------------------ dashboard: DuesTable
describe('DuesTable', () => {
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const rows = [
    { customer_id: 1, full_name: 'Asha Rao', room_no: '101', beds: 'A', phone: '9876543210', next_due_date: day(-3), days_overdue: 3, next_due_amount: 7500, booking_status: 'active' },
    { customer_id: 2, full_name: 'Bala Singh', room_no: '102', beds: 'B', phone: '9123456780', next_due_date: day(3), days_overdue: 0, next_due_amount: null, booking_status: 'active' },
    { customer_id: 3, full_name: 'Chitra Nair', room_no: '201', beds: null, phone: '9000000001', next_due_date: day(30), days_overdue: 0, next_due_amount: null, booking_status: 'active' },
    { customer_id: 4, full_name: 'Dev Patil', room_no: '202', beds: null, phone: null, next_due_date: null, days_overdue: 0, next_due_amount: null, booking_status: 'pending' },
  ]
  const names = () => screen.queryAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)

  it('lists everyone with counts on the filter buttons', () => {
    render(<DuesTable rows={rows} />)
    expect(names()).toEqual(['Asha Rao', 'Bala Singh', 'Chitra Nair', 'Dev Patil'])
    expect(screen.getByRole('button', { name: 'All (4)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Overdue (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Due in 7 days (1)' })).toBeInTheDocument()
  })
  it('shows the right status badge for each customer', () => {
    render(<DuesTable rows={rows} />)
    expect(screen.getByText('3 days overdue')).toBeInTheDocument()
    expect(screen.getByText('Due soon')).toBeInTheDocument()
    expect(screen.getByText('Up to date')).toBeInTheDocument()
    expect(screen.getByText('Awaiting payment')).toBeInTheDocument()
  })
  it('filters to overdue customers', async () => {
    render(<DuesTable rows={rows} />)
    await userEvent.click(screen.getByRole('button', { name: /Overdue/ }))
    expect(names()).toEqual(['Asha Rao'])
  })
  it('filters to customers due within 7 days', async () => {
    render(<DuesTable rows={rows} />)
    await userEvent.click(screen.getByRole('button', { name: /Due in 7 days/ }))
    expect(names()).toEqual(['Bala Singh'])
  })
  it('searches by name (case-insensitive)', async () => {
    render(<DuesTable rows={rows} />)
    await userEvent.type(screen.getByLabelText('Search customers'), 'bALA')
    expect(names()).toEqual(['Bala Singh'])
  })
  it('searches by room number', async () => {
    render(<DuesTable rows={rows} />)
    await userEvent.type(screen.getByLabelText('Search customers'), '20')
    expect(names()).toEqual(['Chitra Nair', 'Dev Patil'])
  })
  it('shows an empty state when nobody matches', async () => {
    render(<DuesTable rows={rows} />)
    await userEvent.type(screen.getByLabelText('Search customers'), 'zzz')
    expect(screen.getByText('Nobody matches')).toBeInTheDocument()
  })
  it('shows the Amount column only when the database returned amounts', () => {
    const { unmount } = render(<DuesTable rows={rows} />)
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument()
    expect(screen.getByText('₹7,500')).toBeInTheDocument()
    unmount()
    render(<DuesTable rows={rows.map((r) => ({ ...r, next_due_amount: null }))} />)
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).not.toBeInTheDocument()
  })
  it('builds an overdue reminder for overdue customers and a gentle one otherwise', () => {
    render(<DuesTable rows={rows} />)
    const links = screen.getAllByRole('link', { name: 'WhatsApp' }).map((a) => decodeURIComponent(a.getAttribute('href')))
    expect(links[0]).toContain('Hi Asha Rao')
    expect(links[0]).toContain('is overdue')
    expect(links[1]).toContain('A reminder that your payment is due')
  })
  it('shows "No contact access" for rows without a phone', () => {
    render(<DuesTable rows={rows} />)
    expect(screen.getByText('No contact access')).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ dashboard: RoomsBoard
describe('bedCounts', () => {
  it('totals rooms, beds, occupied, maintenance and free beds', () => {
    const rooms = [
      { beds: [{ is_occupied: true, status: 'available' }, { is_occupied: false, status: 'available' }] },
      { beds: [{ is_occupied: false, status: 'maintenance' }] },
    ]
    expect(bedCounts(rooms)).toEqual({ rooms: 2, beds: 3, occupied: 1, maintenance: 1, available: 1 })
  })
})

describe('RoomsBoard', () => {
  const rooms = [
    { id: 'r1', room_no: '101', floor: 1, ac_type: 'AC', beds: [
      { id: 'b2', label: 'B', status: 'available', is_occupied: true },
      { id: 'b1', label: 'A', status: 'available', is_occupied: false },
    ] },
    { id: 'r2', room_no: '102', floor: 1, ac_type: 'Non-AC', beds: [{ id: 'b3', label: 'A', status: 'available', is_occupied: true }] },
    { id: 'r3', room_no: '103', floor: 1, ac_type: 'AC', beds: [{ id: 'b4', label: 'A', status: 'maintenance', is_occupied: false }] },
  ]
  beforeEach(() => { db.tables.rooms = { data: rooms, error: null } })

  it('summarises beds and labels each room by occupancy', async () => {
    render(<RoomsBoard />)
    expect(await screen.findByText(/3 rooms · 4 beds · 1 free · 2 occupied · 1 under maintenance/)).toBeInTheDocument()
    expect(screen.getByText('Partially occupied', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('Fully occupied', { selector: 'span' })).toBeInTheDocument()
  })
  it('sorts beds by label inside a room', async () => {
    render(<RoomsBoard />)
    await screen.findByText('Room 101', { exact: false })
    const card = screen.getByText('Room 101', { exact: false }).closest('div').parentElement
    const labels = within(card).getAllByText(/^Bed [AB]:/).map((e) => e.textContent)
    expect(labels).toEqual(['Bed A: Free', 'Bed B: Occupied'])
  })
  it('filters by room state', async () => {
    render(<RoomsBoard />)
    await screen.findByText(/3 rooms/)
    await userEvent.click(screen.getByRole('button', { name: 'Fully occupied' }))
    expect(screen.getByText('Room 102', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('Room 101', { exact: false })).not.toBeInTheDocument()
  })
  it('read-only for staff without the manage permission', async () => {
    render(<RoomsBoard canManage={false} />)
    await screen.findByText(/3 rooms/)
    expect(screen.queryByTitle('Toggle maintenance')).not.toBeInTheDocument()
  })
  it('with permission, free and maintenance beds can be toggled, occupied ones cannot', async () => {
    render(<RoomsBoard canManage />)
    await screen.findByText(/3 rooms/)
    const toggles = screen.getAllByTitle('Toggle maintenance').map((b) => b.textContent)
    expect(toggles).toEqual(['Bed A: Free', 'Bed A: Maintenance'])
  })
  it('toggling a free bed asks the database to put it under maintenance', async () => {
    const { supabase } = await import('./helpers/supabaseMock.js')
    render(<RoomsBoard canManage />)
    await screen.findByText(/3 rooms/)
    await userEvent.click(screen.getByRole('button', { name: 'Bed A: Free' }))
    expect(supabase.rpc).toHaveBeenCalledWith('set_bed_status', { p_bed_id: 'b1', p_status: 'maintenance' })
  })
  it('toggling a maintenance bed puts it back to available', async () => {
    const { supabase } = await import('./helpers/supabaseMock.js')
    render(<RoomsBoard canManage />)
    await screen.findByText(/3 rooms/)
    await userEvent.click(screen.getByRole('button', { name: 'Bed A: Maintenance' }))
    expect(supabase.rpc).toHaveBeenCalledWith('set_bed_status', { p_bed_id: 'b4', p_status: 'available' })
  })
  it('shows the database error when a toggle is refused', async () => {
    db.rpcs.set_bed_status = { data: null, error: new Error('No permission') }
    render(<RoomsBoard canManage />)
    await screen.findByText(/3 rooms/)
    await userEvent.click(screen.getByRole('button', { name: 'Bed A: Free' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No permission')
  })
  it('shows an error box when rooms cannot be loaded', async () => {
    db.tables.rooms = { data: null, error: new Error('rooms down') }
    render(<RoomsBoard />)
    expect(await screen.findByRole('alert')).toHaveTextContent('rooms down')
  })
})
