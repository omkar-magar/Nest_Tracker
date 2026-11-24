import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Only the public anon key belongs here. The service-role key must never be in frontend code or .env files
// that Vite can see (anything prefixed VITE_ is shipped to the browser).
export const isConfigured = Boolean(url && anonKey)

// Per-tab sessions, for testing several accounts side by side (customer, staff, admin in different tabs).
// Open any page with ?tab-session=1 to make that tab keep its own login in sessionStorage; ?tab-session=0 turns it off.
// Normal tabs share one login through localStorage, so a sign-in in one tab switches the account in all of them.
function tabSessionStorage() {
  try {
    const flag = new URLSearchParams(window.location.search).get('tab-session')
    if (flag === '1') sessionStorage.setItem('yolo.tab-session', '1')
    if (flag === '0') sessionStorage.removeItem('yolo.tab-session')
    return sessionStorage.getItem('yolo.tab-session') === '1' ? sessionStorage : undefined
  } catch {
    return undefined
  }
}

export const supabase = isConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: tabSessionStorage() },
    })
  : null

// Turns a Supabase / Postgres error into a message a visitor can read.
export function errorMessage(error) {
  if (!error) return ''
  return error.message || String(error)
}
