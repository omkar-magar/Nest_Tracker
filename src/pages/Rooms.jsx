import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import RoomCard from '../components/RoomCard'
import { CardGridSkeleton, Empty, ErrorBox, Notice, PageHeader, inputCls } from '../components/ui'
import useCatalog from '../hooks/useCatalog'
import { availability, monthlyEquivalent, wingName, wingsOf } from '../services/catalog'

const pill = 'rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy'

// The PG has two buildings; picking one narrows every other filter to that wing
function WingPicker({ wings, value, onChange }) {
  const options = [['', 'Both wings'], ...wings.map((w) => [w, wingName(w)])]
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-sm font-medium">Wing</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([id, name]) => (
          <button key={id || 'all'} type="button" aria-pressed={value === id} onClick={() => onChange(id)}
            className={`${pill} ${value === id ? 'border-navy bg-navy text-white' : 'border-navy/20 bg-white text-navy hover:border-navy/40'}`}>
            {name}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

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
    wing: params.get('wing') || '',
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
      .filter((r) => !f.wing || r.wing === f.wing)
      .filter((r) => !f.category || r.category === f.category)
      .filter((r) => !f.type || r.type === f.type)
      .filter((r) => !f.status || availability(r).status === f.status)
      .sort(sorters[f.sort] ?? sorters.recommended)
  }, [data, f.wing, f.category, f.type, f.status, f.sort])
  const wings = useMemo(() => (data ? wingsOf(data.rooms) : []), [data])

  const names = data ? Object.fromEntries(data.categories.map((c) => [c.id, c.name])) : {}

  return (
    <>
      <PageHeader title="Rooms" intro="Every room with its price, beds and live availability. Availability updates by itself, no refresh needed." />
      <div className="mx-auto w-full max-w-6xl px-4 py-8 text-navy">
        {loading && <CardGridSkeleton label="Loading rooms" />}
        <ErrorBox error={error} onRetry={reload} />
        {data && (
          <>
            {!data.live && (
              <div className="mb-4"><Notice tone="warn">Live availability is not connected yet, so bed counts and booking are unavailable.</Notice></div>
            )}
            {data.rooms.some((r) => r.isDemoPrice) && (
              <div className="mb-4"><Notice>Prices shown are demo values and will change before launch.</Notice></div>
            )}

            {wings.length > 1 && <WingPicker wings={wings} value={f.wing} onChange={(w) => set('wing', w)} />}

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

            <p className="mt-4 text-sm text-slate-600" aria-live="polite">{shown.length} room{shown.length === 1 ? '' : 's'}{f.wing ? ` in ${wingName(f.wing)}` : ''}</p>
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
