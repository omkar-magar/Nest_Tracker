import useCatalog from '../hooks/useCatalog'
import { availability, priceLabel } from '../services/catalog'
import { brand, highlights } from '../data/site'
import { Button, CardGridSkeleton, ErrorBox } from '../components/ui'

// PRD 9.4 shareable brochure built from live data. "Save as PDF" in the print dialog makes the file to share.
export default function Brochure() {
  const { data, error, loading, reload } = useCatalog()
  if (loading) return <div className="p-6"><CardGridSkeleton /></div>
  if (error) return <div className="p-6"><ErrorBox error={error} onRetry={reload} /></div>
  const rooms = data.rooms.map((r) => ({ r, a: availability(r) }))
  const url = `${window.location.origin}/vacancies`
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-navy print:p-0">
      <div className="mb-6 flex justify-end gap-2 print:hidden">
        <Button variant="outline" to="/admin/beds">Back</Button>
        <Button onClick={() => window.print()}>Print / save as PDF</Button>
      </div>
      <header className="flex items-center gap-4 border-b border-navy/10 pb-4">
        <img src="/images/logo.png" alt="" className="h-14 w-auto" />
        <div>
          <h1 className="text-3xl font-extrabold">{brand.name}</h1>
          <p className="text-slate-600">{brand.tagline}</p>
        </div>
      </header>
      <p className="mt-4 text-sm">{brand.address} · Call / WhatsApp {brand.phone}</p>
      <ul className="mt-4 grid grid-cols-2 gap-2 text-sm">{highlights.map((h) => <li key={h.title}><strong>{h.icon} {h.title}</strong> — {h.text}</li>)}</ul>
      <h2 className="mt-6 text-xl font-bold">Rooms and availability ({new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })})</h2>
      <table className="mt-2 w-full text-left text-sm">
        <thead><tr className="border-b border-navy/20"><th scope="col" className="py-1">Room</th><th scope="col">Type</th><th scope="col">Rent</th><th scope="col">Free beds</th></tr></thead>
        <tbody>
          {rooms.map(({ r, a }) => (
            <tr key={r.id} className="border-b border-navy/5">
              <td className="py-1">{r.no}</td><td>{r.type}{r.features.length ? ` · ${r.features.join(', ')}` : ''}</td><td>{priceLabel(r)}</td>
              <td>{a.free == null ? 'Ask us' : a.free > 0 ? a.free : 'Full'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-6 text-sm">Book a visit: <strong>{url}</strong></p>
    </div>
  )
}
