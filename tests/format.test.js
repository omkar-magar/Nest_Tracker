import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, rupees, waNumber, whatsappLink } from '../src/services/format'

describe('rupees', () => {
  it('prefixes the rupee sign and uses Indian digit grouping', () => {
    expect(rupees(7500)).toBe('₹7,500')
    expect(rupees(1234567)).toBe('₹12,34,567')
  })
  it('treats empty values as zero', () => {
    expect(rupees(null)).toBe('₹0')
    expect(rupees(undefined)).toBe('₹0')
    expect(rupees('')).toBe('₹0')
  })
  it('accepts numeric strings', () => {
    expect(rupees('18000')).toBe('₹18,000')
  })
})

describe('formatDate / formatDateTime', () => {
  it('shows a dash when there is no date', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('')).toBe('—')
    expect(formatDateTime(undefined)).toBe('—')
  })
  it('formats a date with day, short month and year', () => {
    const out = formatDate('2026-11-05T12:00:00')
    expect(out).toMatch(/5/)
    expect(out).toMatch(/Nov/)
    expect(out).toMatch(/2026/)
  })
  it('formatDateTime includes a time', () => {
    expect(formatDateTime('2026-11-05T15:30:00')).toMatch(/3:30/)
  })
})

describe('waNumber', () => {
  it('adds the India country code to a bare 10-digit mobile', () => {
    expect(waNumber('8483878098')).toBe('918483878098')
  })
  it('strips spaces, dashes and plus signs', () => {
    expect(waNumber('+91 84838-78098')).toBe('918483878098')
  })
  it('leaves longer numbers alone', () => {
    expect(waNumber('447911123456')).toBe('447911123456')
  })
  it('handles missing input', () => {
    expect(waNumber(null)).toBe('')
    expect(waNumber(undefined)).toBe('')
  })
})

describe('whatsappLink', () => {
  it('builds a wa.me link without text', () => {
    expect(whatsappLink('8483878098')).toBe('https://wa.me/918483878098')
  })
  it('url-encodes the message', () => {
    expect(whatsappLink('8483878098', 'Hi there & welcome')).toBe(
      'https://wa.me/918483878098?text=Hi%20there%20%26%20welcome',
    )
  })
})
