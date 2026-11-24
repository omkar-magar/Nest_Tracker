import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Only the public anon key belongs here. The service-role key must never be in frontend code or .env files
// that Vite can see (anything prefixed VITE_ is shipped to the browser).
export const isConfigured = Boolean(url && anonKey)

export const supabase = isConfigured
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  : null

// Turns a Supabase / Postgres error into a message a visitor can read.
export function errorMessage(error) {
  if (!error) return ''
  return error.message || String(error)
}
