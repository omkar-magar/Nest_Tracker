import { Link } from 'react-router-dom'
import { brand } from '../data/site'

const col = 'text-sm text-white/75 hover:text-white'

export default function Footer() {
  return (
    <footer className="bg-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xl font-extrabold">YOLO <span className="font-semibold tracking-[0.2em] text-gold">nest</span></p>
          <p className="mt-2 text-sm text-white/75">{brand.tagline}</p>
          <p className="mt-3 text-sm text-white/75">Co-living in Hinjewadi Phase 1, Pune: monthly and daily PG beds, 1BHK flat, lodge rooms and an Airbnb-style stay.</p>
        </div>

        <nav aria-label="Explore">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gold">Explore</h2>
          <ul className="mt-3 space-y-2">
            <li><Link className={col} to="/rooms">Rooms</Link></li>
            <li><Link className={col} to="/amenities">Amenities</Link></li>
            <li><Link className={col} to="/location">Location</Link></li>
            <li><Link className={col} to="/#faq">FAQ</Link></li>
          </ul>
        </nav>

        <nav aria-label="Account and policies">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gold">Resident</h2>
          <ul className="mt-3 space-y-2">
            <li><Link className={col} to="/login">Log in</Link></li>
            <li><Link className={col} to="/signup">Create an account</Link></li>
            <li><Link className={col} to="/privacy">Privacy policy</Link></li>
            <li><Link className={col} to="/terms">Terms and conditions</Link></li>
          </ul>
        </nav>

        <div id="contact-footer">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gold">Contact</h2>
          <ul className="mt-3 space-y-2 text-sm text-white/75">
            <li><a className={col} href={`tel:+91${brand.phone}`}>{brand.phone}</a></li>
            <li><a className={col} href={`https://wa.me/91${brand.phone}`} target="_blank" rel="noreferrer">WhatsApp us</a></li>
            <li>{brand.address}</li>
          </ul>
          {brand.social.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-3" aria-label="Social media">
              {brand.social.map((s) => (
                <li key={s.href}><a className={col} href={s.href} target="_blank" rel="noreferrer">{s.label}</a></li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-white/60">
          © {new Date().getFullYear()} {brand.name} Co-Living. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
