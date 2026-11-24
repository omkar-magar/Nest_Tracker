// Mobile-number check for sign-up. DEMO: any code is accepted, nothing is sent. For real SMS, replace both
// functions with a call to an SMS provider (Supabase phone auth or an edge function); the Signup page only uses these two.
export async function sendOtp() {
  return {}
}

export async function verifyOtp(phone, code) {
  return String(code ?? '').trim() !== ''
}
