import { supabase } from '../lib/supabase'
import { rows, rpc } from './manage'
import { paymentProvider, payRegistration } from './payments'

export const DEMO_EMAIL = 'customer@yolonest.test'
export const demoEnabled = import.meta.env.VITE_DEMO_REGISTRATION === 'true'
export const submitRegistration = (p) => rpc('submit_resident_registration', { p })
// daily stays past their check-out date leave first (the hosted project has no job scheduler), then the status loads
export const runDueCheckouts = () => rpc('register_auto_checkout').catch(() => 0)
export const myRegistration = async () => { await runDueCheckouts(); return rpc('my_registration') }
export const registrationStayError = (p) => p.check_in && p.expected_checkout && p.expected_checkout < p.check_in
  ? 'Expected check-out must be on or after check-in. Check the day, month and year.' : ''

export async function approveRegistration(id, p) {
  const error = registrationStayError(p)
  if (error) throw new Error(error)
  try {
    return await rpc('approve_resident_registration', { p_user: id, p })
  } catch (e) {
    if (e.code === '23514' && e.message?.includes('"register_guests_check"')) {
      throw new Error('Expected check-out must be on or after check-in. Check the day, month and year.')
    }
    throw e
  }
}
export const registrationProperties = () => rows('properties', 'id, name', (q) => q.eq('is_active', true).order('id'))
// pending registrations, each with the registration payment it was submitted with (or null)
export async function newRegistrations(pid) {
  const list = await rows('tenant_profiles', '*, profiles!tenant_profiles_user_id_fkey(full_name, phone)', (q) =>
    (pid ? q.eq('property_id', pid) : q).eq('registration_state', 'pending').order('updated_at', { ascending: false }).limit(200))
  if (!list?.length) return list ?? []
  const pays = await rows('registration_payments', 'customer_id, amount, status, is_simulated, completed_at', (q) =>
    q.in('customer_id', list.map((r) => r.user_id)).eq('status', 'succeeded').order('completed_at', { ascending: false }))
  // only a payment made for this registration (after it was sent), not one left from an earlier registration
  const sent = (r) => (r.rules_accepted_at ? Date.parse(r.rules_accepted_at) : -Infinity)
  return list.map((r) => ({
    ...r,
    registration_payment: (pays ?? []).find((p) => p.customer_id === r.user_id && Date.parse(p.completed_at) >= sent(r)) ?? null,
  }))
}

export async function demoSignIn(code) {
  const { data, error } = await supabase.functions.invoke('demo-registration', { body: { code } })
  if (error) {
    let message = error.message
    try { message = (await error.context.json()).error || message } catch { /* response may have no JSON */ }
    throw new Error(message)
  }
  const result = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'email' })
  if (result.error) throw result.error
  return result.data
}

export const demoRegistration = () => ({
  full_name: 'Demo Customer', phone: '9800000000', email: DEMO_EMAIL,
  dob: '2000-01-01', gender: 'undisclosed', permanent_address: 'Demo address, Pune (test data)',
  emergency1_name: 'Demo Contact', emergency1_relation: 'Parent', emergency1_phone: '9800000001',
  emergency2_name: 'Demo Second Contact', emergency2_relation: 'Sibling', emergency2_phone: '9800000002',
  occupation: 'working', organisation: 'Demo Company', work_address: 'Demo office, Pune',
  guardian_name: 'Demo Guardian', guardian_relation: 'Parent', guardian_phone: '9800000003', guardian_email: DEMO_EMAIL,
  guardian_consent_payments: false, guardian_consent_complaints: false,
  room_type_pref: 'shared_room', move_in_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
  stay_duration: '3 months (demo)', id_proof_type: 'aadhaar', id_last4: '0000',
  rules_accepted: true, rules_signature: 'Demo Customer',
})

// Stay choice on the registration form. Prices live in Settings (stay_prices); the database works out the amount.
export const STAY_TYPES = [['pg', 'PG (monthly)'], ['flat', 'Flat (monthly)'], ['pg_daily', 'PG daily'], ['flat_daily', 'Flat daily']]
export const stayLabel = (t) => STAY_TYPES.find(([k]) => k === t)?.[1] ?? t ?? ''
export const isDaily = (t) => t === 'pg_daily' || t === 'flat_daily'
export const stayQuote = (type, from, to) => rpc('stay_quote', { p_type: type, p_from: from || null, p_to: to || null })
export const registrationRooms = (pid, type) => rpc('registration_rooms', { p_property: pid, p_type: type })
const dayOf = (ymd) => Number(String(ymd).slice(8, 10))
// joining on the 1st-10th makes the joining day the due day (same rule as the database)
export const dueDayFor = (moveIn, chosen) => (moveIn && dayOf(moveIn) <= 10 ? dayOf(moveIn) : Number(chosen) || null)
export function firstDue(moveIn, dueDay) {
  if (!moveIn) return null
  const [y, m, d] = moveIn.split('-').map(Number)
  const pad = (n) => String(n).padStart(2, '0')
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  if (d <= 10) return `${ny}-${pad(nm)}-${pad(d)}`
  return dueDay ? `${ny}-${pad(nm)}-${pad(dueDay)}` : null
}

// Real signups: Supabase emails a 6-digit code (the template needs {{ .Token }}); the link in the same email works too.
export async function verifyEmailCode(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({ email, token: token.trim(), type: 'signup' })
  if (error) throw error
  return data
}

// Paying the registration online from the account page. Demo provider: the payer picks the outcome.
// Razorpay: Checkout opens; the result is the payment row ('created' if they closed it without paying).
export async function payMyRegistration(outcome) {
  if (!paymentProvider.isSimulated) return payRegistration()
  const order = await rpc('start_my_registration_payment')
  return rpc('demo_complete_my_registration_payment', { p_id: order.id, p_outcome: outcome })
}
export const registrationBalance = (r) => Math.max((r?.amount_due ?? 0) - (r?.amount_paid ?? 0), 0)
