import pg from 'pg'

export function createPool(config) {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  })
  pool.on('error', (err) => console.error('idle database client error', err.message)) // must not crash the process
  return pool
}

export const ROLES = new Set(['anon', 'authenticated', 'service_role'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Runs fn(client) in one transaction AS a database role, with auth.uid() returning userId.
// This is what replaces Supabase's JWT-to-Postgres handoff: row-level security and the SQL functions
// see the same user they saw on Supabase. Both settings are transaction-local, so a pooled
// connection can never carry one request's identity into the next.
//   anon           public reads (userId null)
//   authenticated  a signed-in user (userId required)
//   service_role   trusted server work such as apply_payment_result (userId null)
export async function withUser(pool, { userId = null, role = userId ? 'authenticated' : 'anon' } = {}, fn) {
  if (!ROLES.has(role)) throw new Error(`Unknown database role: ${role}`)
  if (userId !== null && !UUID.test(userId)) throw new Error('Bad user id')
  if (role === 'authenticated' && userId === null) throw new Error('authenticated needs a user id')

  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query("select set_config('app.user_id', $1, true)", [userId ?? ''])
    await client.query(`set local role ${role}`) // role is checked against ROLES above; SET cannot take a parameter
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// Work only the server may do (reading password hashes, issuing tokens): runs as the database owner,
// outside row-level security. Never call this with anything a browser could steer into a query.
export async function withOwner(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
