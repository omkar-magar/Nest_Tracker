// Browsers keep /images/* for days (see vercel.json), so a photo replaced under the same file name
// would stay old on phones that visited before. Bump this when photos are replaced; every device
// then fetches the new files.
export const PHOTO_VERSION = 2

// Adds ?v=PHOTO_VERSION to our own /images/ paths; other URLs are left alone.
export function photoUrl(src) {
  if (!src || !src.startsWith('/images/') || src.includes('?')) return src
  return `${src}?v=${PHOTO_VERSION}`
}
