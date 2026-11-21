import { useEffect, useState } from 'react'

// 360 photos live in public/images/360/. A room's file is named after its id; an amenity's after its title.
export const roomPano = (id) => `/images/360/${id}.jpg`
export const amenityPano = (title) => `/images/360/${slug(title)}.jpg`

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// One HEAD request per file per page load. The dev server and SPA hosts answer a missing file with
// index.html, so only an image content type counts as "exists".
const checks = new Map()
export function panoExists(src) {
  if (!checks.has(src)) {
    checks.set(src, fetch(src, { method: 'HEAD' })
      .then((r) => r.ok && (r.headers.get('content-type') || '').startsWith('image/'))
      .catch(() => false))
  }
  return checks.get(src)
}
export const clearPanoChecks = () => checks.clear()

// true once the 360 file is known to exist, so the 360 button never opens an empty viewer
export function usePano(src) {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    let live = true
    setOk(false)
    if (src) panoExists(src).then((v) => live && setOk(v))
    return () => { live = false }
  }, [src])
  return ok
}
