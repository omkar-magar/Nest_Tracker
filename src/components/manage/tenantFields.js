// Tenant details form (PRD 3.1), shared by the office's tenant page, the tenant's own account page and the public
// sign-up. It follows the paper Resident Registration Form: sections 1-5 are TENANT_SECTIONS, section 6 is RULES.
const phone = { type: 'tel' }
export const TENANT_SECTIONS = [
  { title: '1. Personal details', fields: [
    { key: 'full_name', label: 'Full name', required: true },
    { key: 'dob', label: 'Date of birth', type: 'date' },
    { key: 'phone', label: 'Mobile number', required: true, ...phone },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'gender', label: 'Gender', type: 'select', options: ['male', 'female', 'other', 'undisclosed'] },
    { key: 'permanent_address', label: 'Permanent address', type: 'textarea' },
  ] },
  { title: '2. Emergency contact details', fields: [
    { key: 'emergency1_name', label: 'Name', required: true },
    { key: 'emergency1_relation', label: 'Relationship', required: true },
    { key: 'emergency1_phone', label: 'Mobile number', required: true, ...phone },
    { key: 'emergency2_name', label: 'Second contact name (optional)' },
    { key: 'emergency2_relation', label: 'Relationship' },
    { key: 'emergency2_phone', label: 'Second contact mobile', ...phone },
  ] },
  { title: '3. Occupation details', fields: [
    { key: 'occupation', label: 'Occupation', type: 'select', options: [['student', 'Student'], ['working', 'Working professional'], ['business', 'Business'], ['other', 'Other']] },
    { key: 'organisation', label: 'Company / college name' },
    { key: 'work_address', label: 'Work / college location' },
    { key: 'guardian_name', label: 'Parent / guardian name (students)' },
    { key: 'guardian_relation', label: 'Relationship' },
    { key: 'guardian_phone', label: 'Guardian mobile', ...phone },
    { key: 'guardian_email', label: 'Guardian email', type: 'email' },
    { key: 'guardian_consent_payments', label: 'Send rent reminders to the guardian too', type: 'checkbox', span: true },
    { key: 'guardian_consent_complaints', label: 'Send complaint updates to the guardian too', type: 'checkbox', span: true },
  ] },
  { title: '4. Stay details', fields: [
    { key: 'room_type_pref', label: 'Room type', type: 'select', options: [['bed_in_hall', 'Bed in hall'], ['shared_room', 'Shared room'], ['private_room', 'Private room'], ['one_bhk', '1 BHK flat']] },
    { key: 'move_in_date', label: 'Move-in date', type: 'date' },
    { key: 'stay_duration', label: 'Expected stay duration', placeholder: 'e.g. 6 months' },
  ] },
  { title: '5. Identity verification', fields: [
    { key: 'id_proof_type', label: 'ID proof', type: 'select', options: [['aadhaar', 'Aadhaar card'], ['pan', 'PAN card'], ['passport', 'Passport'], ['driving_licence', 'Driving licence']] },
    { key: 'id_last4', label: 'Last 4 characters of the ID number', maxLength: 4, help: 'Bring the original ID at check-in; the office will scan it.' },
  ] },
]
export const TENANT_FIELDS = TENANT_SECTIONS.flatMap((s) => s.fields)

// section 6 of the form
export const RULES = [
  ['Security deposit & rent', 'Payment of the security deposit and one month advance rent is compulsory before check-in.'],
  ['Lock-in period', 'The minimum lock-in period is 3 months from the date of move-in.'],
  ['Security deposit refund', 'If the resident vacates before completing the lock-in period, the security deposit will not be refundable.'],
  ['Monthly rent', 'Monthly rent must be paid on or before the 3rd of every month.'],
  ['Late payment charges', 'A late fee of ₹500 per day will be charged for rent paid after the due date.'],
  ['Visitors policy', 'Female residents may invite only female friends. Male residents may invite only male friends. Cross-gender visitors are strictly not permitted inside the premises.'],
  ['Floor access policy', 'Residents are not allowed to visit or meet friends on other floors. Guests and visitors must remain only in the designated permitted area, if allowed by management.'],
  ['Visitor intimation', 'If a male visitor is expected, the resident must inform the management in advance before the visitor arrives. Management reserves the right to approve or deny visitor entry.'],
  ['Property care', 'Any damage to rooms, furniture, appliances, fixtures or common areas caused by negligence will be recovered from the resident and may be deducted from the security deposit.'],
  ['Discipline & cleanliness', 'Residents must maintain cleanliness, hygiene and respectful behaviour at all times.'],
  ['Misconduct', 'Illegal activities, nuisance, or intoxication causing disturbance, or misconduct may result in immediate termination of accommodation without prior notice.'],
  ['Management rights', 'YOLO Nest Coliving reserves the right to update or modify these rules whenever necessary for the safety, security and comfort of all residents.'],
]

export const tenantFormValue = (profile) => {
  const t = profile?.tenant_profiles ?? {}
  const v = { full_name: profile?.full_name ?? '', phone: profile?.phone ?? '' }
  for (const f of TENANT_FIELDS) if (!(f.key in v)) v[f.key] = t[f.key] ?? (f.type === 'checkbox' ? false : '')
  return v
}

// A sign-up that needs email confirmation has no session yet, so the filled form waits in this browser and is
// offered again (to review and save) on the account page after the first login.
const STASH = 'yn-registration'
export const stashRegistration = (v) => { try { localStorage.setItem(STASH, JSON.stringify(v)) } catch { /* private mode */ } }
export const readStash = () => { try { return JSON.parse(localStorage.getItem(STASH)) || null } catch { return null } }
export const clearStash = () => { try { localStorage.removeItem(STASH) } catch { /* private mode */ } }

export function validateTenant(v) {
  const digits = (s) => String(s || '').replace(/\D/g, '')
  if (!v.full_name?.trim()) return 'Enter the full name'
  if (digits(v.phone).length < 10) return 'Enter a 10-digit mobile number'
  if (!v.emergency1_name?.trim() || digits(v.emergency1_phone).length < 10) return 'Add at least one emergency contact with a 10-digit mobile number'
  return ''
}
