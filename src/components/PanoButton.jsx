import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Img from './Img'
import { usePano } from '../lib/pano'

const PanoViewer = lazy(() => import('./PanoViewer'))

// "360 view" pill that opens the 360 photo full screen. Until that file is added it opens
// the normal photo (fallback) with a "coming soon" note instead.
export default function PanoButton({ src, title, fallback, className = '', tabIndex }) {
  const ok = usePano(src)
  const [open, setOpen] = useState(false)
  const opener = useRef(null)

  const close = () => { setOpen(false); opener.current?.focus() }
  return (
    <>
      <button
        ref={opener}
        type="button"
        tabIndex={tabIndex}
        onClick={() => setOpen(true)}
        aria-label={`Open 360 view of ${title}`}
        className={`inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-navy shadow-sm transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun ${className}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <ellipse cx="12" cy="12" rx="10" ry="4" />
          <path d="M12 2a4 10 0 0 1 0 20" />
        </svg>
        360 view
      </button>
      {open && createPortal(<PanoDialog src={ok ? src : null} fallback={fallback} title={title} onClose={close} />, document.body)}
    </>
  )
}

function PanoDialog({ src, fallback, title, onClose }) {
  const closeBtn = useRef(null)
  useEffect(() => {
    closeBtn.current?.focus()
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = overflow }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/90 p-2 sm:p-6" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`360 view of ${title}`} className="flex h-full max-h-[48rem] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-navy">
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-white">
          <h2 className="truncate font-semibold">{title} <span className="font-normal text-white/80">· {src ? 'drag to look around' : '360 view coming soon'}</span></h2>
          <button
            ref={closeBtn}
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/15 px-3 py-1 text-sm font-semibold transition hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-sun"
          >
            Close
          </button>
        </div>
        {src ? (
          <div className="min-h-0 flex-1">
            <Suspense fallback={<p className="p-6 text-white">Loading 360 view…</p>}>
              <PanoViewer src={src} caption={title} />
            </Suspense>
          </div>
        ) : (
          <div className="relative min-h-0 flex-1">
            {fallback && <Img src={fallback} alt={title} className="h-full w-full object-contain" />}
            <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy via-navy/80 to-transparent p-4 pt-10 text-center text-sm text-white">
              The 360 view of {title} is coming soon. Book a visit to see it in person.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
