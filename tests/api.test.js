import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

import { db, opArgs, queryFor, resetMock, storageBucket, supabase } from './helpers/supabaseMock.js'
import * as api from '../src/services/api'
import { fetchQuery, isFresh } from '../src/lib/queryCache'

beforeEach(resetMock)

describe('customer RPC wrappers', () => {
  it('bookRoom sends the booking params and returns the new id', async () => {
    db.rpcs.book_room = { data: 'booking-1', error: null }
    const out = await api.bookRoom({ roomId: 'pg-101', bedCount: 2, checkIn: '2026-12-01', checkOut: '2026-12-05' })
    expect(out).toBe('booking-1')
    expect(supabase.rpc).toHaveBeenCalledWith('book_room', {
      p_room_id: 'pg-101', p_bed_count: 2, p_check_in: '2026-12-01', p_check_out: '2026-12-05',
    })
  })
  it('bookRoom sends null check-out for monthly stays', async () => {
    await api.bookRoom({ roomId: 'r', bedCount: 1, checkIn: '2026-12-01' })
    expect(supabase.rpc.mock.calls[0][1].p_check_out).toBeNull()
  })
  it('bookRoom throws the database error (e.g. bed just taken)', async () => {
    db.rpcs.book_room = { data: null, error: new Error('Not enough free beds') }
    await expect(api.bookRoom({ roomId: 'r', bedCount: 1, checkIn: '2026-12-01' })).rejects.toThrow('Not enough free beds')
  })
  it('cancelBooking calls cancel_booking', async () => {
    await api.cancelBooking('b1')
    expect(supabase.rpc).toHaveBeenCalledWith('cancel_booking', { p_booking_id: 'b1' })
  })
})

describe('loadMyAccount', () => {
  it('loads bookings, bills, payments, documents and the review for one customer', async () => {
    db.tables.bookings = { data: [{ id: 'b' }], error: null }
    db.tables.bills = { data: [{ id: 'bill' }], error: null }
    db.tables.payments = { data: [{ id: 'p' }], error: null }
    db.tables.customer_documents = { data: [], error: null }
    db.tables.reviews = { data: null, error: null }
    const out = await api.loadMyAccount('u1')
    expect(out).toEqual({ bookings: [{ id: 'b' }], bills: [{ id: 'bill' }], payments: [{ id: 'p' }], documents: [], review: null })
    for (const t of ['bookings', 'bills', 'payments', 'customer_documents', 'reviews']) {
      expect(queryFor(t)[0].ops).toContainEqual(['eq', ['customer_id', 'u1']])
    }
  })
  it('throws if any query fails', async () => {
    db.tables.bills = { data: null, error: new Error('rls denied') }
    await expect(api.loadMyAccount('u1')).rejects.toThrow('rls denied')
  })
})

describe('updateMyProfile', () => {
  it('stores digits only in the phone number', async () => {
    await api.updateMyProfile('u1', { full_name: 'Asha', phone: '+91 98765-43210' })
    const q = queryFor('profiles')[0]
    expect(opArgs(q, 'update')[0]).toEqual({ full_name: 'Asha', phone: '919876543210' })
    expect(q.ops).toContainEqual(['eq', ['id', 'u1']])
  })
  it('stores null when the phone is blank', async () => {
    await api.updateMyProfile('u1', { full_name: 'Asha', phone: ' - ' })
    expect(opArgs(queryFor('profiles')[0], 'update')[0].phone).toBeNull()
  })
})

describe('documents', () => {
  const file = { name: 'My ID (front).pdf', type: 'application/pdf' }

  it('uploads into the user folder with a sanitised name, then records the row', async () => {
    await api.uploadDocument('u1', file, 'id_proof', 'b1')
    const [path, sent, opts] = storageBucket.upload.mock.calls[0]
    expect(supabase.storage.from).toHaveBeenCalledWith('customer-documents')
    expect(path).toMatch(/^u1\/\d+-My_ID_front_.pdf$/)
    expect(sent).toBe(file)
    expect(opts).toEqual({ contentType: 'application/pdf' })
    expect(opArgs(queryFor('customer_documents')[0], 'insert')[0]).toMatchObject({
      customer_id: 'u1', booking_id: 'b1', doc_type: 'id_proof', file_path: path, file_name: 'My ID (front).pdf',
    })
  })
  it('stores null booking_id when none is given', async () => {
    await api.uploadDocument('u1', file, 'photo')
    expect(opArgs(queryFor('customer_documents')[0], 'insert')[0].booking_id).toBeNull()
  })
  it('does not insert a row when the file upload fails', async () => {
    storageBucket.upload.mockResolvedValueOnce({ data: null, error: new Error('too big') })
    await expect(api.uploadDocument('u1', file, 'photo')).rejects.toThrow('too big')
    expect(queryFor('customer_documents')).toHaveLength(0)
  })
  it('removes the uploaded file again if saving the row fails (no orphans)', async () => {
    db.tables.customer_documents = { data: null, error: new Error('insert denied') }
    await expect(api.uploadDocument('u1', file, 'photo')).rejects.toThrow('insert denied')
    const uploaded = storageBucket.upload.mock.calls[0][0]
    expect(storageBucket.remove).toHaveBeenCalledWith([uploaded])
  })
  it('deleteDocument deletes the row and then the stored file', async () => {
    await api.deleteDocument({ id: 'd1', file_path: 'u1/a.pdf' })
    expect(queryFor('customer_documents')[0].ops).toContainEqual(['eq', ['id', 'd1']])
    expect(storageBucket.remove).toHaveBeenCalledWith(['u1/a.pdf'])
  })
  it('deleteDocument keeps the file if the row delete fails', async () => {
    db.tables.customer_documents = { data: null, error: new Error('denied') }
    await expect(api.deleteDocument({ id: 'd1', file_path: 'p' })).rejects.toThrow('denied')
    expect(storageBucket.remove).not.toHaveBeenCalled()
  })
  it('documentUrl returns a 60 second signed link', async () => {
    expect(await api.documentUrl('u1/a.pdf')).toBe('https://signed.example/file')
    expect(storageBucket.createSignedUrl).toHaveBeenCalledWith('u1/a.pdf', 60)
  })
  it('documentUrl throws on error', async () => {
    storageBucket.createSignedUrl.mockResolvedValueOnce({ data: null, error: new Error('gone') })
    await expect(api.documentUrl('x')).rejects.toThrow('gone')
  })
})

describe('submitReview', () => {
  it('inserts the review for the customer', async () => {
    await api.submitReview('u1', 'Asha', 4, 'Nice place to stay')
    expect(opArgs(queryFor('reviews')[0], 'insert')[0]).toEqual({
      customer_id: 'u1', author_name: 'Asha', rating: 4, body: 'Nice place to stay',
    })
  })
})

describe('staff API', () => {
  it('staffOverview calls the trimmed overview RPC', async () => {
    db.rpcs.staff_customer_overview = { data: [{ customer_id: 'c' }], error: null }
    expect(await api.staffOverview()).toEqual([{ customer_id: 'c' }])
  })
  it('loadMyPermissions reads the employee row', async () => {
    db.tables.employee_permissions = { data: { can_manage_beds: true }, error: null }
    expect(await api.loadMyPermissions('e1')).toEqual({ can_manage_beds: true })
    expect(queryFor('employee_permissions')[0].ops).toContainEqual(['eq', ['employee_id', 'e1']])
  })
  it('loadBeds lists only active rooms', async () => {
    await api.loadBeds()
    expect(queryFor('rooms')[0].ops).toContainEqual(['eq', ['is_active', true]])
  })
  it('setBedStatus passes the bed and status', async () => {
    await api.setBedStatus('bed1', 'maintenance')
    expect(supabase.rpc).toHaveBeenCalledWith('set_bed_status', { p_bed_id: 'bed1', p_status: 'maintenance' })
  })
})

describe('admin API', () => {
  it.each([
    ['adminStats', [], 'admin_dashboard_stats', undefined],
    ['recordCashPayment', ['bill1'], 'admin_record_cash_payment', { p_bill_id: 'bill1' }],
    ['endBooking', ['b1'], 'admin_end_booking', { p_booking_id: 'b1' }],
    ['setUserActive', ['u1', false], 'admin_set_user_active', { p_user: 'u1', p_active: false }],
    ['setEmployeePermissions', ['e1', { can_manage_beds: true }], 'admin_set_employee_permissions', { p_employee: 'e1', p_perms: { can_manage_beds: true } }],
  ])('%s calls the %s RPC', async (fn, args, rpc, params) => {
    await api[fn](...args)
    expect(supabase.rpc.mock.calls[0][0]).toBe(rpc)
    if (params) expect(supabase.rpc.mock.calls[0][1]).toEqual(params)
  })

  it('RPC wrappers surface database errors', async () => {
    db.rpcs.admin_end_booking = { data: null, error: new Error('not admin') }
    await expect(api.endBooking('b')).rejects.toThrow('not admin')
  })

  it('setReviewStatus updates the review row', async () => {
    await api.setReviewStatus('r1', 'published')
    const q = queryFor('reviews')[0]
    expect(opArgs(q, 'update')[0]).toEqual({ status: 'published' })
    expect(q.ops).toContainEqual(['eq', ['id', 'r1']])
  })
  it('updateRoom updates only the given fields', async () => {
    await api.updateRoom('pg-101', { price: 8000, deposit: 8000 })
    const q = queryFor('rooms')[0]
    expect(opArgs(q, 'update')[0]).toEqual({ price: 8000, deposit: 8000 })
    expect(q.ops).toContainEqual(['eq', ['id', 'pg-101']])
  })
  it('adminCustomers only lists customers', async () => {
    await api.adminCustomers()
    expect(queryFor('profiles')[0].ops).toContainEqual(['eq', ['role', 'customer']])
  })
  it('adminEmployees only lists employees', async () => {
    await api.adminEmployees()
    expect(queryFor('profiles')[0].ops).toContainEqual(['eq', ['role', 'employee']])
  })
  it('adminPayments is capped at 200 rows and adminActivity at 100', async () => {
    await api.adminPayments()
    await api.adminActivity()
    expect(queryFor('payments')[0].ops).toContainEqual(['limit', [200]])
    expect(queryFor('activity_log')[0].ops).toContainEqual(['limit', [100]])
  })
  it('adminBills and adminReviews query their tables', async () => {
    await api.adminBills()
    await api.adminReviews()
    expect(queryFor('bills')).toHaveLength(1)
    expect(queryFor('reviews')).toHaveLength(1)
  })
})

describe('performance rules', () => {
  it('adminCustomers asks for one page at a time', async () => {
    await api.adminCustomers(0)
    await api.adminCustomers(2)
    const [first, third] = queryFor('profiles')
    expect(opArgs(first, 'range')).toEqual([0, api.CUSTOMERS_PAGE - 1])
    expect(opArgs(third, 'range')).toEqual([2 * api.CUSTOMERS_PAGE, 3 * api.CUSTOMERS_PAGE - 1])
  })
  it('adminBills only fetches unpaid bills and adminReviews is capped', async () => {
    await api.adminBills()
    await api.adminReviews()
    expect(queryFor('bills')[0].ops).toContainEqual(['eq', ['status', 'unpaid']])
    expect(queryFor('reviews')[0].ops).toContainEqual(['limit', [100]])
  })
  it.each([
    ['bookRoom', () => api.bookRoom({ roomId: 'r', bedCount: 1, checkIn: '2026-12-01' })],
    ['cancelBooking', () => api.cancelBooking('b1')],
    ['setBedStatus', () => api.setBedStatus('bed1', 'maintenance')],
    ['endBooking', () => api.endBooking('b1')],
    ['updateRoom', () => api.updateRoom('r', { price: 9000 })],
  ])('%s drops the cached public catalogue so availability is never stale', async (_name, call) => {
    await fetchQuery('catalog', async () => ({ rooms: [] }))
    expect(isFresh('catalog', 60_000)).toBe(true)
    await call()
    expect(isFresh('catalog', 60_000)).toBe(false)
  })
  it('a failed booking leaves the cache alone', async () => {
    db.rpcs.book_room = { data: null, error: new Error('Not enough free beds') }
    await fetchQuery('catalog', async () => ({ rooms: [] }))
    await expect(api.bookRoom({ roomId: 'r', bedCount: 1, checkIn: '2026-12-01' })).rejects.toThrow()
    expect(isFresh('catalog', 60_000)).toBe(true)
  })
  it('publishing or rejecting a review refreshes the public reviews', async () => {
    await fetchQuery('reviews', async () => ({ reviews: [] }))
    await api.setReviewStatus('r1', 'published')
    expect(isFresh('reviews', 60_000)).toBe(false)
  })
})

describe('createEmployee', () => {
  it('invokes the create-employee edge function and returns its data', async () => {
    db.fnResult = { data: { id: 'e1' }, error: null }
    const out = await api.createEmployee({ email: 'a@b.c' })
    expect(out).toEqual({ id: 'e1' })
    expect(supabase.functions.invoke).toHaveBeenCalledWith('create-employee', { body: { email: 'a@b.c' } })
  })
  it("shows the function's own error message from the response body", async () => {
    db.fnResult = { data: null, error: { message: 'generic', context: { json: async () => ({ error: 'Email already in use' }) } } }
    await expect(api.createEmployee({})).rejects.toThrow('Email already in use')
  })
  it('falls back to the generic message when the body cannot be read', async () => {
    db.fnResult = { data: null, error: { message: 'Edge Function returned a non-2xx', context: { json: async () => { throw new Error('bad json') } } } }
    await expect(api.createEmployee({})).rejects.toThrow('Edge Function returned a non-2xx')
  })
})
