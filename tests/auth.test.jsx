import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

import { db, queryFor, resetMock, setConfigured, supabase } from './helpers/supabaseMock.js'
import { AuthProvider, useAuth } from '../src/context/AuthContext'

let ctx
function Probe() {
  ctx = useAuth()
  return <p data-testid="state">{ctx.loading ? 'loading' : `role:${ctx.role ?? 'none'}`}</p>
}
const mount = () => render(<AuthProvider><Probe /></AuthProvider>)

const session = { user: { id: 'u1', email: 'a@b.c' } }
const profile = (over = {}) => ({ data: { id: 'u1', full_name: 'Asha', role: 'customer', is_active: true, ...over }, error: null })

let authCallback
beforeEach(() => {
  resetMock()
  authCallback = undefined
  supabase.auth.onAuthStateChange.mockImplementation((cb) => {
    authCallback = cb
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
})

describe('AuthProvider', () => {
  it('without Supabase: not loading, no user, configured=false', () => {
    setConfigured(false)
    mount()
    expect(screen.getByTestId('state')).toHaveTextContent('role:none')
    expect(ctx).toMatchObject({ configured: false, user: null, session: null })
    expect(supabase.auth.getSession).not.toHaveBeenCalled()
  })

  it('with no stored session: finishes loading as a signed-out visitor', async () => {
    mount()
    expect(screen.getByTestId('state')).toHaveTextContent('loading')
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('role:none'))
    expect(ctx.user).toBeNull()
  })

  it('restores a stored session and loads the profile role', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session } })
    db.tables.profiles = profile({ role: 'admin' })
    mount()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('role:admin'))
    expect(ctx.user).toEqual(session.user)
    expect(ctx.profile.full_name).toBe('Asha')
    expect(queryFor('profiles')[0].ops).toContainEqual(['eq', ['id', 'u1']])
  })

  it('stays "loading" until the profile has arrived (no flash of the wrong screen)', async () => {
    let release
    supabase.auth.getSession.mockResolvedValue({ data: { session } })
    db.tables.profiles = new Promise((r) => { release = () => r(profile()) })
    mount()
    await act(async () => {})
    expect(screen.getByTestId('state')).toHaveTextContent('loading')
    await act(async () => release())
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('role:customer'))
  })

  it('a deactivated account has no role', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session } })
    db.tables.profiles = profile({ is_active: false, role: 'employee' })
    mount()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('role:none'))
    expect(ctx.user).toBeTruthy()
  })

  it('a signed-in user without a profile row has no role', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session } })
    db.tables.profiles = { data: null, error: null }
    mount()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('role:none'))
  })

  it('logs but survives a profile load error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    supabase.auth.getSession.mockResolvedValue({ data: { session } })
    db.tables.profiles = { data: null, error: new Error('rls') }
    mount()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('role:none'))
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('signIn / signUp pass the credentials and metadata to Supabase', async () => {
    mount()
    await waitFor(() => expect(ctx.loading).toBe(false))
    await ctx.signIn('a@b.c', 'secret123')
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.c', password: 'secret123' })
    await ctx.signUp('a@b.c', 'secret123', 'Asha', '9876543210')
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'a@b.c', password: 'secret123', options: { data: { full_name: 'Asha', phone: '9876543210' } },
    })
  })

  it('signOut calls Supabase and clears the profile', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session } })
    db.tables.profiles = profile()
    mount()
    await waitFor(() => expect(ctx.role).toBe('customer'))
    await act(async () => { await ctx.signOut() })
    expect(supabase.auth.signOut).toHaveBeenCalled()
    expect(ctx.profile).toBeNull()
  })

  it('reacts to auth events: sign-out clears everything, sign-in loads the profile', async () => {
    mount()
    await waitFor(() => expect(ctx.loading).toBe(false))

    db.tables.profiles = profile({ role: 'employee' })
    await act(async () => { authCallback('SIGNED_IN', session) })
    await waitFor(() => expect(ctx.role).toBe('employee'))

    await act(async () => { authCallback('SIGNED_OUT', null) })
    expect(ctx).toMatchObject({ user: null, profile: null, role: null, loading: false })
  })

  it('does not refetch the profile on a token refresh', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session } })
    db.tables.profiles = profile()
    mount()
    await waitFor(() => expect(ctx.role).toBe('customer'))
    const before = queryFor('profiles').length
    await act(async () => { authCallback('TOKEN_REFRESHED', session) })
    await new Promise((r) => setTimeout(r, 20))
    expect(queryFor('profiles').length).toBe(before)
    expect(ctx.role).toBe('customer')
  })

  it('refreshProfile reloads the profile row', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session } })
    db.tables.profiles = profile({ full_name: 'Old' })
    mount()
    await waitFor(() => expect(ctx.profile?.full_name).toBe('Old'))
    db.tables.profiles = profile({ full_name: 'New' })
    await act(async () => { await ctx.refreshProfile() })
    expect(ctx.profile.full_name).toBe('New')
  })

  it('unsubscribes from auth events on unmount', async () => {
    const unsubscribe = vi.fn()
    supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
    const { unmount } = mount()
    await waitFor(() => expect(ctx.loading).toBe(false))
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
