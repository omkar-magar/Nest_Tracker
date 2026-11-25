// Admin -> Inventory: totals first, then counts room by room per floor; managers can edit a room.
// Who may read or change the table is tested in tests/db/inventory.test.js.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))

const { db, resetMock, queryFor, opArgs } = await import('./helpers/supabaseMock.js')
const { asRole } = await import('./helpers/authMock.js')
const { default: Inventory } = await import('../src/pages/manage/Inventory')
const { default: Beds } = await import('../src/pages/manage/Beds')
const { ScopeProvider } = await import('../src/components/manage/kit')
const { inventoryLine, summarizeInventory } = await import('../src/services/inventory')

const props = [{ id: 'P1', name: 'YOLO Nest A wing', wing: 'A' }, { id: 'P2', name: 'YOLO Nest B wing', wing: 'B' }]
const row = (room_no, item, qty) => ({ property_id: 'P1', room_no, item, qty })
const stock = [
  row('102', 'mattress', 5), row('102', 'bed', 5), row('102', 'chair', 1),
  row('106', 'mattress', 6), row('106', 'table', 4),
  row('201', 'bed', 4), row('201', 'cupboard', 4),
]
const page = (ui, initial = 'P1') => render(<MemoryRouter><ScopeProvider properties={props} initial={initial}>{ui}</ScopeProvider></MemoryRouter>)

beforeEach(() => resetMock())

describe('summarizeInventory', () => {
  it('totals each item and groups rooms by wing and floor', () => {
    const s = summarizeInventory(stock, props)
    expect(s.totals).toEqual({ mattress: 11, bed: 9, chair: 1, table: 4, cupboard: 4 })
    expect(s.groups.map((g) => [g.label, g.rooms.map((r) => r.room_no), g.totals.bed ?? 0])).toEqual([
      ['A wing · Floor 1', ['102', '106'], 5],
      ['A wing · Floor 2', ['201'], 4],
    ])
  })

  it('keeps items beyond the standard five as extra columns', () => {
    expect(summarizeInventory([row('101', 'shoe_rack', 2)], props).items.at(-1)).toEqual(['shoe_rack', 'Shoe rack'])
  })

  it('writes a short furniture line', () => {
    expect(inventoryLine({ mattress: 5, bed: 1, chair: 0 })).toBe('5 mattresses · 1 bed')
    expect(inventoryLine({})).toBe('')
    expect(inventoryLine(undefined)).toBe('')
  })
})

describe('Inventory tab', () => {
  it('shows totals, then where things are, for the chosen wing', async () => {
    db.tables.room_inventory = { data: stock, error: null }
    asRole('manager'); page(<Inventory />)
    expect(await screen.findByText('Total count')).toBeInTheDocument()
    expect(screen.getByText('Mattresses', { selector: 'p' }).closest('div')).toHaveTextContent('11')
    const floor1 = screen.getByRole('region', { name: 'A wing · Floor 1' })
    const r106 = within(floor1).getByRole('rowheader', { name: '106' }).closest('tr')
    expect(r106).toHaveTextContent('6')
    expect(within(floor1).getByRole('rowheader', { name: 'Total' }).closest('tr')).toHaveTextContent('11')
    expect(queryFor('room_inventory').some((q) => opArgs(q, 'eq')?.[1] === 'P1')).toBe(true)
  })

  it('saves a room\'s counts with every item, so a cleared field becomes 0', async () => {
    db.tables.room_inventory = { data: stock, error: null }
    asRole('admin'); page(<Inventory />)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit room 102' }))
    const chairs = screen.getByLabelText('Chairs')
    await userEvent.clear(chairs)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = queryFor('room_inventory').map((q) => opArgs(q, 'upsert')).find(Boolean)
    expect(saved[0]).toHaveLength(6)
    expect(saved[0].find((r) => r.item === 'chair')).toEqual({ property_id: 'P1', room_no: '102', item: 'chair', qty: 0 })
    expect(saved[0].find((r) => r.item === 'bed').qty).toBe(5)
  })

  it('says when a wing has nothing recorded', async () => {
    asRole('manager'); page(<Inventory />, 'P2')
    expect(await screen.findByText(/No furniture recorded/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a room' })).toBeInTheDocument()
  })
})

describe('Beds tab', () => {
  it('lists each room\'s furniture on its card', async () => {
    db.tables.rooms = { data: [{ id: 'pg-102', property_id: 'P1', wing: 'A', floor: 1, room_no: '102', room_type: 'other', ac_type: 'AC', is_active: true,
      beds: [{ id: 'b1', label: 'A', code: 'P1-F1-R102-B1', status: 'available' }] }], error: null }
    db.tables.room_inventory = { data: stock, error: null }
    asRole('manager'); page(<Beds />)
    expect(await screen.findByText('Furniture: 5 mattresses · 5 beds · 1 chair')).toBeInTheDocument()
  })
})

describe('Extra furniture requests', () => {
  const req = (id, item, status, extra = {}) => ({ id, property_id: 'P1', room_no: 'A-102', item, qty: 1, unit_price: 100, amount: 100, status, resident: 'Amit', ...extra })
  it('lists waiting requests and approves one into the room and the next rent', async () => {
    db.tables.room_inventory = { data: stock, error: null }
    db.rpcs.addon_requests = { data: [req(1, 'chair', 'requested'), req(2, 'table', 'approved', { charge_month: '2026-12-01', amount: 400 })], error: null }
    asRole('manager'); page(<Inventory />)
    const section = await screen.findByRole('region', { name: 'Extra furniture requests' })
    expect(within(section).getByText('1 waiting')).toBeInTheDocument()
    expect(within(section).queryByText('1 × Table')).not.toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: 'Approve' }))
    const { supabase } = await import('./helpers/supabaseMock.js')
    expect(supabase.rpc).toHaveBeenCalledWith('decide_addon', { p_id: 1, p_approve: true, p_note: '' })
    await userEvent.click(within(section).getByRole('button', { name: 'Show answered too' }))
    expect(within(section).getByText('on December 2026 rent')).toBeInTheDocument()
  })
  it('stays hidden when nobody has asked for anything', async () => {
    db.tables.room_inventory = { data: stock, error: null }
    db.rpcs.addon_requests = { data: [], error: null }
    asRole('manager'); page(<Inventory />)
    await screen.findByText('Total count')
    expect(screen.queryByRole('region', { name: 'Extra furniture requests' })).not.toBeInTheDocument()
  })
})
