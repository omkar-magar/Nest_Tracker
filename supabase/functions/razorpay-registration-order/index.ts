// Resident pays the registration (stay price + deposit) online. The amount always comes from the database
// (razorpay_start_registration_payment); nothing is marked paid here, only in apply_registration_payment().
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

  const { data: start, error: startErr } = await admin.rpc('razorpay_start_registration_payment', { p_user: user.id })
  if (startErr) return json({ error: startErr.message }, 400)
  let orderId: string | null = start.order_id

  if (!orderId) {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${keyId}:${keySecret}`), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: start.amount * 100, // rupees -> paise
        currency: 'INR',
        receipt: start.id,
        notes: { registration_payment_id: start.id },
      }),
    })
    const order = await res.json().catch(() => ({}))
    if (!res.ok || !order.id) {
      console.error('razorpay order failed', res.status, order)
      return json({ error: 'Could not start the payment. Please try again.' }, 502)
    }
    // a second click may have attached its order first: then use that one
    const { data: set } = await admin.from('registration_payments').update({ provider_order_id: order.id })
      .eq('id', start.id).is('provider_order_id', null).select('provider_order_id')
    if (set?.length) orderId = order.id
    else {
      const { data: row } = await admin.from('registration_payments').select('provider_order_id').eq('id', start.id).single()
      orderId = row?.provider_order_id ?? null
    }
    if (!orderId) return json({ error: 'Could not start the payment. Please try again.' }, 500)
  }

  const { data: profile } = await admin.from('profiles').select('full_name, phone').eq('id', user.id).maybeSingle()
  return json({
    paymentId: start.id, orderId, keyId, amount: start.amount,
    prefill: { name: profile?.full_name || undefined, email: user.email, contact: profile?.phone || undefined },
  })
})
