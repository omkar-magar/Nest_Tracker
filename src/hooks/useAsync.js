import { useCallback, useEffect, useRef, useState } from 'react'

// Runs an async loader and tracks loading / error. reload() re-runs it without flashing the spinner.
export default function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const seq = useRef(0)

  const run = useCallback((quiet) => {
    const id = ++seq.current
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }))
    return loader()
      .then((data) => id === seq.current && setState({ data, error: null, loading: false }))
      .catch((error) => id === seq.current && setState((s) => ({ data: quiet ? s.data : null, error, loading: false })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    run(false)
    return () => { seq.current++ }
  }, [run])

  return { ...state, reload: () => run(true) }
}
