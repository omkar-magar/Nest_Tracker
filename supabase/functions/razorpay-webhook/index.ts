// Razorpay -> us. Public endpoint (verify_jwt = false in config.toml); trust comes from the HMAC signature.
// Subscribe to: payment.captured and order.paid.
// payment.failed is deliberately ignored: Checkout lets the customer retry on the same order, and
// apply_payment_result() is final once a payment is marked failed. An abandoned payment just stays 'created'.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { hmacHex, json, safeEqual } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')
  if (!secret) return json({ error: 'Webhook secret not configured' }, 500)

  const raw = await req.text() // sign the raw body, not re-serialised JSON
  const sig = req.headers.get('x-razorpay-signature') ?? ''
  if (!safeEqual(await hmacHex(secret, raw), sig)) return json({ error: 'Bad signature' }, 400)

  const event = JSON.parse(raw)
  if (event.event !== 'payment.captured' && event.event !== 'order.paid') return json({ ok: true, ignored: event.event })

  const rp = event.payload?.payment?.entity
  if (!rp?.order_id || !rp?.id) return json({ ok: true, ignored: 'no payment entity' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: pay } = await admin.from('payments')
    .select('id, amount, provider').eq('provider_order_id', rp.order_id).maybeSingle()
  if (!pay || pay.provider !== 'razorpay') return json({ ok: true, ignored: 'unknown order' }) // 200 so Razorpay stops retrying

  if (rp.amount !== pay.amount * 100 || rp.currency !== 'INR') {
    console.error('amount mismatch', pay.id, rp.amount, rp.currency)
    return json({ error: 'Amount mismatch' }, 400)
  }

  const { error } = await admin.rpc('apply_payment_result', {
    p_payment_id: pay.id, p_status: 'succeeded', p_provider_payment_id: rp.id,
  })
  if (error) return json({ error: error.message }, 500) // non-2xx -> Razorpay retries
  return json({ ok: true })
})
