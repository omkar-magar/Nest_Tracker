// Electricity consumer IDs: the resident sees their own flat's ID on /account; the office sees and edits the list
// under Billing -> Electricity. Who may read or change what is tested in tests/db/electricity.test.js.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))

const { db, resetMock, queryFor, opArgs } = await import('./helpers/supabaseMock.js')
const { asRole } = await import('./helpers/authMock.js')
const { MyElectricity } = await import('../src/pages/account/TenantSections')
const { default: Billing } = await import('../src/pages/manage/Billing')
const { ScopeProvider } = await import('../src/components/manage/kit')
const { electricityIndex } = await import('../src/services/manage')

beforeEach(() => resetMock())

describe('resident', () => {
  it('shows the flat and its consumer ID', async () => {
    db.rpcs.my_electricity_connection = { data: { room_label: 'A-101', consumer_id: '170681865287' }, error: null }
    asRole('customer'); render(<MyElectricity />)
    expect(await screen.findByText('170681865287')).toBeInTheDocument()
    expect(screen.getByText(/Flat A-101/)).toBeInTheDocument()
  })

  it('says when the flat has no ID yet, and waits for a stay', async () => {
    db.rpcs.my_electricity_connection = { data: { room_label: 'B-204', consumer_id: null }, error: null }
    asRole('customer'); const { unmount } = render(<MyElectricity />)
    expect(await screen.findByText(/flat B-204 has not been added yet/)).toBeInTheDocument()
    unmount()
    db.rpcs.my_electricity_connection = { data: null, error: null }
    render(<MyElectricity />)
    expect(await screen.findByText(/once your stay has started/)).toBeInTheDocument()
  })
})

describe('office', () => {
  it('lists the consumer IDs of the chosen wing under Billing -> Electricity', async () => {
    db.tables.electricity_connections = { data: [{ id: 1, property_id: 'P1', room_no: '101', consumer_id: '170681865287', note: '' }], error: null }
    asRole('manager')
    render(
      <MemoryRouter>
        <ScopeProvider properties={[{ id: 'P1', name: 'A wing' }, { id: 'P2', name: 'B wing' }]} initial="P1"><Billing /></ScopeProvider>
      </MemoryRouter>,
    )
    await userEvent.click(await screen.findByRole('tab', { name: 'Electricity' }))
    expect(await screen.findByText('Electricity consumer IDs')).toBeInTheDocument()
    expect((await screen.findAllByText('170681865287')).length).toBeGreaterThan(0)
    expect(queryFor('electricity_connections').some((q) => opArgs(q, 'eq')?.[1] === 'P1')).toBe(true)
  })

  it('indexes IDs by wing and flat', () => {
    expect(electricityIndex([{ property_id: 'P1', room_no: '101', consumer_id: '1' }])).toEqual({ 'P1|101': '1' })
    expect(electricityIndex(null)).toEqual({})
  })
})
