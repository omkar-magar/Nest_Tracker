import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
import { useAction } from '../src/components/manage/kit'

function Save({ fn }) {
  const a = useAction()
  return <button type="button" disabled={a.busy} onClick={() => a.run(fn)}>Save</button>
}

describe('useAction', () => {
  it('runs an action once when clicked twice before it re-renders', async () => {
    let finish
    const fn = vi.fn(() => new Promise((r) => { finish = r }))
    render(<Save fn={fn} />)
    const b = screen.getByRole('button', { name: 'Save' })
    act(() => { b.click(); b.click() })
    expect(fn).toHaveBeenCalledTimes(1)
    await act(async () => { finish() })
    act(() => { b.click() })
    expect(fn).toHaveBeenCalledTimes(2) // free again once the first one finished
  })
})
