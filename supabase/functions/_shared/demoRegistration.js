const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

export const demoRegistrationHandler = ({ enabled, createAdmin }) => async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!enabled) return json({ error: 'Demo registration is disabled' }, 403)
  const body = await req.json().catch(() => ({}))
  if (typeof body.code !== 'string' || !body.code.trim() || body.code.length > 128) return json({ error: 'Enter any demo code' }, 400)
  try {
    const admin = createAdmin()
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'customer@yolonest.test' })
    if (error || !data?.user) return json({ error: 'Could not open demo account' }, 400)
    const { data: profile, error: profileError } = await admin.from('profiles').select('role, is_active').eq('id', data.user.id).single()
    if (profileError || profile?.role !== 'customer' || !profile.is_active) return json({ error: 'Demo account must be an active customer' }, 403)
    return json({ token_hash: data.properties.hashed_token })
  } catch {
    return json({ error: 'Could not open demo account. Please try again.' }, 500)
  }
}
