import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Download from '../src/pages/Download'
import { _setDeferred, detectPlatform } from '../src/lib/installPrompt'

const setUA = (ua, maxTouchPoints = 0) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
}
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'

const show = () => render(<MemoryRouter><Download /></MemoryRouter>)

afterEach(() => {
  vi.restoreAllMocks()
  act(() => _setDeferred(null))
})

describe('detectPlatform', () => {
  it('tells iOS, iPadOS, Android and desktop apart', () => {
    expect(detectPlatform({ userAgent: IPHONE })).toBe('ios')
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', maxTouchPoints: 5 })).toBe('ios')
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', maxTouchPoints: 0 })).toBe('desktop')
    expect(detectPlatform({ userAgent: ANDROID })).toBe('android')
    expect(detectPlatform({ userAgent: DESKTOP })).toBe('desktop')
  })
})

describe('Download page', () => {
  it('on Android offers the install button once the browser allows it and shows the native prompt', async () => {
    setUA(ANDROID)
    show()
    expect(screen.getByRole('tab', { name: 'Android' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'Download for Android' })).toBeNull()
    expect(screen.getByText(/Tap the ⋮ menu/)).toBeInTheDocument()

    const prompt = vi.fn()
    act(() => _setDeferred({ prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }) }))
    await userEvent.click(screen.getByRole('button', { name: 'Download for Android' }))
    expect(prompt).toHaveBeenCalled()
    expect(await screen.findByText(/Install cancelled/)).toBeInTheDocument()
  })

  it('on iPhone shows Add to Home Screen steps and no install button', () => {
    setUA(IPHONE)
    act(() => _setDeferred({ prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' }) }))
    show()
    expect(screen.getByRole('tab', { name: 'iPhone & iPad' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Download|Install on/ })).toBeNull()
  })

  it('on desktop shows browser instructions and switching tabs changes them', async () => {
    setUA(DESKTOP)
    show()
    expect(screen.getByRole('tab', { name: 'Desktop' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/Install page as app/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'iPhone & iPad' }))
    expect(screen.getByText(/Open this page in Safari/)).toBeInTheDocument()
  })

  it('links staff and admins to their own installable apps', () => {
    setUA(DESKTOP)
    show()
    expect(screen.getByRole('link', { name: 'Staff login' })).toHaveAttribute('href', '/staff/login')
    expect(screen.getByRole('link', { name: 'Admin login' })).toHaveAttribute('href', '/admin/login')
  })
})
