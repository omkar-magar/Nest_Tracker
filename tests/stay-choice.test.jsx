import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
import { db, resetMock } from './helpers/supabaseMock'
import StayChoice from '../src/components/register/StayChoice'

const daily = { property_id: 'P1', stay_type: 'pg_daily', move_in_date: '2026-12-11', checkout_date: '2026-12-20', room_no: '', due_day: '' }
beforeEach(() => { resetMock(); db.rpcs.registration_rooms = { data: [] } })

describe('daily stay price line', () => {
  it('shows nights × rate while the nights cost less than a month', async () => {
    db.rpcs.stay_quote = { data: { daily: true, nights: 8, rate: 800, rent: 6400, deposit: 1000, amount: 7400 } }
    render(<StayChoice value={daily} onChange={() => {}} />)
    expect(await screen.findByText('8 nights × ₹800')).toBeInTheDocument()
  })
  it('says the price is capped when the nights would cost more than a month', async () => {
    db.rpcs.stay_quote = { data: { daily: true, nights: 9, rate: 800, rent: 7000, deposit: 1000, amount: 8000 } }
    render(<StayChoice value={daily} onChange={() => {}} />)
    expect(await screen.findByText('9 nights (capped at one month’s rent)')).toBeInTheDocument()
    expect(screen.queryByText(/× ₹800/)).not.toBeInTheDocument()
  })
})
