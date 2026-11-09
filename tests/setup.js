import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { clearQueryCache, retryConfig } from '../src/lib/queryCache'

afterEach(() => cleanup())

// the public-data cache is module-level: start every test empty, and do not wait before the one retry
beforeEach(() => { clearQueryCache(); retryConfig.delay = 0 })

// jsdom has no scrollTo / scrollIntoView
window.scrollTo = () => {}
Element.prototype.scrollIntoView = () => {}

// jsdom has no matchMedia (NearbyMap checks prefers-reduced-motion)
window.matchMedia ??= (query) => ({
  matches: false, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
})

// React Router v6 prints future-flag notices on every render; they are not test failures
const warn = console.warn
console.warn = (...args) => {
  if (String(args[0]).includes('React Router Future Flag')) return
  warn(...args)
}
