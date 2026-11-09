import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

import { db, opArgs, queryFor, resetMock, supabase } from './helpers/supabaseMock.js'
import { demoProvider } from '../src/services/payments/demoProvider'
import { razorpayProvider } from '../src/services/payments/razorpayProvider'
import { payBill, paymentProvider } from '../src/services/payments'

beforeEach(() => {
  resetMock()
  delete window.Razorpay
})

describe('payment provider selection', () => {
  it('defaults to the demo provider', () => {
    expect(paymentProvider).toBe(demoProvider)
    expect(paymentProvider.isSimulated).toBe(true)
  })
  it('uses Razorpay when VITE_PAYMENT_PROVIDER=razorpay', async () => {
    vi.stubEnv('VITE_PAYMENT_PROVIDER', 'razorpay')
    vi.resetModules()
    const mod = await import('../src/services/payments/index.js')
    expect(mod.paymentProvider.id).toBe('razorpay')
    expect(mod.paymentProvider.isSimulated).toBe(false)
    vi.unstubAllEnvs()
  })
  it('falls back to demo for an unknown provider name', async () => {
    vi.stubEnv('VITE_PAYMENT_PROVIDER', 'paypal')
    vi.resetModules()
    const mod = await import('../src/services/payments/index.js')
    expect(mod.paymentProvider.id).toBe('demo')
    vi.unstubAllEnvs()
  })
})

describe('demoProvider', () => {
  it('createOrder asks the backend for a payment row and returns its id', async () => {
    db.rpcs.payment_create_order = { data: 'pay-1', error: null }
    const order = await demoProvider.createOrder({ id: 'bill-1', amount: 7500 })
    expect(order).toEqual({ paymentId: 'pay-1', amount: 7500 })
    expect(supabase.rpc).toHaveBeenCalledWith('payment_create_order', { p_bill_id: 'bill-1', p_provider: 'demo' })
  })
  it('createOrder throws backend errors (e.g. demo payments switched off)', async () => {
    db.rpcs.payment_create_order = { data: null, error: new Error('demo payments disabled') }
    await expect(demoProvider.createOrder({ id: 'b', amount: 1 })).rejects.toThrow('demo payments disabled')
  })
  it.each(['success', 'failure'])('collect records the %s outcome the user chose', async (outcome) => {
    await demoProvider.collect({ paymentId: 'pay-1' }, { chooseOutcome: async () => outcome })
    expect(supabase.rpc).toHaveBeenCalledWith('demo_complete_payment', { p_payment_id: 'pay-1', p_outcome: outcome })
  })
  it('collect throws backend errors', async () => {
    db.rpcs.demo_complete_payment = { data: null, error: new Error('already settled') }
    await expect(demoProvider.collect({ paymentId: 'p' }, { chooseOutcome: async () => 'success' })).rejects.toThrow('already settled')
  })
})

describe('payBill', () => {
  it('creates the order, collects, then reads the status back from the payments table', async () => {
    db.rpcs.payment_create_order = { data: 'pay-9', error: null }
    db.tables.payments = { data: { id: 'pay-9', status: 'succeeded', failure_reason: null, is_simulated: true }, error: null }
    const result = await payBill({ id: 'bill-9', amount: 500 }, { chooseOutcome: async () => 'success' })
    expect(result.status).toBe('succeeded')
    expect(supabase.rpc.mock.calls.map((c) => c[0])).toEqual(['payment_create_order', 'demo_complete_payment'])
    const q = queryFor('payments')[0]
    expect(q.ops).toContainEqual(['eq', ['id', 'pay-9']])
    expect(opArgs(q, 'single')).toBeDefined()
  })
  it('reports what the database says even if the user "chose" success', async () => {
    db.rpcs.payment_create_order = { data: 'p', error: null }
    db.tables.payments = { data: { id: 'p', status: 'failed', failure_reason: 'declined' }, error: null }
    const result = await payBill({ id: 'b', amount: 1 }, { chooseOutcome: async () => 'success' })
    expect(result).toMatchObject({ status: 'failed', failure_reason: 'declined' })
  })
  it('does not collect if the order could not be created', async () => {
    db.rpcs.payment_create_order = { data: null, error: new Error('bill already paid') }
    await expect(payBill({ id: 'b', amount: 1 }, {})).rejects.toThrow('bill already paid')
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })
  it('throws if the payment row cannot be read back', async () => {
    db.rpcs.payment_create_order = { data: 'p', error: null }
    db.tables.payments = { data: null, error: new Error('rls') }
    await expect(payBill({ id: 'b', amount: 1 }, { chooseOutcome: async () => 'success' })).rejects.toThrow('rls')
  })
})

describe('razorpayProvider', () => {
  it('createOrder invokes the edge function and keeps the bill description for the checkout', async () => {
    db.fnResult = { data: { paymentId: 'p1', orderId: 'order_1', keyId: 'rzp_test', amount: 7500 }, error: null }
    const order = await razorpayProvider.createOrder({ id: 'bill-1', description: 'Rent Nov' })
    expect(supabase.functions.invoke).toHaveBeenCalledWith('razorpay-create-order', { body: { billId: 'bill-1' } })
    expect(order).toMatchObject({ paymentId: 'p1', orderId: 'order_1', description: 'Rent Nov' })
  })
  it("createOrder surfaces the function's own error message", async () => {
    db.fnResult = { data: null, error: { message: 'generic', context: { json: async () => ({ error: 'Bill already paid' }) } } }
    await expect(razorpayProvider.createOrder({ id: 'b' })).rejects.toThrow('Bill already paid')
  })
  it('createOrder falls back to the generic message', async () => {
    db.fnResult = { data: null, error: { message: 'generic' } }
    await expect(razorpayProvider.createOrder({ id: 'b' })).rejects.toThrow('generic')
  })

  describe('collect()', () => {
    let opts, instance
    const order = { paymentId: 'p1', orderId: 'order_1', keyId: 'rzp_test', amount: 7500, description: 'Rent', prefill: { name: 'Asha' } }

    function fakeRazorpay(onOpen) {
      window.Razorpay = function Razorpay(o) {
        opts = o
        instance = this
        this.open = vi.fn(() => onOpen?.(o))
      }
    }

    it('opens Checkout with the order, the amount in paise and the site name', async () => {
      fakeRazorpay((o) => o.modal.ondismiss())
      await razorpayProvider.collect(order)
      expect(opts).toMatchObject({
        key: 'rzp_test', order_id: 'order_1', amount: 750000, currency: 'INR', name: 'YOLO Nest', description: 'Rent', prefill: { name: 'Asha' },
      })
      expect(instance.open).toHaveBeenCalled()
    })
    it('resolves without verifying when the customer closes Checkout', async () => {
      fakeRazorpay((o) => o.modal.ondismiss())
      await razorpayProvider.collect(order)
      expect(supabase.functions.invoke).not.toHaveBeenCalled()
    })
    it('sends the checkout response to razorpay-verify on success', async () => {
      db.fnResult = { data: { ok: true }, error: null }
      fakeRazorpay((o) => o.handler({ razorpay_payment_id: 'pay_x', razorpay_order_id: 'order_1', razorpay_signature: 'sig' }))
      await razorpayProvider.collect(order)
      expect(supabase.functions.invoke).toHaveBeenCalledWith('razorpay-verify', {
        body: { paymentId: 'p1', razorpay_payment_id: 'pay_x', razorpay_order_id: 'order_1', razorpay_signature: 'sig' },
      })
    })
    it('still resolves if verification fails (the webhook settles it)', async () => {
      db.fnResult = { data: null, error: { message: 'verify down' } }
      fakeRazorpay((o) => o.handler({ razorpay_payment_id: 'pay_x' }))
      await expect(razorpayProvider.collect(order)).resolves.toBeUndefined()
    })
    it('does not reload the Razorpay script when it is already present', async () => {
      fakeRazorpay((o) => o.modal.ondismiss())
      const before = document.head.querySelectorAll('script').length
      await razorpayProvider.collect(order)
      expect(document.head.querySelectorAll('script').length).toBe(before)
    })
  })

  it('collect rejects with a friendly message when the Razorpay script cannot load, and retries next time', async () => {
    const p = razorpayProvider.collect({ amount: 1 })
    const script = document.head.querySelector('script[src*="checkout.razorpay.com"]')
    expect(script).not.toBeNull()
    script.onerror()
    await expect(p).rejects.toThrow(/Could not load Razorpay/)

    const p2 = razorpayProvider.collect({ amount: 1 })
    const scripts = document.head.querySelectorAll('script[src*="checkout.razorpay.com"]')
    expect(scripts.length).toBe(2) // loading flag was reset, so a fresh attempt was made
    window.Razorpay = function R(o) { this.open = () => o.modal.ondismiss() }
    scripts[1].onload()
    await expect(p2).resolves.toBeUndefined()
  })
})
