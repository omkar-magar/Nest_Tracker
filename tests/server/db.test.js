// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { withOwner, withUser } from '../../server/db.js'

const UID = '3f2c8a52-7e0b-4c7e-9d51-0a1b2c3d4e5f'

// Records the queries of one pooled connection.
function fakePool({ failOn } = {}) {
  const log = []
  const release = vi.fn()
  const client = {
    release,
    async query(sql, params) {
      log.push(params ? [sql, params] : [sql])
      if (failOn && sql.includes(failOn)) throw new Error('boom')
      return { rows: [] }
    },
  }
  return { log, release, connect: vi.fn(async () => client) }
}

describe('withUser', () => {
  it('runs as authenticated with auth.uid() set, inside one transaction', async () => {
    const pool = fakePool()
    const out = await withUser(pool, { userId: UID }, async (c) => { await c.query('select 1'); return 'done' })
    expect(out).toBe('done')
    expect(pool.log).toEqual([
      ['begin'],
      ["select set_config('app.user_id', $1, true)", [UID]], // true = transaction-local, cannot leak to the next request
      ['set local role authenticated'],
      ['select 1'],
      ['commit'],
    ])
    expect(pool.release).toHaveBeenCalledTimes(1)
  })

  it('anonymous requests run as anon with an empty user id', async () => {
    const pool = fakePool()
    await withUser(pool, {}, async () => {})
    expect(pool.log[1]).toEqual(["select set_config('app.user_id', $1, true)", ['']])
    expect(pool.log[2]).toEqual(['set local role anon'])
  })

  it('service_role is available for trusted work such as payment results', async () => {
    const pool = fakePool()
    await withUser(pool, { role: 'service_role' }, async () => {})
    expect(pool.log[2]).toEqual(['set local role service_role'])
  })

  it('rolls back, releases the connection and rethrows when the work fails', async () => {
    const pool = fakePool()
    await expect(withUser(pool, { userId: UID }, async () => { throw new Error('rule broken') })).rejects.toThrow('rule broken')
    expect(pool.log.at(-1)).toEqual(['rollback'])
    expect(pool.log).not.toContainEqual(['commit'])
    expect(pool.release).toHaveBeenCalledTimes(1)
  })

  it('rolls back if setting up the role fails', async () => {
    const pool = fakePool({ failOn: 'set local role' })
    await expect(withUser(pool, { userId: UID }, async () => 'never')).rejects.toThrow('boom')
    expect(pool.log.at(-1)).toEqual(['rollback'])
    expect(pool.release).toHaveBeenCalledTimes(1)
  })

  it('never lets a role name reach the SQL unchecked', async () => {
    const pool = fakePool()
    await expect(withUser(pool, { role: 'postgres' }, async () => {})).rejects.toThrow(/Unknown database role/)
    await expect(withUser(pool, { role: 'anon; drop table x' }, async () => {})).rejects.toThrow(/Unknown database role/)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rejects a user id that is not a UUID', async () => {
    const pool = fakePool()
    await expect(withUser(pool, { userId: "x'; select 1" }, async () => {})).rejects.toThrow(/Bad user id/)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('refuses authenticated without a user, which would run with no identity', async () => {
    const pool = fakePool()
    await expect(withUser(pool, { role: 'authenticated' }, async () => {})).rejects.toThrow(/needs a user id/)
  })
})

describe('withOwner', () => {
  it('commits and releases', async () => {
    const pool = fakePool()
    expect(await withOwner(pool, async () => 7)).toBe(7)
    expect(pool.log).toEqual([['begin'], ['commit']])
    expect(pool.release).toHaveBeenCalledTimes(1)
  })
  it('does not switch role or set a user', async () => {
    const pool = fakePool()
    await withOwner(pool, async () => {})
    expect(pool.log.flat().join(' ')).not.toMatch(/set local role|set_config/)
  })
  it('rolls back on failure', async () => {
    const pool = fakePool()
    await expect(withOwner(pool, async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(pool.log.at(-1)).toEqual(['rollback'])
    expect(pool.release).toHaveBeenCalledTimes(1)
  })
})
