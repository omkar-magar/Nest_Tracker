import Img from './Img'
import { photoUrl } from '../lib/photo'
import { gallery } from '../data/site'

// Grid of real photos of the PG. Each photo opens full size in a new tab.
export default function PhotoGallery({ limit = gallery.length }) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Photos of YOLO Nest">
      {gallery.slice(0, limit).map((p) => (
        <li key={p.src}>
          <a href={photoUrl(p.src)} target="_blank" rel="noreferrer"
            className="group block overflow-hidden rounded-2xl border border-navy/10 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy">
            <div className="overflow-hidden">
              <Img src={p.src} alt={p.alt} className="aspect-[4/3] w-full object-cover transition duration-300 group-hover:scale-105" />
            </div>
            <span className="block px-3 py-2 text-sm font-medium text-navy">{p.caption}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
