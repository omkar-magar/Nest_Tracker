import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import RoomCard from '../components/RoomCard'
import { Empty, ErrorBox, Notice, PageHeader, Spinner, inputCls } from '../components/ui'
import useCatalog from '../hooks/useCatalog'
import { availability, monthlyEquivalent } from '../services/catalog'

const sorters = {
  recommended: () => 0,
  'price-asc': (a, b) => monthlyEquivalent(a) - monthlyEquivalent(b),
  'price-desc': (a, b) => monthlyEquivalent(b) - monthlyEquivalent(a),
  beds: (a, b) => (availability(b).free ?? b.totalBeds) - (availability(a).free ?? a.totalBeds),
}

export default function Rooms() {
  const { data, error, loading, reload } = useCatalog()
  const [params, setParams] = useSearchParams()
  const f = {
    category: params.get('category') || '',
    type: params.get('type') || '',
    status: params.get('status') || '',
    sort: params.get('sort') || 'recommended',
  }
  const set = (key, value) => {
    const next = new URLSearchParams(params)
    value ? next.set(key, value) : next.delete(key)
    setParams(next, { replace: true })
  }

  const shown = useMemo(() => {
    if (!data) return []
    return data.rooms
      .filter((r) => !f.category || r.category === f.category)
      .filter((r) => !f.type || r.type === f.type)
      .filter((r) => !f.status || availability(r).status === f.status)
      .sort(sorters[f.sort] ?? sorters.recommended)
  }, [data, f.category, f.type, f.status, f.sort])

  const names = data ? Object.fromEntries(data.categories.map((c) => [c.id, c.name])) : {}

  return (
    <>
      <PageHeader title="Rooms" intro="Every room with its price, beds and live availability. Availability updates by itself, no refresh needed." />
      <div className="mx-auto w-full max-w-6xl px-4 py-8 text-navy">
        {loading && <Spinner label="Loading rooms" />}
        <ErrorBox error={error} onRetry={reload} />
        {data && (
          <>
            {!data.live && (
              <div className="mb-4"><Notice tone="warn">Live availability is not connected yet, so bed counts and booking are unavailable.</Notice></div>
            )}
            {data.rooms.some((r) => r.isDemoPrice) && (
              <div className="mb-4"><Notice>Prices shown are demo values and will change before launch.</Notice></div>
            )}

            <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter rooms" onSubmit={(e) => e.preventDefault()}>
              <label className="text-sm font-medium">Category
                <select className={`${inputCls} mt-1`} value={f.category} onChange={(e) => set('category', e.target.value)}>
                  <option value="">All</option>
                  {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">Room type
                <select className={`${inputCls} mt-1`} value={f.type} onChange={(e) => set('type', e.target.value)}>
                  <option value="">AC and Non-AC</option>
                  <option value="AC">AC</option>
                  <option value="Non-AC">Non-AC</option>
                </select>
              </label>
              <label className="text-sm font-medium">Availability
                <select className={`${inputCls} mt-1`} value={f.status} onChange={(e) => set('status', e.target.value)} disabled={!data.live}>
                  <option value="">Any</option>
                  <option value="available">Available</option>
                  <option value="partial">Partially occupied</option>
                  <option value="full">Fully booked</option>
                </select>
              </label>
              <label className="text-sm font-medium">Sort by
                <select className={`${inputCls} mt-1`} value={f.sort} onChange={(e) => set('sort', e.target.value)}>
                  <option value="recommended">Recommended</option>
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                  <option value="beds">Most free beds</option>
                </select>
              </label>
            </form>

            <p className="mt-4 text-sm text-slate-600" aria-live="polite">{shown.length} room{shown.length === 1 ? '' : 's'}</p>
            {shown.length ? (
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((r) => <RoomCard key={r.id} room={r} categoryName={names[r.category]} />)}
              </div>
            ) : (
              <div className="mt-3"><Empty title="No rooms match these filters">Try clearing a filter.</Empty></div>
            )}
          </>
        )}
      </div>
    </>
  )
}
