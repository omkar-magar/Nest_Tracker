import { useState } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Img from './components/Img'
import { amenities, brand, categories, rooms } from './data/site'

function Section({ id, title, children }) {
  return (
    <section id={id} className="scroll-mt-16 py-14 text-navy">
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-2xl font-bold md:text-3xl">{title}</h2>
        <div className="mt-6">{children}</div>
      </div>
    </section>
  )
}

function Home({ scrollTo }) {
  return (
    <>
      <Hero scrollTo={scrollTo} />

      <Section id="amenities" title="Amenities">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {amenities.map((a) => (
            <div key={a.title} className="rounded-2xl border border-navy/10 bg-white p-5">
              <p className="text-2xl" aria-hidden="true">{a.icon}</p>
              <h3 className="mt-2 font-semibold">{a.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{a.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="stays" title="Stays">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => {
            const list = rooms.filter((r) => r.category === c.id)
            const count = list.length
            // No category photos yet: use the first room's photo (public/images/rooms/<id>.webp)
            const photo = list[0] ? `/images/rooms/${list[0].id}.webp` : `/images/categories/${c.id}.jpg`
            return (
              <div key={c.id} className="overflow-hidden rounded-2xl border border-navy/10 bg-white">
                <Img src={photo} alt={c.name} className="h-40 w-full object-cover" />
                <div className="p-4">
                  <h3 className="font-semibold">{c.name}</h3>
                  <p className="text-sm font-medium text-gold-deep">{c.tag}</p>
                  <p className="mt-1 text-xs text-slate-500">{count} room{count === 1 ? '' : 's'} listed</p>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      <Section id="location" title="Location">
        <p className="text-slate-600">{brand.address}</p>
        <iframe
          title="YOLO Nest on Google Maps"
          className="mt-4 h-80 w-full rounded-2xl border border-navy/10"
          loading="lazy"
          src={`https://maps.google.com/maps?q=${encodeURIComponent(brand.mapQuery)}&output=embed`}
        />
      </Section>

      <Section id="contact" title="Contact">
        <a href={`tel:+91${brand.phone}`} className="inline-block rounded-full bg-navy px-6 py-3 font-semibold text-white">
          Call {brand.phone}
        </a>
      </Section>
    </>
  )
}

function Placeholder({ title, go }) {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center text-navy">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-slate-600">Coming soon.</p>
      <button onClick={() => go('home')} className="mt-6 rounded-full bg-sun px-6 py-2 font-semibold">Back home</button>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState('home')
  const [user, setUser] = useState(null)

  const go = (p) => {
    setPage(p)
    window.scrollTo({ top: 0 })
  }

  const scrollTo = (id) => {
    if (page !== 'home') setPage('home')
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }))
  }

  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <Navbar user={user} go={go} scrollTo={scrollTo} logout={() => { setUser(null); go('home') }} />
      <main className="flex flex-1 flex-col">
        {page === 'home' && <Home scrollTo={scrollTo} />}
        {page === 'login' && <Placeholder title="Log in" go={go} />}
        {page === 'dashboard' && <Placeholder title="Dashboard" go={go} />}
      </main>
    </div>
  )
}
