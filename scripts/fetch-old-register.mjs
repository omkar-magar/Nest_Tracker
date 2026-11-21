// Downloads the tenant list from the old stand-alone "PG Manager" page's Supabase project as the same JSON
// backup that page's "Backup (JSON)" button makes. Import the file in Guest register -> Import and AI link.
// That project only lets a signed-in staff login read, so this needs its email and password:
//
//   OLD_SUPABASE_URL=https://<project>.supabase.co OLD_SUPABASE_KEY=<publishable key> \
//   OLD_EMAIL=<staff email> OLD_PASSWORD=<password> node scripts/fetch-old-register.mjs
//
// The file holds real names and phone numbers: it is written to register-backups/ (git-ignored). Don't commit it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const { OLD_SUPABASE_URL: url, OLD_SUPABASE_KEY: key, OLD_EMAIL: email, OLD_PASSWORD: password } = process.env
if (!url || !key || !email || !password) {
  console.error('Set OLD_SUPABASE_URL, OLD_SUPABASE_KEY, OLD_EMAIL and OLD_PASSWORD (see the top of this file).')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })
const { error: authError } = await sb.auth.signInWithPassword({ email, password })
if (authError) { console.error(`Login failed: ${authError.message}`); process.exit(1) }

const all = async (table, order) => {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').order(order).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) return out
  }
}
const guests = await all('guests', 'sort_order')
const history = await all('guest_history', 'id')
mkdirSync('register-backups', { recursive: true })
const file = `register-backups/old-register-${new Date().toISOString().slice(0, 10)}.json`
writeFileSync(file, JSON.stringify({ exported_at: new Date().toISOString(), guests, history }, null, 1))
const deleted = history.filter((h) => h.op === 'DELETE' && h.old_row?.name).length
console.log(`Saved ${guests.length} guests and ${history.length} history rows (${deleted} deleted guests) to ${file}`)
await sb.auth.signOut()
