// Creates an employee account. Runs server-side because it needs the service-role key.
// Only a logged-in admin may call it: the caller's JWT is checked against profiles.role.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase; never ship the last one to the browser.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

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
  if (me?.role !== 'admin' || !me.is_active) return json({ error: 'Admins only' }, 403)

  const { email, password, full_name, phone } = await req.json().catch(() => ({}))
  if (!email || !full_name || !password || String(password).length < 8) {
    return json({ error: 'Name, email and a password of at least 8 characters are required' }, 400)
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name, phone },
  })
  if (error || !created.user) return json({ error: error?.message ?? 'Could not create user' }, 400)

  const id = created.user.id
  // the signup trigger made a customer profile; promote it and give the default permission set
  const up = await admin.from('profiles').update({ role: 'employee' }).eq('id', id)
  const perms = await admin.from('employee_permissions').insert({ employee_id: id })
  if (up.error || perms.error) {
    await admin.auth.admin.deleteUser(id) // don't leave a half-made account behind
    return json({ error: (up.error ?? perms.error)!.message }, 500)
  }
  await admin.from('activity_log').insert({
    actor_id: userData.user.id, action: 'employee.created', entity: 'employee', entity_id: id,
  })
  return json({ id })
})
