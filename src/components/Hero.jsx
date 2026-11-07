import { useEffect, useRef, useState } from 'react'
import Img from './Img'
import NearbyMap from './NearbyMap'
import useMediaQuery from '../hooks/useMediaQuery'
import useFocusTour from '../hooks/useFocusTour'
import { brand } from '../data/site'

// Replace the image paths and text with your real amenities.
const amenities = [
  { title: 'Gym', info: 'Fully equipped gym open all day for residents.', src: '/images/hero/gym.webp' },
  { title: 'Gaming Zone', info: 'Console and board games to unwind after work.', src: '/images/hero/gaming.webp' },
  { title: 'Pickleball Court', info: 'Play with housemates on our own court.', src: '/images/hero/pickleball.webp' },
  { title: 'Café Area', info: 'A cosy space to work, chat or grab a coffee.', src: '/images/hero/cafe.webp' },
]

export default function Hero({ scrollTo }) {
  const [active, setActive] = useState(null) // picked by the visitor (hover, focus, tap); null = none
  const wide = useMediaQuery('(min-width: 1024px)') // lg: only the background for this size is downloaded

  const show = (idx) => setActive(idx)
  const reset = () => setActive(null)

  // Touch: a photo was already open when the tap started, so this tap closes it
  const wasOpen = useRef(false)
  const panel = useRef(null)

  // The timed tour pauses while the visitor has picked a photo
  const tour = useFocusTour(amenities.length, panel, active !== null)
  const focused = active ?? tour // null = all slices equal

  // Touch anywhere outside the panel also closes the open photo
  useEffect(() => {
    if (active === null) return
    const close = (e) => {
      if (e.pointerType === 'touch' && !panel.current?.contains(e.target)) reset()
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  })

  return (
    <section id="home" className="relative flex flex-1 flex-col justify-center overflow-hidden bg-cream text-navy">
      {/* Mobile background: public/images/background/mbg.jpg. Decorative, so it never competes with the text. */}
      {!wide && <img
        aria-hidden="true"
        src="/images/background/mbg.jpg"
        alt=""
        loading="eager"
        fetchPriority="low"
        decoding="async"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center opacity-40"
        style={{
          maskImage: "linear-gradient(180deg, transparent 0%, #000 35%)",
          WebkitMaskImage: "linear-gradient(180deg, transparent 0%, #000 35%)",
        }}
      />}

      {/* Background: faded aerial photo on the right, behind the 3D map */}
      {wide && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-1/2">
        <img
          src="/images/hero/bg.webp"
          alt=""
          loading="eager"
          fetchPriority="low"
          decoding="async"
          className="h-full w-full object-cover object-center opacity-40"
          style={{
            maskImage: 'linear-gradient(90deg, transparent 0%, #000 45%), linear-gradient(180deg, transparent 0%, #000 35%)',
            maskComposite: 'intersect',
            WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 45%), linear-gradient(180deg, transparent 0%, #000 35%)',
            WebkitMaskComposite: 'source-in',
          }}
        />
      </div>}

      {/* Content: relative so it stays above the background */}
      <div className="relative mx-auto grid w-full max-w-6xl gap-x-8 gap-y-6 px-4 py-8 md:py-10 lg:grid-cols-5">
        {/* Mobile order: heading, nearby map, amenities. From lg: heading + amenities left, map right. */}
        <div className="min-w-0 lg:col-span-3">
          <h1 className="text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-[3.25rem]">
            Premium co-living,
            <span className="relative mt-1 block w-fit">
              <span
                aria-hidden="true"
                className="absolute inset-x-[-0.15em] bottom-[0.02em] h-[0.42em] -skew-x-3 rounded-sm bg-sun/45"
              />
              <span className="relative">built around your lifestyle</span>
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-[17px]">
            A fully furnished PG with a gym, gaming zone, pickleball court and café,
            close to Hinjewadi's IT parks and the metro.
          </p>
          <p className="mt-2 font-semibold text-gold-deep">{brand.tagline}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => scrollTo('rooms-preview')}
              className="w-full rounded-full bg-sun px-6 py-3 font-semibold text-navy shadow-sm transition hover:brightness-95 sm:w-auto"
            >
              See available stays
            </button>
            <button
              onClick={() => scrollTo('contact')}
              className="w-full rounded-full border border-navy/30 bg-white/70 px-6 py-3 font-semibold text-navy transition hover:bg-white sm:w-auto"
            >
              Schedule a visit
            </button>
          </div>
        </div>

        {/* Nearby map: sits between heading and amenities on mobile */}
        <div className="relative flex min-w-0 items-start lg:col-span-2 lg:col-start-4 lg:row-span-2 lg:row-start-1 lg:-mr-8 lg:pt-2">
          {/* Soft white blurred circle so the map stands out from the photo */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[110%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cream/90 blur-3xl lg:hidden"
          />
          <div className="relative w-full">
            <NearbyMap />
          </div>
        </div>

        {/* Static slices, one per photo, with a full-size copy of each crossfading on top when focused.
            Column on mobile (right edge fades), row from md up (top edge fades). */}
        <div
          ref={panel}
          className="relative h-[28rem] min-w-0 overflow-hidden md:h-80 lg:col-span-3 lg:h-[24rem]"
          onMouseLeave={reset}
        >
          {amenities.map((a, idx) => (
            <div
              key={a.title}
              aria-hidden="true"
              style={{ '--i': idx, '--n': amenities.length }}
              className="hero-slice fade-mask absolute inset-0"
            >
              <Img src={a.src} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-navy/60 via-navy/5 to-transparent" />
            </div>
          ))}

          {amenities.map((a, idx) => (
            <div
              key={a.title}
              aria-hidden="true"
              className={`hero-focus absolute inset-0 ${idx === focused ? 'is-active' : ''}`}
            >
              <Img src={a.src} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-navy/60 via-navy/5 to-transparent" />
            </div>
          ))}

          {/* Hover targets and labels, one cell per slice */}
          <div className="absolute inset-0 z-20 flex flex-col md:flex-row">
            {amenities.map((a, idx) => (
              <div
                key={a.title}
                tabIndex={0}
                role="button"
                aria-label={a.title}
                onPointerEnter={(e) => e.pointerType === 'mouse' && show(idx)}
                onPointerDown={(e) => { wasOpen.current = e.pointerType === 'touch' && active !== null }}
                onClick={() => (wasOpen.current ? reset() : show(idx))}
                onFocus={() => show(idx)}
                onBlur={reset}
                className="relative min-h-0 min-w-0 flex-1 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sun"
              >
                {/* Collapsed title: plain horizontal text; a soft shadow keeps it readable over the photo */}
                <div
                  className={`absolute left-4 top-1/2 max-w-[calc(100%-2rem)] -translate-y-1/2 text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.7),0_0_12px_rgb(0_0_0/0.5)] transition-opacity duration-700 ease-in-out md:bottom-4 md:left-1/2 md:top-auto md:w-max md:max-w-[calc(100%-1rem)] md:-translate-x-1/2 md:translate-y-0 ${focused === null ? 'opacity-100' : 'opacity-0'
                    }`}
                >
                  <span className="text-lg font-semibold leading-tight md:block md:text-center md:text-sm">
                    {a.title}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Focused photo's title + info: full panel width, on a dark gradient so it reads over any photo */}
          {amenities.map((a, idx) => (
            <div
              key={a.title}
              className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-navy/90 via-navy/70 to-transparent p-4 pt-12 transition-[opacity,translate] duration-700 ease-in-out motion-reduce:transition-none md:p-5 md:pt-14 ${idx === focused ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
                }`}
            >
              <h3 className="text-lg font-bold text-gold md:text-xl">{a.title}</h3>
              <p className="mt-1 text-sm text-white">{a.info}</p>
            </div>
          ))}
        </div>

      </div>
    </section>
  )
}