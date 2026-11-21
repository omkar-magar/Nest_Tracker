// In-process Postgres (PGlite) with the real migration chain, the same order server/db/migrate.js uses:
// prelude -> supabase/migrations (storage files skipped) -> server/db/migrations -> seed -> post.
// Lets the SQL tests run without Docker or a Postgres install.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { SKIPPED } from '../../server/db/migrate.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const sqlIn = (dir) => readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.sql')).sort()

export async function freshDb({ seed = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(read('server/db/prelude.sql'))
  for (const f of sqlIn('supabase/migrations')) {
    if (SKIPPED.has(f)) continue
    try { await db.exec(read(`supabase/migrations/${f}`)) } catch (e) { throw new Error(`${f}: ${e.message}`) }
  }
  for (const f of sqlIn('server/db/migrations')) await db.exec(read(`server/db/migrations/${f}`))
  if (seed) await db.exec(read('supabase/seed.sql'))
  await db.exec(read('server/db/post.sql'))
  return db
}

// Creates a login (auth.users -> profiles trigger) and sets its role. Returns the user id.
export async function makeUser(db, role = 'customer', name = role) {
  const { rows } = await db.query(
    `insert into auth.users (email, encrypted_password, raw_user_meta_data)
     values ($1, 'x', jsonb_build_object('full_name', $2::text, 'phone', '9800000000')) returning id`,
    [`${name}-${Math.random().toString(36).slice(2)}@test.local`, name])
  const id = rows[0].id
  if (role !== 'customer') await db.query('update public.profiles set role = $1 where id = $2', [role, id])
  return id
}

// Runs fn as a signed-in user, the way Supabase / the Render API does: role authenticated + auth.uid().
export async function as(db, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.query(userId ? 'set local role authenticated' : 'set local role anon')
    if (userId) await tx.query("select set_config('app.user_id', $1, true)", [userId])
    return fn({
      q: async (sql, params) => (await tx.query(sql, params)).rows,
      one: async (sql, params) => (await tx.query(sql, params)).rows[0],
    })
  })
}

// Same, as the trusted server (service_role / job runner)
export const asService = (db, fn) => db.transaction(async (tx) => {
  await tx.query('set local role service_role')
  return fn({ q: async (s, p) => (await tx.query(s, p)).rows, one: async (s, p) => (await tx.query(s, p)).rows[0] })
})
