import { useEffect } from 'react'
import useQuery from './useQuery'
import { invalidate } from '../lib/queryCache'
import { loadCatalog, subscribeAvailability } from '../services/catalog'

export const CATALOG_KEY = 'catalog'

// Catalogue plus live availability. A second visit paints from the cache at once, but availability is
// always re-checked (staleTime 0), and any bed or room change refetches quietly (debounced).
export default function useCatalog() {
  const state = useQuery(CATALOG_KEY, loadCatalog, { staleTime: 0 })

  useEffect(() => {
    let timer
    const off = subscribeAvailability(() => {
      clearTimeout(timer)
      timer = setTimeout(() => invalidate(CATALOG_KEY), 250)
    })
    return () => { clearTimeout(timer); off() }
  }, [])

  return state
}
