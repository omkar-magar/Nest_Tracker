import { Link } from 'react-router-dom'
import Hero from '../components/Hero'
import Img from '../components/Img'
import RoomCard from '../components/RoomCard'
import Reviews from '../components/Reviews'
import Faq from '../components/Faq'
import { Button, ErrorBox, Section, Spinner } from '../components/ui'
import useCatalog from '../hooks/useCatalog'
import { previewRooms } from '../services/catalog'
import { brand, categories, rooms as staticRooms } from '../data/site'

function RoomPreview() {
  const { data, error, loading, reload } = useCatalog()
  if (loading) return <Spinner label="Loading rooms" />
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

      <Section id="stays" title="Stays">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => {
            const list = staticRooms.filter((r) => r.category === c.id)
            const count = list.length
            // No category photos yet: use the first room's photo (public/images/rooms/<id>.webp)
            const photo = list[0] ? `/images/rooms/${list[0].id}.webp` : `/images/categories/${c.id}.jpg`
            return (
              <Link
                key={c.id}
                to={`/rooms?category=${c.id}`}
                className="block overflow-hidden rounded-2xl border border-navy/10 bg-white transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-navy"
              >
                <Img src={photo} alt={c.name} className="h-40 w-full object-cover" />
                <div className="p-4">
                  <h3 className="font-semibold">{c.name}</h3>
                  <p className="text-sm font-medium text-gold-deep">{c.tag}</p>
                  <p className="mt-1 text-xs text-slate-500">{count} room{count === 1 ? '' : 's'} listed</p>
                </div>
              </Link>
            )
          })}
        </div>
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

      <Section id="contact" title="Contact">
        <p className="mb-4 text-slate-600">{brand.address}</p>
        <Button variant="primary" className="px-6 py-3" href={`tel:+91${brand.phone}`}>Call {brand.phone}</Button>
      </Section>
    </>
  )
}
