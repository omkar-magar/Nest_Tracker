import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

import { resetMock, setConfigured, supabase } from './helpers/supabaseMock.js'
import useAsync from '../src/hooks/useAsync'
import useCatalog from '../src/hooks/useCatalog'
import usePwaIdentity from '../src/hooks/usePwaIdentity'

beforeEach(() => {
  resetMock()
  document.head.innerHTML = ''
})

describe('useAsync', () => {
  it('starts loading, then exposes the data', async () => {
    const { result } = renderHook(() => useAsync(async () => 'hello', []))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ data: 'hello', error: null })
  })

  it('exposes the error and clears the data when the loader rejects', async () => {
    const boom = new Error('boom')
    const { result } = renderHook(() => useAsync(async () => { throw boom }, []))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ data: null, error: boom })
  })

  it('reload() refetches without flipping back to the loading state', async () => {
    let n = 0
    const { result } = renderHook(() => useAsync(async () => ++n, []))
    await waitFor(() => expect(result.current.data).toBe(1))
    let sawLoading = false
    await act(async () => {
      result.current.reload()
      sawLoading = result.current.loading
    })
    await waitFor(() => expect(result.current.data).toBe(2))
    expect(sawLoading).toBe(false)
  })

  it('keeps the old data if a quiet reload fails', async () => {
    let fail = false
    const { result } = renderHook(() => useAsync(async () => { if (fail) throw new Error('late'); return 'ok' }, []))
    await waitFor(() => expect(result.current.data).toBe('ok'))
    fail = true
    await act(async () => { await result.current.reload() })
    expect(result.current.data).toBe('ok')
    expect(result.current.error).toMatchObject({ message: 'late' })
  })

  it('re-runs when deps change and ignores the stale result', async () => {
    const resolvers = {}
    const loader = (id) => () => new Promise((res) => { resolvers[id] = res })
    const { result, rerender } = renderHook(({ id }) => useAsync(loader(id), [id]), { initialProps: { id: 'a' } })
    rerender({ id: 'b' })
    await act(async () => { resolvers.b('B'); resolvers.a('A') })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBe('B')
  })
})

describe('useCatalog', () => {
  it('loads the static catalog when Supabase is not configured', async () => {
    setConfigured(false)
    const { result } = renderHook(() => useCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data.live).toBe(false)
    expect(result.current.data.rooms.length).toBeGreaterThan(0)
  })

  it('subscribes to availability and reloads (debounced) when a bed changes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { db } = await import('./helpers/supabaseMock.js')
      db.tables.categories = { data: [], error: null }
      db.tables.rooms = { data: [], error: null }
      db.tables.beds = { data: [], error: null }
      db.tables.amenities = { data: [], error: null }
      const { result, unmount } = renderHook(() => useCatalog())
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(result.current.loading).toBe(false)

      const ch = supabase.channel.mock.results[0].value
      const onChange = ch.on.mock.calls[0][2]
      const before = supabase.from.mock.calls.length
      await act(async () => { onChange(); onChange(); onChange() }) // burst of events
      expect(supabase.from.mock.calls.length).toBe(before) // nothing yet: debounced
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      expect(supabase.from.mock.calls.length).toBe(before + 3) // exactly one refetch (3 queries)

      unmount()
      expect(supabase.removeChannel).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('usePwaIdentity', () => {
  const wrapper = (path) => ({ children }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  const head = (sel, attr) => document.head.querySelector(sel)?.getAttribute(attr)

  it.each([
    ['/', '/manifest.webmanifest', 'YOLO Nest'],
    ['/rooms', '/manifest.webmanifest', 'YOLO Nest'],
    ['/staff', '/manifest-staff.webmanifest', 'YOLO Staff'],
    ['/staff/login', '/manifest-staff.webmanifest', 'YOLO Staff'],
    ['/admin', '/manifest-admin.webmanifest', 'YOLO Admin'],
  ])('on %s it points the head at %s', (path, manifest, title) => {
    renderHook(() => usePwaIdentity(), { wrapper: wrapper(path) })
    expect(head('link[rel="manifest"]', 'href')).toBe(manifest)
    expect(head('meta[name="apple-mobile-web-app-title"]', 'content')).toBe(title)
    expect(head('meta[name="theme-color"]', 'content')).toBeTruthy()
    expect(head('link[rel="apple-touch-icon"]', 'href')).toMatch(/\/icons\/.*-192\.png$/)
  })

  it('reuses the existing tags instead of adding duplicates', () => {
    const { unmount } = renderHook(() => usePwaIdentity(), { wrapper: wrapper('/admin') })
    unmount()
    renderHook(() => usePwaIdentity(), { wrapper: wrapper('/staff') })
    expect(document.head.querySelectorAll('link[rel="manifest"]')).toHaveLength(1)
    expect(head('link[rel="manifest"]', 'href')).toBe('/manifest-staff.webmanifest')
  })
})
