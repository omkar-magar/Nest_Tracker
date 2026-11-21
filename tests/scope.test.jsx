import { afterEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ScopeProvider, useScope } from '../src/components/manage/kit'

const wings = [{ id: 'P1', name: 'YOLO Nest A wing' }, { id: 'P2', name: 'YOLO Nest B wing' }]
let scope
function Probe() {
  scope = useScope()
  return <p>scope:{scope.property || 'all'}</p>
}

afterEach(() => sessionStorage.clear())

describe('property scope', () => {
  it('opens on the login\'s default wing', () => {
    render(<ScopeProvider properties={wings} initial="P2"><Probe /></ScopeProvider>)
    expect(screen.getByText('scope:P2')).toBeInTheDocument()
  })

  it('opens on all wings (grand total) with no default', () => {
    render(<ScopeProvider properties={wings}><Probe /></ScopeProvider>)
    expect(screen.getByText('scope:all')).toBeInTheDocument()
  })

  it('keeps a switch for this visit, including back to all wings', () => {
    const { unmount } = render(<ScopeProvider properties={wings} initial="P1"><Probe /></ScopeProvider>)
    act(() => scope.setProperty(''))
    expect(screen.getByText('scope:all')).toBeInTheDocument()
    unmount()
    render(<ScopeProvider properties={wings} initial="P1"><Probe /></ScopeProvider>)
    expect(screen.getByText('scope:all')).toBeInTheDocument()
  })

  it('ignores a wing the login can no longer see', () => {
    render(<ScopeProvider properties={wings.slice(0, 1)} initial="P2"><Probe /></ScopeProvider>)
    expect(screen.getByText('scope:all')).toBeInTheDocument()
  })
})
