import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { amenities, brand, categories, faqs, heroImages, nearby, rooms } from '../src/data/site'

const root = resolve(__dirname, '..')

describe('brand', () => {
  it('has the contact details the pages and footer rely on', () => {
    expect(brand.name).toBe('YOLO Nest')
    expect(brand.phone).toMatch(/^\d{10}$/)
    expect(brand.address).toBeTruthy()
    expect(brand.mapQuery).toBeTruthy()
    expect(Array.isArray(brand.social)).toBe(true)
  })
})

describe('categories and rooms', () => {
  it('every room belongs to a known category', () => {
    const ids = new Set(categories.map((c) => c.id))
    rooms.forEach((r) => expect(ids.has(r.category), `${r.id} -> ${r.category}`).toBe(true))
  })
  it('every category has at least one room', () => {
    categories.forEach((c) => expect(rooms.some((r) => r.category === c.id), c.id).toBe(true))
  })
  it('room ids and numbers are unique', () => {
    expect(new Set(rooms.map((r) => r.id)).size).toBe(rooms.length)
    expect(new Set(rooms.map((r) => r.no)).size).toBe(rooms.length)
  })
  it('rooms have valid pricing fields', () => {
    rooms.forEach((r) => {
      expect(['bed', 'room']).toContain(r.rentBasis)
      expect(['month', 'night']).toContain(r.billing)
      expect(['AC', 'Non-AC']).toContain(r.type)
      expect(r.price).toBeGreaterThan(0)
      expect(r.deposit).toBeGreaterThanOrEqual(0)
      expect(r.beds).toBeGreaterThan(0)
    })
  })
  it('nightly rooms carry no deposit (as the FAQ says)', () => {
    rooms.filter((r) => r.billing === 'night').forEach((r) => expect(r.deposit).toBe(0))
  })
  it('whole-room rentals are the flat, lodge and Airbnb stays; PG rooms are per bed', () => {
    rooms.forEach((r) => {
      const wholeRoom = ['flat-1bhk', 'lodge', 'airbnb'].includes(r.category)
      expect(r.rentBasis).toBe(wholeRoom ? 'room' : 'bed')
    })
  })
  it('room images are expected at /images/rooms/<id>.webp by the catalog', () => {
    const png = resolve(root, 'public/images/rooms')
    // Only checks the folder exists; photos are supplied by the client.
    expect(existsSync(png)).toBe(true)
  })
})

describe('amenities, hero and FAQs', () => {
  it('amenities have an icon, title and text', () => {
    expect(amenities.length).toBeGreaterThan(0)
    amenities.forEach((a) => ['icon', 'title', 'text'].forEach((k) => expect(a[k], `${a.title} ${k}`).toBeTruthy()))
  })
  it('has hero images', () => {
    expect(heroImages.length).toBeGreaterThan(0)
    heroImages.forEach((h) => expect(h).toMatch(/^\/images\/hero\//))
  })
  it('every FAQ has a group, a question and an answer', () => {
    faqs.forEach((f) => ['group', 'q', 'a'].forEach((k) => expect(f[k]).toBeTruthy()))
    expect(new Set(faqs.map((f) => f.q)).size).toBe(faqs.length)
  })
})

describe('nearby places', () => {
  it('has at most 6 places, each with a distinct map icon', () => {
    expect(nearby.length).toBeLessThanOrEqual(6)
    const icons = nearby.map((n) => n.icon)
    expect(new Set(icons).size).toBe(icons.length)
    icons.forEach((i) => expect(['metro', 'work', 'home', 'cart', 'mall', 'food']).toContain(i))
  })
  it('distances are numeric ranges so the Location page can sort them', () => {
    nearby.forEach((n) => expect(Number.isNaN(parseFloat(n.km)), n.name).toBe(false))
  })
})

describe('PWA manifests', () => {
  it.each(['manifest', 'manifest-staff', 'manifest-admin'])('%s.webmanifest is valid JSON with a scope and start_url', (name) => {
    const file = resolve(root, `public/${name}.webmanifest`)
    expect(existsSync(file)).toBe(true)
    const m = JSON.parse(readFileSync(file, 'utf8'))
    expect(m.name).toBeTruthy()
    expect(m.start_url).toBeTruthy()
    expect(m.scope).toBeTruthy()
    expect(m.icons?.length).toBeGreaterThan(0)
  })
})
