import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Only the public anon key belongs here. The service-role key must never be in frontend code or .env files
// that Vite can see (anything prefixed VITE_ is shipped to the browser).
export const isConfigured = Boolean(url && anonKey)

// Each browser tab keeps its own login (sessionStorage), so signing in or out in one tab never affects another
// and manager / customer / admin can be tested side by side. It survives a reload but not closing the tab.
// Installed PWAs (standalone window) keep the shared, persistent login in localStorage so the app stays signed in.
// ?tab-session=0 forces the shared login for that tab; ?tab-session=1 forces per-tab again.
function authStorage() {
  try {
    const flag = new URLSearchParams(window.location.search).get('tab-session')
    if (flag === '1') sessionStorage.removeItem('yolo.shared-login')
    if (flag === '0') sessionStorage.setItem('yolo.shared-login', '1')
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
    return standalone || sessionStorage.getItem('yolo.shared-login') === '1' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

export const supabase = isConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: authStorage() },
    })
  : null

// Turns a Supabase / Postgres error into a message a visitor can read.
export function errorMessage(error) {
  if (!error) return ''
  return error.message || String(error)
}
