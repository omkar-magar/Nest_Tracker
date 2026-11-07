import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchQuery, invalidate as invalidateKey, isFresh, peek, subscribe } from '../lib/queryCache'

// Like useAsync, but backed by the shared cache in lib/queryCache.js (public data only).
// - cached data shows at once (no spinner on a second visit)
// - it is refetched quietly when older than staleTime (ms). staleTime 0 = always check again.
// - invalidate('key') anywhere refetches every mounted reader
export default function useQuery(key, loader, { staleTime = 0 } = {}) {
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const [state, setState] = useState(() => {
    const e = peek(key)
    return { data: e?.data ?? null, error: null, loading: e?.data === undefined }
  })

  const run = useCallback((quiet) => {
    if (!quiet) setState((s) => ({ ...s, loading: s.data === null, error: null }))
    let alive = true
    fetchQuery(key, () => loaderRef.current())
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState((s) => ({ data: s.data, error, loading: false })))
    return () => { alive = false }
  }, [key])

  useEffect(() => {
    const e = peek(key)
    let cancel = () => {}
    if (e?.data !== undefined && isFresh(key, staleTime)) setState({ data: e.data, error: null, loading: false })
    else cancel = run(e?.data !== undefined) // cached but stale: refresh without a spinner
    const off = subscribe(key, () => { cancel(); cancel = run(true) })
    return () => { cancel(); off() }
  }, [key, staleTime, run])

  return { ...state, reload: () => { invalidateKey(key) } }
}
