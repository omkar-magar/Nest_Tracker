import { brand } from '../data/site'

export const whatsappUrl = (text) => {
  const base = `https://wa.me/91${brand.phone}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}

export const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(brand.mapQuery)}`

// date is the yyyy-mm-dd value of a date input. Parsed as local time so it cannot shift by a day.
const longDate = (date) => new Date(`${date}T00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

export function visitMessage({ name, visitType, date, slot, stay }) {
  return [
    `Hi ${brand.name}, I would like to schedule a visit.`,
    `Name: ${name.trim()}`,
    `Visit type: ${visitType}`,
    `Date: ${longDate(date)}`,
    `Time: ${slot}`,
    `Interested in: ${stay}`,
  ].join('\n')
}

// Today as yyyy-mm-dd in the visitor's time zone (toISOString would give the UTC date).
export function todayInput(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
