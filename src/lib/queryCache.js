// Small shared cache for PUBLIC data only (catalogue, amenities, published reviews).
// Never put user-specific or admin data here: it is module-level, so it would outlive a sign-out.
//
// - one request per key at a time, however many components ask
// - a cached value can be shown at once while a fresh one loads
// - invalidate(key) marks it stale and makes every mounted reader refetch
const entries = new Map() // key -> { data, error, at, promise }
const listeners = new Map() // key -> Set<fn>

const entry = (key) => {
  if (!entries.has(key)) entries.set(key, { data: undefined, error: null, at: 0, promise: null })
  return entries.get(key)
}

export const peek = (key) => entries.get(key)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Tests set delay to 0 so a failing request does not slow them down.
export const retryConfig = { delay: 800 }

// Fetches key (or joins the request already running). One retry after a short pause for flaky mobile networks.
export function fetchQuery(key, loader, { retries = 1 } = {}) {
  const e = entry(key)
  if (e.promise) return e.promise
  const attempt = async (left) => {
    try {
      return await loader()
    } catch (err) {
      if (left <= 0) throw err
      await wait(retryConfig.delay)
      return attempt(left - 1)
    }
  }
  const p = attempt(retries)
    .then((data) => { Object.assign(e, { data, error: null, at: Date.now() }); return data })
    .catch((error) => { e.error = error; throw error })
    .finally(() => { e.promise = null })
  e.promise = p
  p.catch(() => {}) // callers handle the error; this only stops an "unhandled rejection" warning
  return p
}

export const isFresh = (key, staleTime) => {
  const e = entries.get(key)
  return Boolean(e) && e.data !== undefined && Date.now() - e.at < staleTime
}

export function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key).add(fn)
  return () => listeners.get(key).delete(fn)
}

// After a change (booking, bed status, price...): forget how old the data is and tell readers to refetch.
export function invalidate(key) {
  const e = entries.get(key)
  if (e) e.at = 0
  listeners.get(key)?.forEach((fn) => fn())
}

export function clearQueryCache() {
  entries.clear()
  listeners.clear()
}
