import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.fn(() => ({}))
vi.mock('@supabase/supabase-js', () => ({ createClient }))

async function load(search = '', standalone = false) {
  vi.resetModules()
  window.history.replaceState({}, '', '/' + search)
  window.matchMedia = () => ({ matches: standalone })
  vi.stubEnv('VITE_SUPABASE_URL', 'http://x.test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'k')
  await import('../src/lib/supabase')
  return createClient.mock.calls.at(-1)[2].auth.storage
}

describe('per-tab login', () => {
  beforeEach(() => { sessionStorage.clear(); createClient.mockClear() })
  afterEach(() => vi.unstubAllEnvs())

  it('keeps a separate login per browser tab by default', async () => {
    expect(await load()).toBe(sessionStorage)
  })

  it('an installed PWA shares the persistent login', async () => {
    expect(await load('', true)).toBeUndefined()
  })

  it('?tab-session=0 shares the login for that tab, =1 turns per-tab back on', async () => {
    expect(await load('?tab-session=0')).toBeUndefined()
    expect(await load()).toBeUndefined()
    expect(await load('?tab-session=1')).toBe(sessionStorage)
  })
})
