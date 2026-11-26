import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
import { db, resetMock } from './helpers/supabaseMock'
import { newRegistrations } from '../src/services/registration'

beforeEach(() => resetMock())

describe('pending registrations list', () => {
  it('shows a payment made for this registration, not one left from an earlier registration', async () => {
    db.tables.tenant_profiles = { data: [
      { user_id: 'u1', rules_accepted_at: '2026-11-26T09:50:00+00:00', registration_state: 'pending' },
      { user_id: 'u2', rules_accepted_at: '2026-11-26T09:50:00+00:00', registration_state: 'pending' },
    ] }
    db.tables.registration_payments = { data: [
      { customer_id: 'u1', amount: 1000, status: 'succeeded', completed_at: '2026-11-25T20:02:39+00:00' },
      { customer_id: 'u2', amount: 14000, status: 'succeeded', completed_at: '2026-11-26T10:00:00+00:00' },
    ] }
    const list = await newRegistrations('P1')
    expect(list.find((r) => r.user_id === 'u1').registration_payment).toBeNull()
    expect(list.find((r) => r.user_id === 'u2').registration_payment).toMatchObject({ amount: 14000 })
  })
})
