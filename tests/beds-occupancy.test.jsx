// Beds tab counts real occupancy: guest-register guests take their room's free beds, and beds in an inactive
// room (or floor) count as inactive.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))

const { db, resetMock } = await import('./helpers/supabaseMock.js')
const { asRole } = await import('./helpers/authMock.js')
const { default: Beds } = await import('../src/pages/manage/Beds')
const { ScopeProvider } = await import('../src/components/manage/kit')
const { boardState, placeGuests } = await import('../src/services/pg')

const bed = (id, label, extra = {}) => ({ id, label, code: `P1-${id}`, status: 'available', is_active: true, ...extra })
const room = (id, room_no, beds, extra = {}) => ({ id, property_id: 'P1', wing: 'A', floor: 1, room_no, room_type: 'other', ac_type: 'AC', is_active: true, beds, ...extra })
const guest = (room_no, name, extra = {}) => ({ id: name, property_id: 'P1', room_no, name, ...extra })

beforeEach(() => resetMock())

describe('placeGuests / boardState', () => {
  it('seats guests on free beds in label order, skipping beds in use', () => {
    const r = room('r1', '101', [bed('b', 'B'), bed('a', 'A', { is_occupied: true }), bed('c', 'C', { status: 'maintenance' }), bed('d', 'D')])
    const { onBed, extra } = placeGuests([r], () => [guest('A-101', 'Asha'), guest('A-101', 'Ravi'), guest('A-101', 'Sita')])
    expect(Object.fromEntries(Object.entries(onBed).map(([k, g]) => [k, g.name]))).toEqual({ b: 'Asha', d: 'Ravi' })
    expect(extra.r1.map((g) => g.name)).toEqual(['Sita'])
    expect(boardState(r.beds[0], r, onBed.b)).toBe('occupied')
    expect(boardState(r.beds[2], r)).toBe('maintenance')
  })

  it('treats every bed of an inactive room as inactive', () => {
    const r = room('r1', '101', [bed('a', 'A')], { is_active: false })
    expect(boardState(r.beds[0], r)).toBe('inactive')
    expect(placeGuests([r], () => [guest('A-101', 'Asha')]).extra.r1).toHaveLength(1)
  })
})

describe('Beds tab', () => {
  it('counts register guests as occupied and inactive rooms as inactive', async () => {
    db.tables.rooms = { data: [
      room('r1', '101', [bed('a', 'A'), bed('b', 'B'), bed('c', 'C')]),
      room('r2', '102', [bed('d', 'A'), bed('e', 'B')], { is_active: false }),
    ], error: null }
    db.tables.register_guests = { data: [guest('A-101', 'Asha', { expected_checkout: '2026-12-31' }), guest('A-101', 'Ravi')], error: null }
    asRole('manager')
    render(<MemoryRouter><ScopeProvider properties={[{ id: 'P1', name: 'A wing', wing: 'A' }]} initial="P1"><Beds /></ScopeProvider></MemoryRouter>)
    expect(await screen.findByRole('button', { name: 'Occupied: 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vacant: 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inactive: 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bed P1-a: Occupied, Asha' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Asha' })).toHaveAttribute('href', '/admin/register')   // upcoming vacancies
  })
})
