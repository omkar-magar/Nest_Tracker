import { supabase } from '../lib/supabase'
import { rows, rpc } from './manage'

export const DEMO_EMAIL = 'customer@yolonest.test'
export const demoEnabled = import.meta.env.VITE_DEMO_REGISTRATION === 'true'
export const submitRegistration = (p) => rpc('submit_resident_registration', { p })
export const myRegistration = () => rpc('my_registration')
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
  return list.map((r) => ({ ...r, registration_payment: (pays ?? []).find((p) => p.customer_id === r.user_id) ?? null }))
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

// Registration payment: taken on the signup form before the OTP, so it is keyed by email (no account yet).
// Only the demo provider can take it for now; the owner sets the amount in Settings (0 = none).
export const registrationFee = () => rpc('registration_fee')
export async function payRegistration({ email, phone, propertyId }, outcome) {
  const order = await rpc('start_registration_payment', { p_email: email, p_phone: phone || '', p_property: propertyId || null })
  return rpc('demo_complete_registration_payment', { p_id: order.id, p_outcome: outcome })
}

// Real signups: Supabase emails a 6-digit code (the template needs {{ .Token }}); the link in the same email works too.
export async function verifyEmailCode(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({ email, token: token.trim(), type: 'signup' })
  if (error) throw error
  return data
}
