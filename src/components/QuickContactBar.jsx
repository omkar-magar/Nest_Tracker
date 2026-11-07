import { useLocation } from 'react-router-dom'
import { brand } from '../data/site'
import { whatsappUrl } from '../services/contact'

// Marketing pages only: on booking and dashboard pages the bar would cover form buttons.
export const PAGES = ['/', '/rooms', '/amenities', '/location']
const cls = 'py-3.5 text-center text-sm font-semibold focus-visible:outline-2 focus-visible:-outline-offset-4'

export default function QuickContactBar() {
  const { pathname } = useLocation()
  if (!PAGES.includes(pathname)) return null
  return (
    <>
      {/* Spacer so the fixed bar never hides the end of the footer */}
      <div aria-hidden="true" className="h-14 bg-navy md:hidden" />
      <nav aria-label="Quick contact" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 border-t border-navy/10 pb-[env(safe-area-inset-bottom)] md:hidden">
        <a href={`tel:+91${brand.phone}`} className={`${cls} bg-navy text-white focus-visible:outline-white`}>Call now</a>
        <a href={whatsappUrl()} target="_blank" rel="noreferrer" className={`${cls} bg-sun text-navy focus-visible:outline-navy`}>WhatsApp</a>
      </nav>
    </>
  )
}
