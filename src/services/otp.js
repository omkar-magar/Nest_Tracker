// Mobile-number check for sign-up. DEMO: the code is made in the browser and returned so the popup can show it,
// like the demo payments. For real SMS, replace both functions with a call to an SMS provider (Supabase phone auth
// or an edge function) and stop returning the code; the Signup page only uses these two functions.
let pending = null

export async function sendOtp(phone) {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  pending = { phone, code }
  return { demoCode: code }
}

export async function verifyOtp(phone, code) {
  const ok = !!pending && pending.phone === phone && pending.code === String(code).trim()
  if (ok) pending = null
  return ok
}
