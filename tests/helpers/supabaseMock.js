// In-memory stand-in for src/lib/supabase.js. Tests load it with
//   vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
// and then set what each table / rpc / function returns.
import { vi } from 'vitest'

export let isConfigured = true
export const setConfigured = (v) => { isConfigured = v }
export const errorMessage = (error) => (error ? error.message || String(error) : '')

export const db = {
  tables: {}, // table -> { data, error }
  rpcs: {}, // rpc name -> { data, error }
  queries: [], // every from() call: { table, ops: [[method, args]] }
  fnResult: { data: null, error: null },
}

const ok = (data = null) => ({ data, error: null })

function builder(table) {
  const q = { table, ops: [] }
  db.queries.push(q)
  const chain = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        const res = db.tables[table] ?? ok([])
        return (resolve, reject) => Promise.resolve(res).then(resolve, reject)
      }
      return (...args) => { q.ops.push([prop, args]); return chain }
    },
  })
  return chain
}

export const queryFor = (table) => db.queries.filter((q) => q.table === table)
export const opArgs = (q, method) => q.ops.find(([m]) => m === method)?.[1]

const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) }

export const supabase = {
  from: vi.fn((table) => builder(table)),
  rpc: vi.fn(async (name) => db.rpcs[name] ?? ok()),
  auth: {
    getSession: vi.fn(async () => ({ data: { session: null } })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  },
  storage: {
    from: vi.fn(() => storageBucket),
  },
  functions: { invoke: vi.fn(async () => db.fnResult) },
  channel: vi.fn(() => channel),
  removeChannel: vi.fn(),
}

export const storageBucket = {
  upload: vi.fn(async () => ok({})),
  remove: vi.fn(async () => ok([])),
  createSignedUrl: vi.fn(async () => ok({ signedUrl: 'https://signed.example/file' })),
}

export function resetMock() {
  db.tables = {}
  db.rpcs = {}
  db.queries = []
  db.fnResult = ok()
  isConfigured = true
  vi.clearAllMocks()
  // clearAllMocks keeps implementations that were replaced with mockImplementation, so restore the defaults
  supabase.rpc.mockImplementation(async (name) => db.rpcs[name] ?? ok())
  supabase.from.mockImplementation((table) => builder(table))
  supabase.functions.invoke.mockImplementation(async () => db.fnResult)
  supabase.auth.getSession.mockImplementation(async () => ({ data: { session: null } }))
  supabase.auth.onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
  supabase.auth.signInWithPassword.mockImplementation(async () => ({ data: {}, error: null }))
  supabase.auth.signUp.mockImplementation(async () => ({ data: { session: null }, error: null }))
  supabase.auth.signOut.mockImplementation(async () => ({ error: null }))
  supabase.storage.from.mockImplementation(() => storageBucket)
  storageBucket.upload.mockImplementation(async () => ok({}))
  storageBucket.remove.mockImplementation(async () => ok([]))
  storageBucket.createSignedUrl.mockImplementation(async () => ok({ signedUrl: 'https://signed.example/file' }))
  channel.on.mockImplementation(() => channel)
  channel.subscribe.mockImplementation(() => channel)
}
