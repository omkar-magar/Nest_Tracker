import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, isConfigured } from '../lib/supabase'

const AuthContext = createContext(null)

// Session restore is Supabase's job (persistSession). This only mirrors it into React and loads the profile.
// The role shown here is for choosing which screen to render. Real enforcement is RLS and the RPCs.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(isConfigured)
  const [profileReady, setProfileReady] = useState(false) // false while a signed-in user's profile is still loading

  const loadProfile = useCallback(async (userId) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) console.error('profile load failed', error)
    setProfile(data ?? null)
    setProfileReady(true)
  }, [])

  useEffect(() => {
    if (!isConfigured) return
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session) await loadProfile(data.session.user.id)
      else setProfileReady(true)
      if (active) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setProfile(null)
        setProfileReady(true)
      } else if (_event !== 'TOKEN_REFRESHED') {
        setProfileReady(false)
        // defer: supabase calls must not run inside this callback
        setTimeout(() => loadProfile(next.user.id), 0)
      }
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password })

  const signUp = (email, password, fullName, phone) =>
    supabase.auth.signUp({ email, password, options: { data: { full_name: fullName, phone } } })

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  const value = useMemo(
    () => ({
      configured: isConfigured,
      loading: loading || (Boolean(session) && !profileReady),
      session,
      user: session?.user ?? null,
      profile,
      role: profile?.is_active === false ? null : profile?.role ?? null,
      signIn,
      signUp,
      signOut,
      refreshProfile: () => session && loadProfile(session.user.id),
    }),
    [loading, session, profile, profileReady, loadProfile],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
