import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { clearQueryCache, fetchQuery, invalidate, isFresh } from '../src/lib/queryCache'
import useQuery from '../src/hooks/useQuery'

describe('fetchQuery', () => {
  it('runs one request for many callers at the same time', async () => {
    const loader = vi.fn(async () => 'x')
    const [a, b] = await Promise.all([fetchQuery('k', loader), fetchQuery('k', loader)])
    expect([a, b]).toEqual(['x', 'x'])
    expect(loader).toHaveBeenCalledTimes(1)
  })
  it('retries once, then gives up with the error', async () => {
    const loader = vi.fn(async () => { throw new Error('offline') })
    await expect(fetchQuery('bad', loader)).rejects.toThrow('offline')
    expect(loader).toHaveBeenCalledTimes(2)
  })
  it('succeeds when the retry works', async () => {
    let n = 0
    const loader = async () => { if (++n === 1) throw new Error('blip'); return 'ok' }
    await expect(fetchQuery('blip', loader)).resolves.toBe('ok')
  })
  it('isFresh is false after invalidate()', async () => {
    await fetchQuery('f', async () => 1)
    expect(isFresh('f', 60_000)).toBe(true)
    invalidate('f')
    expect(isFresh('f', 60_000)).toBe(false)
  })
})

describe('useQuery', () => {
  it('shows cached data at once on a second mount and does not refetch while fresh', async () => {
    const loader = vi.fn(async () => 'cached')
    const first = renderHook(() => useQuery('q', loader, { staleTime: 60_000 }))
    await waitFor(() => expect(first.result.current.data).toBe('cached'))
    first.unmount()
    const second = renderHook(() => useQuery('q', loader, { staleTime: 60_000 }))
    expect(second.result.current).toMatchObject({ data: 'cached', loading: false })
    expect(loader).toHaveBeenCalledTimes(1)
  })
  it('with staleTime 0 it paints from cache but checks again, without a spinner', async () => {
    let n = 0
    const loader = async () => `v${++n}`
    const first = renderHook(() => useQuery('live', loader, { staleTime: 0 }))
    await waitFor(() => expect(first.result.current.data).toBe('v1'))
    first.unmount()
    const second = renderHook(() => useQuery('live', loader, { staleTime: 0 }))
    expect(second.result.current).toMatchObject({ data: 'v1', loading: false })
    await waitFor(() => expect(second.result.current.data).toBe('v2'))
  })
  it('invalidate() refetches every mounted reader', async () => {
    let n = 0
    const loader = async () => ++n
    const a = renderHook(() => useQuery('shared', loader, { staleTime: 60_000 }))
    const b = renderHook(() => useQuery('shared', loader, { staleTime: 60_000 }))
    await waitFor(() => expect(a.result.current.data).toBe(1))
    await act(async () => { invalidate('shared') })
    await waitFor(() => expect(a.result.current.data).toBe(2))
    await waitFor(() => expect(b.result.current.data).toBe(2))
    expect(n).toBe(2) // one shared request, not one per reader
  })
  it('keeps old data and reports the error when a refresh fails', async () => {
    let fail = false
    const loader = async () => { if (fail) throw new Error('down'); return 'good' }
    const { result } = renderHook(() => useQuery('keep', loader, { staleTime: 60_000 }))
    await waitFor(() => expect(result.current.data).toBe('good'))
    fail = true
    await act(async () => { result.current.reload() })
    await waitFor(() => expect(result.current.error).toMatchObject({ message: 'down' }))
    expect(result.current.data).toBe('good')
  })
  it('does not leak between tests (cache cleared by setup)', () => {
    clearQueryCache()
    const { result } = renderHook(() => useQuery('empty', async () => 'later'))
    expect(result.current).toMatchObject({ data: null, loading: true })
  })
})
