import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FloatingShortcuts from '../src/components/FloatingShortcuts'
import QuickContactBar from '../src/components/QuickContactBar'
import VisitForm from '../src/components/VisitForm'
import { brand, highlights, visitSlots, visitTypes } from '../src/data/site'
import { todayInput, visitMessage, whatsappUrl } from '../src/services/contact'
import { renderAt } from './helpers/render.jsx'

describe('contact service', () => {
  it('builds a plain and a prefilled WhatsApp link', () => {
    expect(whatsappUrl()).toBe(`https://wa.me/91${brand.phone}`)
    expect(whatsappUrl('a b&c')).toBe(`https://wa.me/91${brand.phone}?text=a%20b%26c`)
  })
  it('puts every visit detail in the message without shifting the date', () => {
    const msg = visitMessage({ name: ' Asha ', visitType: visitTypes[1], date: '2026-12-05', slot: visitSlots[0], stay: 'Monthly PG' })
    expect(msg).toContain('Name: Asha\n')
    expect(msg).toContain(visitTypes[1])
    expect(msg).toContain('5 December 2026')
    expect(msg).toContain(visitSlots[0])
    expect(msg).toContain('Monthly PG')
  })
  it('gives today in local time for the date input', () => {
    expect(todayInput(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})

describe('VisitForm', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not open WhatsApp until the required fields are filled', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<VisitForm />)
    await userEvent.click(screen.getByRole('button', { name: 'Request visit on WhatsApp' }))
    expect(open).not.toHaveBeenCalled()
  })
  it('opens WhatsApp with the request and says it still has to be sent', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { container } = render(<VisitForm />)
    await userEvent.type(screen.getByLabelText('Your name'), 'Asha')
    await userEvent.type(container.querySelector('input[type="date"]'), '2030-12-05')
    await userEvent.selectOptions(screen.getByLabelText('Preferred time'), visitSlots[2])
    await userEvent.click(screen.getByRole('button', { name: 'Request visit on WhatsApp' }))

    expect(open).toHaveBeenCalledTimes(1)
    const url = open.mock.calls[0][0]
    expect(url).toContain(`https://wa.me/91${brand.phone}?text=`)
    expect(decodeURIComponent(url)).toContain('Name: Asha')
    expect(decodeURIComponent(url)).toContain(visitSlots[2])
    expect(screen.getByRole('status')).toHaveTextContent('Press send')
  })
  it('does not allow a date in the past', () => {
    const { container } = render(<VisitForm />)
    expect(container.querySelector('input[type="date"]')).toHaveAttribute('min', todayInput())
  })
})

describe('QuickContactBar', () => {
  it.each(['/', '/rooms', '/amenities', '/location'])('shows call and WhatsApp on %s', (route) => {
    renderAt(<QuickContactBar />, route)
    expect(screen.getByRole('link', { name: 'Call now' })).toHaveAttribute('href', `tel:+91${brand.phone}`)
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', whatsappUrl())
  })
  it.each(['/book/pg-101', '/account', '/login'])('stays out of the way on %s', (route) => {
    renderAt(<QuickContactBar />, route)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})

describe('FloatingShortcuts', () => {
  it.each(['/', '/rooms', '/amenities', '/location'])('links to WhatsApp and Google Maps in a new tab on %s', (route) => {
    renderAt(<FloatingShortcuts />, route)
    const whatsapp = screen.getByRole('link', { name: 'Chat on WhatsApp' })
    const maps = screen.getByRole('link', { name: 'Open in Google Maps' })
    expect(whatsapp).toHaveAttribute('href', whatsappUrl())
    expect(maps).toHaveAttribute('href', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(brand.mapQuery)}`)
    ;[whatsapp, maps].forEach((a) => expect(a).toHaveAttribute('target', '_blank'))
  })
  it.each(['/book/pg-101', '/account', '/login'])('stays out of the way on %s', (route) => {
    renderAt(<FloatingShortcuts />, route)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('highlights', () => {
  it('each has an icon, title and text', () => {
    expect(highlights.length).toBeGreaterThan(0)
    highlights.forEach((h) => ['icon', 'title', 'text'].forEach((k) => expect(h[k]).toBeTruthy()))
  })
})
