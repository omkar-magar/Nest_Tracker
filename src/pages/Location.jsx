import Img from '../components/Img'
import { Button, Card, PageHeader } from '../components/ui'
import { brand, nearby } from '../data/site'
import { mapsUrl } from '../services/contact'

const mapSrc = `https://maps.google.com/maps?q=${encodeURIComponent(brand.mapQuery)}&output=embed`

export default function Location() {
  const metro = nearby.find((n) => n.icon === 'metro')
  const work = nearby.find((n) => n.icon === 'work')
  const sorted = [...nearby].sort((a, b) => parseFloat(a.km) - parseFloat(b.km))

  return (
    <>
      <PageHeader title="Location" intro="In Hinjewadi Phase 1, Pune, close to the IT parks, the metro and daily needs." />
      <div className="mx-auto w-full max-w-6xl px-4 py-10 text-navy">
        <div className="grid gap-6 lg:grid-cols-5">
          <iframe
            title="YOLO Nest on Google Maps"
            className="h-80 w-full rounded-2xl border border-navy/10 lg:col-span-3 lg:h-full lg:min-h-96"
            loading="lazy"
            src={mapSrc}
          />
          <Card className="lg:col-span-2">
            <h2 className="font-semibold">Address</h2>
            <p className="mt-1 text-slate-600">{brand.address}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" href={mapsUrl} target="_blank" rel="noreferrer">Get directions</Button>
              <Button variant="outline" href={`tel:+91${brand.phone}`}>Call {brand.phone}</Button>
            </div>
            <h2 className="mt-6 font-semibold">Getting around</h2>
            <ul className="mt-2 space-y-2 text-sm text-slate-600">
              {metro && <li>Metro: {metro.name}, about {metro.km} km away.</li>}
              {work && <li>Work: {work.name}, about {work.km} km away.</li>}
              <li>Daily needs (D-Mart and Xion Mall) are within about 2.5 km.</li>
            </ul>
            <p className="mt-3 text-xs text-slate-500">Distances are approximate.</p>
          </Card>
        </div>

        <h2 className="mt-12 text-2xl font-bold">Nearby places</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((n) => (
            <li key={n.name} className="overflow-hidden rounded-2xl border border-navy/10 bg-white">
              {n.image && <Img src={n.image} alt={n.name} className="h-32 w-full object-cover" />}
              <div className="p-4">
                <h3 className="font-semibold">{n.name}</h3>
                <p className="text-sm font-medium text-gold-deep">≈ {n.km} km</p>
                <p className="mt-1 text-sm text-slate-600">{n.note}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
