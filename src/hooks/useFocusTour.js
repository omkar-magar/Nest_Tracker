import { useEffect, useRef, useState } from 'react'
import useMediaQuery from './useMediaQuery'

export const FOCUS_MS = 3800 // how long one item stays in focus
export const REST_MS = 2200 // pause with nothing in focus; includes the fade back (see .hero-focus)
const VISIBLE_RATIO = 0.4 // share of the target that must be on screen

// Steps through `count` items on a timer: rest, focus item 0, rest, focus item 1, ...
// Returns the focused index, or null while resting. Runs only while `targetRef` is on screen,
// `paused` is false and the visitor has not asked for reduced motion.
export default function useFocusTour(count, targetRef, paused) {
  const [current, setCurrent] = useState(null)
  const [inView, setInView] = useState(() => !('IntersectionObserver' in window))
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const next = useRef(0) // survives a pause, so the tour carries on where it stopped

  useEffect(() => {
    if (!('IntersectionObserver' in window) || !targetRef.current) return undefined
    // Compare the ratio: browsers disagree on isIntersecting below the threshold
    const observer = new IntersectionObserver(([entry]) => setInView(entry.intersectionRatio >= VISIBLE_RATIO), { threshold: VISIBLE_RATIO })
    observer.observe(targetRef.current)
    return () => observer.disconnect()
  }, [targetRef])

  const running = inView && !reducedMotion && !paused

  useEffect(() => {
    if (!running) return undefined
    let timer
    const focus = () => {
      setCurrent(next.current)
      next.current = (next.current + 1) % count
      timer = setTimeout(rest, FOCUS_MS)
    }
    const rest = () => {
      setCurrent(null)
      timer = setTimeout(focus, REST_MS)
    }
    timer = setTimeout(focus, REST_MS)
    return () => {
      clearTimeout(timer)
      setCurrent(null)
    }
  }, [running, count])

  return current
}
