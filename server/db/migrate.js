// Builds the Render database. Used by `npm run db:migrate` and as the Render pre-deploy command.
//
// Order: prelude.sql -> supabase/migrations/*.sql (unchanged, storage skipped) -> server/db/migrations/*.sql
//        -> (with --seed) supabase/seed.sql -> post.sql
// Each step runs in its own transaction and is recorded in public.schema_migrations, so a re-run only does new work.
// post.sql (grants) runs every time. Needs DATABASE_URL; set DATABASE_SSL=true for Render's external URL.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LOCK_ID = 727274 // stops two deploys migrating at once

// Supabase Storage is replaced by R2, so its bucket/policy migration is not applied.
export const SKIPPED = new Set(['20261104000004_storage.sql'])

const sqlFiles = async (dir) => (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

export async function listSteps(root = repoRoot) {
  const sbDir = path.join(root, 'supabase/migrations')
  const ownDir = path.join(root, 'server/db/migrations')
  const steps = [{ name: 'server/db/prelude.sql', file: path.join(root, 'server/db/prelude.sql') }]
  for (const f of await sqlFiles(sbDir)) {
    if (!SKIPPED.has(f)) steps.push({ name: `supabase/migrations/${f}`, file: path.join(sbDir, f) })
  }
  for (const f of await sqlFiles(ownDir)) steps.push({ name: `server/db/migrations/${f}`, file: path.join(ownDir, f) })
  return {
    steps,
    seed: { name: 'supabase/seed.sql', file: path.join(root, 'supabase/seed.sql') },
    post: { name: 'server/db/post.sql', file: path.join(root, 'server/db/post.sql') },
  }
}

async function inTransaction(client, fn) {
  await client.query('begin')
  try {
    await fn()
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  }
}

export async function runMigrations({ client, root = repoRoot, seed = false, log = console.log }) {
  const plan = await listSteps(root)
  await client.query('select pg_advisory_lock($1)', [LOCK_ID])
  try {
    await client.query('create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())')
    const done = new Set((await client.query('select name from public.schema_migrations')).rows.map((r) => r.name))

    const apply = async (step, { record }) => {
      const sql = await readFile(step.file, 'utf8')
      try {
        await inTransaction(client, async () => {
          await client.query(sql)
          if (record) await client.query('insert into public.schema_migrations (name) values ($1)', [step.name])
        })
      } catch (err) {
        err.message = `${step.name}: ${err.message}`
        throw err
      }
      log(`applied ${step.name}`)
    }

    const todo = plan.steps.filter((s) => !done.has(s.name))
    for (const step of todo) await apply(step, { record: true })
    if (seed && !done.has(plan.seed.name)) await apply(plan.seed, { record: true })
    await apply(plan.post, { record: false })
    log(todo.length ? `done, ${todo.length} migration(s) applied` : 'database already up to date')
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID])
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set (see server/.env.example)')
    process.exit(1)
  }
  const client = new pg.Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  })
  try {
    await client.connect()
    await runMigrations({ client, seed: process.argv.includes('--seed') })
  } catch (err) {
    console.error('migration failed:', err.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}
