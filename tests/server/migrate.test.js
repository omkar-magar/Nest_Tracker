// @vitest-environment node
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SKIPPED, listSteps, runMigrations } from '../../server/db/migrate.js'

const root = path.resolve(__dirname, '../..')

// Records every query; no database involved.
function fakeClient({ applied = [], failOn } = {}) {
  const log = []
  return {
    log,
    async query(sql, params) {
      log.push({ sql, params })
      if (failOn && typeof sql === 'string' && sql.includes(failOn)) throw new Error('boom')
      if (/select name from public\.schema_migrations/.test(sql)) return { rows: applied.map((name) => ({ name })) }
      return { rows: [] }
    },
  }
}
const recorded = (c) => c.log.filter((q) => /insert into public\.schema_migrations/.test(q.sql)).map((q) => q.params[0])
const quiet = () => {}

describe('migration plan', () => {
  it('runs the prelude first, then supabase files in order, then server files', async () => {
    const { steps } = await listSteps(root)
    const names = steps.map((s) => s.name)
    expect(names[0]).toBe('server/db/prelude.sql')
    const sb = names.filter((n) => n.startsWith('supabase/'))
    expect(sb).toEqual([...sb].sort())
    expect(sb).toHaveLength(5)
    expect(names.indexOf(sb.at(-1))).toBeLessThan(names.indexOf('server/db/migrations/001_availability_notify.sql'))
    expect(names.slice(-2)).toEqual([
      'server/db/migrations/001_availability_notify.sql',
      'server/db/migrations/002_auth_tokens.sql',
    ])
  })

  it('skips the Supabase Storage migration', async () => {
    const { steps } = await listSteps(root)
    expect(SKIPPED.has('20261104000004_storage.sql')).toBe(true)
    expect(steps.some((s) => s.name.includes('storage'))).toBe(false)
  })
})

describe('Supabase SQL runs unchanged on plain Postgres', () => {
  it('sends the supabase migration files byte for byte', async () => {
    const c = fakeClient()
    await runMigrations({ client: c, root, log: quiet })
    const file = '20261104000003_functions.sql'
    const sent = c.log.map((q) => q.sql)
    expect(sent).toContain(await readFile(path.join(root, 'supabase/migrations', file), 'utf8'))
  })

  it('only uses auth.uid() and auth.users, which prelude.sql provides', async () => {
    const dir = path.join(root, 'supabase/migrations')
    const used = new Set()
    for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql') && !SKIPPED.has(f))) {
      const sql = await readFile(path.join(dir, f), 'utf8')
      for (const m of sql.matchAll(/\bauth\.([a-z_]+)/g)) used.add(m[1])
    }
    // an unexpected one (auth.jwt, auth.role, auth.identities...) would fail on Render: add it to prelude.sql first
    expect([...used].sort()).toEqual(['uid', 'users'])
  })

  it('does not touch the storage schema outside the skipped file', async () => {
    const dir = path.join(root, 'supabase/migrations')
    for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql') && !SKIPPED.has(f))) {
      expect(await readFile(path.join(dir, f), 'utf8'), f).not.toMatch(/\bstorage\./)
    }
  })

  it('prelude defines the roles, auth.users and an auth.uid() that reads app.user_id', async () => {
    const sql = await readFile(path.join(root, 'server/db/prelude.sql'), 'utf8')
    for (const role of ['anon', 'authenticated', 'service_role']) expect(sql).toContain(`rolname = '${role}'`)
    expect(sql).toMatch(/create table auth\.users/)
    expect(sql).toMatch(/current_setting\('app\.user_id', true\)/)
    expect(sql).toMatch(/enable row level security/)
  })

  it('only stores hashed tokens', async () => {
    const sql = await readFile(path.join(root, 'server/db/migrations/002_auth_tokens.sql'), 'utf8')
    expect(sql).toMatch(/token_hash\s+text not null unique/)
    expect(sql).not.toMatch(/\btoken\s+text/)
  })

  it('post.sql never lets anon read people, money or logs', async () => {
    const sql = await readFile(path.join(root, 'server/db/post.sql'), 'utf8')
    const anon = sql.match(/grant select on ([^;]*?)\s+to anon;/s)[1]
    for (const t of ['profiles', 'bookings', 'bills', 'payments', 'customer_documents', 'activity_log', 'employee_permissions']) {
      expect(anon).not.toContain(t)
    }
  })
})

describe('runMigrations', () => {
  it('applies every step in its own transaction and records it', async () => {
    const c = fakeClient()
    await runMigrations({ client: c, root, log: quiet })
    const { steps } = await listSteps(root)
    expect(recorded(c)).toEqual(steps.map((s) => s.name))
    const sql = c.log.map((q) => q.sql)
    expect(sql.filter((s) => s === 'begin')).toHaveLength(steps.length + 1) // + post.sql
    expect(sql.filter((s) => s === 'commit')).toHaveLength(steps.length + 1)
  })

  it('skips steps that are already recorded, so a re-run is safe', async () => {
    const { steps } = await listSteps(root)
    const c = fakeClient({ applied: steps.slice(0, -1).map((s) => s.name) })
    await runMigrations({ client: c, root, log: quiet })
    expect(recorded(c)).toEqual([steps.at(-1).name])
  })

  it('does nothing but the grants when everything is applied', async () => {
    const { steps } = await listSteps(root)
    const c = fakeClient({ applied: steps.map((s) => s.name) })
    await runMigrations({ client: c, root, log: quiet })
    expect(recorded(c)).toEqual([])
    expect(c.log.some((q) => /grant select on public\.app_settings/.test(q.sql))).toBe(true) // post.sql still ran
  })

  it('seeds only when asked, and only once', async () => {
    const without = fakeClient()
    await runMigrations({ client: without, root, log: quiet })
    expect(recorded(without)).not.toContain('supabase/seed.sql')

    const withSeed = fakeClient()
    await runMigrations({ client: withSeed, root, seed: true, log: quiet })
    expect(recorded(withSeed).at(-1)).toBe('supabase/seed.sql')

    const again = fakeClient({ applied: recorded(withSeed) })
    await runMigrations({ client: again, root, seed: true, log: quiet })
    expect(recorded(again)).toEqual([])
  })

  it('rolls back and names the file when a step fails, and stops there', async () => {
    const c = fakeClient({ failOn: 'create table public.profiles' })
    await expect(runMigrations({ client: c, root, log: quiet })).rejects.toThrow(/20261104000001_schema\.sql: boom/)
    const sql = c.log.map((q) => q.sql)
    expect(sql).toContain('rollback')
    expect(recorded(c)).toEqual(['server/db/prelude.sql']) // nothing after the failure was recorded
  })

  it('holds the advisory lock while migrating and always releases it', async () => {
    const ok = fakeClient()
    await runMigrations({ client: ok, root, log: quiet })
    expect(ok.log[0].sql).toMatch(/pg_advisory_lock/)
    expect(ok.log.at(-1).sql).toMatch(/pg_advisory_unlock/)

    const bad = fakeClient({ failOn: 'create table public.profiles' })
    await runMigrations({ client: bad, root, log: quiet }).catch(() => {})
    expect(bad.log.at(-1).sql).toMatch(/pg_advisory_unlock/)
  })
})
