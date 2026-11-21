// Customer asks to pay a bill. Creates a Razorpay order for what is still owed (or a smaller part payment) and a payments row
// (status 'created'). Nothing is marked paid here; that only happens in apply_payment_result().
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const keyId = Deno.env.get('RAZORPAY_KEY_ID')
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keyId || !keySecret) return json({ error: 'Razorpay is not configured' }, 500)

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: userData } = await caller.auth.getUser()
  const user = userData.user
  if (!user) return json({ error: 'Not signed in' }, 401)

  const { billId, amount: wanted } = await req.json().catch(() => ({}))
  if (!billId) return json({ error: 'billId is required' }, 400)

  // What is owed always comes from the database. The browser may only ask to pay less (a part payment).
  const { data: bill } = await admin.from('bills')
    .select('id, amount, amount_paid, status').eq('id', billId).eq('customer_id', user.id).maybeSingle()
  if (!bill) return json({ error: 'Bill not found' }, 404)
  if (bill.status !== 'unpaid') return json({ error: 'This bill is not payable' }, 400)
  const owed = bill.amount - bill.amount_paid
  const amount = wanted == null ? owed : Math.floor(Number(wanted))
  if (!Number.isFinite(amount) || amount < 1 || amount > owed) return json({ error: `Enter an amount between 1 and ${owed}` }, 400)

  const paymentId = crypto.randomUUID()
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${keyId}:${keySecret}`), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amount * 100, // rupees -> paise
      currency: 'INR',
      receipt: paymentId,
      notes: { payment_id: paymentId, bill_id: bill.id },
    }),
  })
  const order = await res.json().catch(() => ({}))
  if (!res.ok || !order.id) {
    console.error('razorpay order failed', res.status, order)
    return json({ error: 'Could not start the payment. Please try again.' }, 502)
  }

  const { error } = await admin.from('payments').insert({
    id: paymentId, bill_id: bill.id, customer_id: user.id, amount,
    provider: 'razorpay', is_simulated: false, provider_order_id: order.id,
  })
  if (error) return json({ error: error.message }, 500)

  const { data: profile } = await admin.from('profiles').select('full_name, phone').eq('id', user.id).maybeSingle()
  return json({
    paymentId, orderId: order.id, keyId, amount,
    prefill: { name: profile?.full_name || undefined, email: user.email, contact: profile?.phone || undefined },
  })
})
