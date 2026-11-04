import { useEffect, useRef } from 'react'
import useAsync from './useAsync'
import { loadCatalog, subscribeAvailability } from '../services/catalog'

// Catalogue plus live availability: any change to beds or rooms re-fetches quietly (debounced).
export default function useCatalog() {
  const state = useAsync(loadCatalog, [])
  const reload = useRef(state.reload)
  reload.current = state.reload

  useEffect(() => {
    let timer
    const off = subscribeAvailability(() => {
      clearTimeout(timer)
      timer = setTimeout(() => reload.current(), 250)
    })
    return () => { clearTimeout(timer); off() }
  }, [])

  return state
}
