import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.fn(() => ({}))
vi.mock('@supabase/supabase-js', () => ({ createClient }))

async function load(search = '') {
  vi.resetModules()
  window.history.replaceState({}, '', '/' + search)
  vi.stubEnv('VITE_SUPABASE_URL', 'http://x.test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'k')
  await import('../src/lib/supabase')
  return createClient.mock.calls.at(-1)[2].auth.storage
}

describe('per-tab session mode', () => {
  beforeEach(() => { sessionStorage.clear(); createClient.mockClear() })
  afterEach(() => vi.unstubAllEnvs())

  it('shares the login across tabs by default', async () => {
    expect(await load()).toBeUndefined()
  })

  it('keeps its own login when opened with ?tab-session=1, and remembers it for the tab', async () => {
    expect(await load('?tab-session=1')).toBe(sessionStorage)
    expect(await load()).toBe(sessionStorage)
  })

  it('?tab-session=0 turns it off', async () => {
    await load('?tab-session=1')
    expect(await load('?tab-session=0')).toBeUndefined()
  })
})
