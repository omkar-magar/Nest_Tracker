// Called by the browser right after Razorpay Checkout succeeds, so the customer sees the result immediately.
// The browser's callback is not trusted: we recompute the checkout signature with the secret key.
// The webhook (razorpay-webhook) is the backstop if the customer closes the tab before this runs.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, hmacHex, json, safeEqual } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keySecret) return json({ error: 'Razorpay is not configured' }, 500)

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: userData } = await caller.auth.getUser()
  if (!userData.user) return json({ error: 'Not signed in' }, 401)

  const { paymentId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json().catch(() => ({}))
  if (!paymentId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return json({ error: 'Missing payment details' }, 400)
  }

  const { data: pay } = await admin.from('payments')
    .select('id, provider, provider_order_id').eq('id', paymentId).eq('customer_id', userData.user.id).maybeSingle()
  if (!pay || pay.provider !== 'razorpay' || pay.provider_order_id !== razorpay_order_id) {
    return json({ error: 'Payment not found' }, 404)
  }

  const expected = await hmacHex(keySecret, `${razorpay_order_id}|${razorpay_payment_id}`)
  if (!safeEqual(expected, String(razorpay_signature))) return json({ error: 'Bad signature' }, 400)

  const { data, error } = await admin.rpc('apply_payment_result', {
    p_payment_id: pay.id, p_status: 'succeeded', p_provider_payment_id: razorpay_payment_id,
  })
  if (error) return json({ error: error.message }, 500)
  return json({ status: data })
})
