// Tenant details form (PRD 3.1), shared by the office's tenant page and the tenant's own account page.
export const TENANT_FIELDS = [
  { key: 'full_name', label: 'Full name', required: true },
  { key: 'phone', label: 'Mobile number', type: 'tel', required: true },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'dob', label: 'Date of birth', type: 'date' },
  { key: 'gender', label: 'Gender', type: 'select', options: ['male', 'female', 'other', 'undisclosed'] },
  { key: 'occupation', label: 'Occupation', type: 'select', options: [['student', 'Student'], ['working', 'Working professional'], ['other', 'Other']] },
  { key: 'organisation', label: 'College / company' },
  { key: 'work_address', label: 'College / work address' },
  { key: 'permanent_address', label: 'Permanent address', type: 'textarea' },
  { key: 'emergency1_name', label: 'Emergency contact name', required: true },
  { key: 'emergency1_relation', label: 'Relationship', required: true },
  { key: 'emergency1_phone', label: 'Emergency contact mobile', type: 'tel', required: true },
  { key: 'emergency2_name', label: 'Second contact name (optional)' },
  { key: 'emergency2_relation', label: 'Relationship' },
  { key: 'emergency2_phone', label: 'Second contact mobile', type: 'tel' },
  { key: 'guardian_name', label: 'Parent / guardian name (students)' },
  { key: 'guardian_relation', label: 'Relationship' },
  { key: 'guardian_phone', label: 'Guardian mobile', type: 'tel' },
  { key: 'guardian_email', label: 'Guardian email', type: 'email' },
  { key: 'guardian_consent_payments', label: 'Send rent reminders to the guardian too', type: 'checkbox', span: true },
  { key: 'guardian_consent_complaints', label: 'Send complaint updates to the guardian too', type: 'checkbox', span: true },
]

export const tenantFormValue = (profile) => {
  const t = profile?.tenant_profiles ?? {}
  const v = { full_name: profile?.full_name ?? '', phone: profile?.phone ?? '' }
  for (const f of TENANT_FIELDS) if (!(f.key in v)) v[f.key] = t[f.key] ?? (f.type === 'checkbox' ? false : '')
  return v
}

export function validateTenant(v) {
  const digits = (s) => String(s || '').replace(/\D/g, '')
  if (!v.full_name?.trim()) return 'Enter the full name'
  if (digits(v.phone).length < 10) return 'Enter a 10-digit mobile number'
  if (!v.emergency1_name?.trim() || digits(v.emergency1_phone).length < 10) return 'Add at least one emergency contact with a 10-digit mobile number'
  return ''
}
