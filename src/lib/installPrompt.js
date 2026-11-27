// Chrome/Edge fire `beforeinstallprompt` once, often before the Download page has mounted,
// so we catch it at startup (imported from main.jsx) and hand it to whoever asks later.
let deferred = null
let installed = false
const listeners = new Set()
const notify = () => listeners.forEach((fn) => fn())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    notify()
  })
}

export const canInstall = () => !!deferred

export function isInstalled() {
  if (installed) return true
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Shows the browser's own install dialog. Resolves 'accepted', 'dismissed' or 'unavailable'.
export async function promptInstall() {
  if (!deferred) return 'unavailable'
  const e = deferred
  deferred = null
  e.prompt()
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') installed = true
  notify()
  return outcome
}

// 'ios' | 'android' | 'desktop'. iPadOS reports itself as a Mac, so touch support tells them apart.
export function detectPlatform(nav = typeof navigator === 'undefined' ? {} : navigator) {
  const ua = nav.userAgent || ''
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && nav.maxTouchPoints > 1)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'desktop'
}

// test hook: simulate the browser firing the event
export function _setDeferred(e) {
  deferred = e
  installed = false
  notify()
}
