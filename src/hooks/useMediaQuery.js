import { useEffect, useState } from 'react'

// True while the media query matches. Used to render only the image that fits the screen:
// an <img> hidden with CSS (display: none) is still downloaded.
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return undefined
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}
