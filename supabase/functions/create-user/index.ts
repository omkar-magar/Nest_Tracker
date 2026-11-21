// Creates a login for a tenant registered at the office, or for a manager / staff / sales executive.
// The owner may create any role; a manager may create tenants for the properties they manage.
// Email is optional for tenants: without one, the account is made for phone (OTP) login.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const ROLES = ['customer', 'manager', 'employee', 'sales']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: userData } = await caller.auth.getUser()
  if (!userData.user) return json({ error: 'Not signed in' }, 401)
  const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', userData.user.id).single()
  if (!me?.is_active || !['admin', 'manager'].includes(me.role)) return json({ error: 'Not allowed' }, 403)

  const body = await req.json().catch(() => ({}))
  const role = String(body.role ?? 'customer')
  const fullName = String(body.full_name ?? '').trim()
  const phone = String(body.phone ?? '').replace(/\D/g, '')
  const email = String(body.email ?? '').trim()
  const password = body.password ? String(body.password) : undefined
  const propertyId = body.property_id ? String(body.property_id) : null

  if (!ROLES.includes(role)) return json({ error: 'Unknown role' }, 400)
  if (me.role !== 'admin' && role !== 'customer') return json({ error: 'Only the owner can create staff logins' }, 403)
  if (!fullName || phone.length < 10) return json({ error: 'Name and a 10-digit mobile number are required' }, 400)
  if (role !== 'customer' && !email) return json({ error: 'Staff logins need an email' }, 400)
  if (password && password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400)
  if (propertyId && me.role === 'manager') {
    const { data: ok } = await caller.rpc('can_manage_property', { p: propertyId })
    if (!ok) return json({ error: 'You do not manage this property' }, 403)
  }

  const e164 = phone.length === 10 ? `91${phone}` : phone
  const { data: created, error } = await admin.auth.admin.createUser({
    ...(email ? { email, email_confirm: true } : {}),
    phone: e164,
    phone_confirm: true,
    password: password ?? crypto.randomUUID(), // without a password the tenant signs in with an OTP or resets it
    user_metadata: { full_name: fullName, phone },
  })
  if (error || !created.user) return json({ error: error?.message ?? 'Could not create user' }, 400)
  const id = created.user.id

  const steps = []
  if (role !== 'customer') {
    steps.push(admin.from('profiles').update({ role }).eq('id', id))
    if (role === 'employee') steps.push(admin.from('employee_permissions').insert({ employee_id: id }))
    if (propertyId) steps.push(admin.from('property_members').insert({ property_id: propertyId, user_id: id }))
  } else {
    steps.push(admin.from('tenant_profiles').insert({
      user_id: id, property_id: propertyId, email: email || null, created_by: userData.user.id,
    }))
  }
  const failed = (await Promise.all(steps)).find((r) => r.error)
  if (failed) {
    await admin.auth.admin.deleteUser(id) // don't leave a half-made account behind
    return json({ error: failed.error!.message }, 500)
  }
  await admin.from('activity_log').insert({
    actor_id: userData.user.id, action: `${role}.created`, entity: 'user', entity_id: id,
  })
  return json({ id })
})
