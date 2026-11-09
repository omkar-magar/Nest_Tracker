import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

import { db, resetMock, setConfigured, supabase } from './helpers/supabaseMock.js'
import {
  availability, loadAmenities, loadCatalog, loadPublishedReviews, monthlyEquivalent, previewRooms, priceLabel, subscribeAvailability,
} from '../src/services/catalog'
import { rooms as staticRooms } from '../src/data/site'

beforeEach(resetMock)

const bed = (over = {}) => ({ id: Math.random(), status: 'available', is_occupied: false, ...over })
const room = (over = {}) => ({ id: 'r', rentBasis: 'bed', billing: 'month', price: 7000, beds: [bed(), bed()], totalBeds: 2, ...over })

describe('availability()', () => {
  it('is unknown when there is no backend (beds null)', () => {
    expect(availability(room({ beds: null }))).toEqual({ status: 'unknown', free: null, total: 2 })
  })
  it('is available when every bed is free', () => {
    expect(availability(room())).toMatchObject({ status: 'available', free: 2, total: 2, bookable: true })
  })
  it('is partial when some beds of a per-bed room are taken', () => {
    const r = room({ beds: [bed(), bed({ is_occupied: true })] })
    expect(availability(r)).toMatchObject({ status: 'partial', free: 1, bookable: true })
  })
  it('is full when all beds are taken', () => {
    const r = room({ beds: [bed({ is_occupied: true }), bed({ is_occupied: true })] })
    expect(availability(r)).toMatchObject({ status: 'full', free: 0, bookable: false })
  })
  it('a whole-room rental with any bed taken is full and not bookable', () => {
    const r = room({ rentBasis: 'room', beds: [bed(), bed({ is_occupied: true })] })
    expect(availability(r)).toMatchObject({ status: 'full', bookable: false })
  })
  it('a whole-room rental is bookable only when every bed is free', () => {
    expect(availability(room({ rentBasis: 'room' })).bookable).toBe(true)
    const r = room({ rentBasis: 'room', beds: [bed(), bed({ status: 'maintenance' })] })
    expect(availability(r)).toMatchObject({ status: 'unavailable', bookable: false })
  })
  it('is unavailable when beds are only under maintenance', () => {
    const r = room({ beds: [bed({ status: 'maintenance' }), bed({ status: 'maintenance' })] })
    expect(availability(r)).toMatchObject({ status: 'unavailable', free: 0, bookable: false })
  })
  it('a room with no beds is not bookable', () => {
    expect(availability(room({ beds: [] })).bookable).toBe(false)
  })
  it('a maintenance bed does not count as free', () => {
    const r = room({ beds: [bed(), bed({ status: 'maintenance' })] })
    expect(availability(r)).toMatchObject({ free: 1, status: 'available' })
  })
})

describe('priceLabel / monthlyEquivalent', () => {
  it('labels per-bed monthly rooms', () => {
    expect(priceLabel(room())).toBe('₹7,000 / bed / month')
  })
  it('labels whole-room nightly rooms', () => {
    expect(priceLabel(room({ rentBasis: 'room', billing: 'night', price: 1500 }))).toBe('₹1,500 / night')
  })
  it('converts nightly prices to a 30 night month for sorting', () => {
    expect(monthlyEquivalent(room({ billing: 'night', price: 800 }))).toBe(24000)
    expect(monthlyEquivalent(room({ billing: 'month', price: 6500 }))).toBe(6500)
  })
})

describe('previewRooms', () => {
  const mk = (id, price) => room({ id, price, beds: null })
  const taken = (id, price) => room({ id, price, beds: [bed({ is_occupied: true })] })

  it('returns everything, cheapest first, when there are 3 or fewer', () => {
    expect(previewRooms([mk('b', 9000), mk('a', 5000)]).map((r) => r.id)).toEqual(['a', 'b'])
  })
  it('picks cheapest, middle and priciest from a longer list', () => {
    const list = [mk('e', 5), mk('a', 1), mk('c', 3), mk('b', 2), mk('d', 4)]
    expect(previewRooms(list).map((r) => r.id)).toEqual(['a', 'c', 'e'])
  })
  it('skips rooms that cannot be booked when enough bookable ones exist', () => {
    const list = [taken('x', 1), mk('a', 2), mk('b', 3), mk('c', 4), mk('d', 5)]
    expect(previewRooms(list).map((r) => r.id)).not.toContain('x')
  })
  it('falls back to all rooms when fewer than 3 are bookable', () => {
    const list = [taken('x', 1), taken('y', 2), mk('a', 3), taken('z', 4)]
    expect(previewRooms(list).map((r) => r.id)).toEqual(['x', 'a', 'z'])
  })
})

describe('loadCatalog() without Supabase', () => {
  beforeEach(() => setConfigured(false))

  it('serves the static content from site.js', async () => {
    const c = await loadCatalog()
    expect(c.live).toBe(false)
    expect(c.rooms).toHaveLength(staticRooms.length)
    expect(c.categories.length).toBeGreaterThan(0)
    expect(supabase.from).not.toHaveBeenCalled()
  })
  it('maps static rooms into the shared room shape', async () => {
    const [first] = (await loadCatalog()).rooms
    expect(first).toMatchObject({
      id: 'pg-101', no: '101', image: '/images/rooms/pg-101.webp', beds: null, totalBeds: 2, isDemoPrice: true, isActive: true,
    })
    expect(availability(first).status).toBe('unknown')
  })
  it('maps amenities to id/title/text/icon/image', async () => {
    const [a] = (await loadAmenities()).amenities
    expect(a).toMatchObject({ id: a.title, title: a.title })
    expect(a).toHaveProperty('text')
  })
})

describe('loadCatalog() with Supabase', () => {
  const rows = () => {
    db.tables.categories = { data: [{ id: 'monthly-pg', name: 'Monthly PG' }], error: null }
    db.tables.rooms = {
      data: [
        { id: 'pg-1', category_id: 'monthly-pg', room_no: '1', floor: 1, ac_type: 'AC', description: 'd', features: null, image_url: null,
          rent_basis: 'bed', billing_period: 'month', price: 7000, deposit: 7000, is_demo_price: false, is_active: true },
      ],
      error: null,
    }
    db.tables.beds = {
      data: [
        { id: 1, room_id: 'pg-1', label: 'A', status: 'available', is_occupied: false },
        { id: 2, room_id: 'pg-1', label: 'B', status: 'available', is_occupied: true },
        { id: 3, room_id: 'other', label: 'A', status: 'available', is_occupied: false },
      ],
      error: null,
    }
    db.tables.amenities = { data: [{ id: 'a1', title: 'Gym', description: 'Lift', icon: '🏋️', image_url: '/g.webp' }], error: null }
  }

  it("maps database rows to the UI shape and attaches only that room's beds", async () => {
    rows()
    const c = await loadCatalog()
    expect(c.live).toBe(true)
    const r = c.rooms[0]
    expect(r).toMatchObject({
      id: 'pg-1', category: 'monthly-pg', no: '1', type: 'AC', rentBasis: 'bed', billing: 'month', price: 7000,
      isDemoPrice: false, totalBeds: 2, features: [], image: '/images/rooms/pg-1.webp',
    })
    expect(r.beds.map((b) => b.id)).toEqual([1, 2])
    expect(availability(r).status).toBe('partial')
  })
  it('loads amenities on their own, without touching rooms or beds', async () => {
    rows()
    const out = await loadAmenities()
    expect(out.amenities[0]).toEqual({ id: 'a1', title: 'Gym', text: 'Lift', icon: '🏋️', image: '/g.webp' })
    expect(db.queries.map((q) => q.table)).toEqual(['amenities'])
  })
  it('does not query amenities as part of the catalogue', async () => {
    rows()
    await loadCatalog()
    expect(db.queries.map((q) => q.table).sort()).toEqual(['beds', 'categories', 'rooms'])
  })
  it('asks for named columns instead of select(*)', async () => {
    rows()
    await loadCatalog()
    const cols = db.queries.map((q) => q.ops.find(([m]) => m === 'select')[1][0])
    expect(cols.some((c) => c === '*')).toBe(false)
  })
  it('uses the room image_url when present', async () => {
    rows()
    db.tables.rooms.data[0].image_url = 'https://cdn/x.webp'
    expect((await loadCatalog()).rooms[0].image).toBe('https://cdn/x.webp')
  })
  it('queries only active rooms', async () => {
    rows()
    await loadCatalog()
    const q = db.queries.find((x) => x.table === 'rooms')
    expect(q.ops).toContainEqual(['eq', ['is_active', true]])
  })
  it('rejects when any query fails', async () => {
    rows()
    db.tables.beds = { data: null, error: new Error('beds down') }
    await expect(loadCatalog()).rejects.toThrow('beds down')
  })
})

describe('subscribeAvailability()', () => {
  it('is a no-op without Supabase', () => {
    setConfigured(false)
    const off = subscribeAvailability(() => {})
    expect(supabase.channel).not.toHaveBeenCalled()
    expect(() => off()).not.toThrow()
  })
  it('listens to beds and rooms, and unsubscribes on cleanup', () => {
    const cb = vi.fn()
    const off = subscribeAvailability(cb)
    expect(supabase.channel).toHaveBeenCalledWith('availability')
    const ch = supabase.channel.mock.results[0].value
    expect(ch.on.mock.calls.map((c) => c[1].table)).toEqual(['beds', 'rooms'])
    expect(ch.on.mock.calls[0][2]).toBe(cb)
    off()
    expect(supabase.removeChannel).toHaveBeenCalledWith(ch)
  })
})

describe('loadPublishedReviews()', () => {
  it('returns nothing without Supabase', async () => {
    setConfigured(false)
    expect(await loadPublishedReviews()).toEqual({ live: false, reviews: [] })
  })
  it('fetches only published reviews, newest first, max 12', async () => {
    db.tables.reviews = { data: [{ id: 1 }], error: null }
    const out = await loadPublishedReviews()
    expect(out).toEqual({ live: true, reviews: [{ id: 1 }] })
    const ops = db.queries.find((q) => q.table === 'reviews').ops
    expect(ops).toContainEqual(['eq', ['status', 'published']])
    expect(ops).toContainEqual(['order', ['created_at', { ascending: false }]])
    expect(ops).toContainEqual(['limit', [12]])
  })
  it('throws on a database error', async () => {
    db.tables.reviews = { data: null, error: new Error('nope') }
    await expect(loadPublishedReviews()).rejects.toThrow('nope')
  })
})
