import Hero from '../components/Hero'
import RoomCard from '../components/RoomCard'
import Reviews from '../components/Reviews'
import Faq from '../components/Faq'
import { Button, CardGridSkeleton, ErrorBox, Section } from '../components/ui'
import useCatalog from '../hooks/useCatalog'
import { previewRooms } from '../services/catalog'
import VisitForm from '../components/VisitForm'
import { brand, highlights } from '../data/site'
import { whatsappUrl } from '../services/contact'

function RoomPreview() {
  const { data, error, loading, reload } = useCatalog()
  if (loading) return <CardGridSkeleton label="Loading rooms" />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const names = Object.fromEntries(data.categories.map((c) => [c.id, c.name]))
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {previewRooms(data.rooms).map((r) => <RoomCard key={r.id} room={r} categoryName={names[r.category]} />)}
      </div>
      <div className="mt-6 text-center">
        <Button variant="primary" to="/rooms">Explore All Rooms</Button>
      </div>
    </>
  )
}

export default function Home() {
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <>
      <Hero scrollTo={scrollTo} />

      <Section id="why" title="Why choose YOLO Nest">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {highlights.map((h) => (
            <li key={h.title} className="rounded-2xl border border-navy/10 bg-white p-5">
              <span aria-hidden="true" className="text-2xl">{h.icon}</span>
              <h3 className="mt-2 font-semibold">{h.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{h.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="rooms-preview" title="Rooms at a glance">
        <RoomPreview />
      </Section>

      <Section id="reviews" title="What residents say">
        <Reviews />
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq />
      </Section>

      <Section id="contact" title="Schedule a visit">
        <div className="grid gap-8 lg:grid-cols-5">
          <div className="lg:col-span-3"><VisitForm /></div>
          <div className="lg:col-span-2">
            <h3 className="font-semibold">Prefer to talk first?</h3>
            <p className="mb-4 mt-1 text-slate-600">{brand.address}</p>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <Button variant="primary" className="px-6 py-3" href={`tel:+91${brand.phone}`}>Call {brand.phone}</Button>
              <Button variant="outline" className="px-6 py-3" href={whatsappUrl()} target="_blank" rel="noreferrer">WhatsApp us</Button>
            </div>
          </div>
        </div>
      </Section>
    </>
  )
}
