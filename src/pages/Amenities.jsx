import Img from '../components/Img'
import { Button, ErrorBox, PageHeader, Spinner } from '../components/ui'
import useAsync from '../hooks/useAsync'
import { loadCatalog } from '../services/catalog'

export default function Amenities() {
  const { data, error, loading, reload } = useAsync(loadCatalog, [])
  return (
    <>
      <PageHeader title="Amenities" intro="Everything residents can use at YOLO Nest. Photos are of the actual facilities in our building." />
      <div className="mx-auto w-full max-w-6xl px-4 py-10 text-navy">
        {loading && <Spinner label="Loading amenities" />}
        <ErrorBox error={error} onRetry={reload} />
        {data && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.amenities.map((a) => (
              <article key={a.id} className="overflow-hidden rounded-2xl border border-navy/10 bg-white">
                {a.image ? (
                  <div className="relative">
                    <Img src={a.image} alt={`${a.title} at YOLO Nest`} className="h-52 w-full object-cover" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-navy/70 to-transparent" />
                    <span className="absolute bottom-2 left-3 rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-semibold text-navy">
                      Actual photo · YOLO Nest
                    </span>
                  </div>
                ) : (
                  <div className="flex h-52 items-center justify-center bg-cream text-6xl" aria-hidden="true">{a.icon}</div>
                )}
                <div className="p-5">
                  <h2 className="flex items-center gap-2 font-semibold"><span aria-hidden="true">{a.icon}</span>{a.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">{a.text}</p>
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="mt-10 text-center"><Button variant="sun" to="/rooms">See available rooms</Button></div>
      </div>
    </>
  )
}
