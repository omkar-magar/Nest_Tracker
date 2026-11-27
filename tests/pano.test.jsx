import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))

// the real viewer needs WebGL; record what it was given instead
const viewers = vi.hoisted(() => [])
vi.mock('pannellum/build/pannellum.js', () => {
  window.pannellum = {
    viewer(el, opts) {
      const v = {
        el, opts, destroyed: false, handlers: {},
        on(evt, fn) { v.handlers[evt] = fn },
        fire(evt, arg) { v.handlers[evt]?.(arg) },
        destroy() { v.destroyed = true },
      }
      viewers.push(v)
      return v
    },
  }
  return {}
})
vi.mock('pannellum/build/pannellum.css', () => ({}))

import { resetMock, setConfigured } from './helpers/supabaseMock.js'
import { renderAt } from './helpers/render.jsx'
import PanoButton from '../src/components/PanoButton'
import RoomCard from '../src/components/RoomCard'
import Hero from '../src/components/Hero'
import PanoViewer, { LOAD_TIMEOUT_MS } from '../src/components/PanoViewer'
import { clampPitch, drawView, viewTable } from '../src/components/SoftPano'
import { amenityPano, clearPanoChecks, roomPano } from '../src/lib/pano'
import { loadAmenities } from '../src/services/catalog'

// files that "exist"; everything else answers like an SPA host (index.html)
let files = []
beforeEach(() => {
  resetMock()
  clearPanoChecks()
  viewers.length = 0
  files = []
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true,
    headers: { get: () => (files.includes(url) ? 'image/jpeg' : 'text/html') },
  })))
  // jsdom has no WebGL; pretend the browser does unless a test says otherwise
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({})
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('360 file names', () => {
  it('rooms use the room id, amenities a slug of the title', () => {
    expect(roomPano('pg-101')).toBe('/images/360/pg-101.jpg')
    expect(amenityPano('Chill café area')).toBe('/images/360/chill-cafe-area.jpg')
    expect(amenityPano('CCTV & biometric entry')).toBe('/images/360/cctv-biometric-entry.jpg')
  })
  it('the static amenities carry their 360 path', async () => {
    setConfigured(false)
    const { amenities } = await loadAmenities()
    expect(amenities.find((a) => a.title === 'Gym').pano).toBe('/images/360/gym.jpg')
  })
})

describe('PanoButton', () => {
  it('without the 360 file (SPA fallback page) it opens the normal photo and a coming-soon note', async () => {
    renderAt(<PanoButton src="/images/360/gym.jpg" fallback="/images/hero/gym.webp" title="Gym" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: 'Open 360 view of Gym' }))
    const dialog = screen.getByRole('dialog', { name: '360 view of Gym' })
    expect(dialog).toHaveTextContent('The 360 view of Gym is coming soon.')
    expect(screen.getByAltText('Gym')).toHaveAttribute('src', '/images/hero/gym.webp?v=2')
    expect(viewers).toHaveLength(0)
  })

  it('opens the viewer in a dialog, and Escape closes it and returns focus', async () => {
    files = ['/images/360/gym.jpg']
    renderAt(<PanoButton src="/images/360/gym.jpg" title="Gym" />)
    const open = await screen.findByRole('button', { name: 'Open 360 view of Gym' })
    await userEvent.click(open)
    const dialog = await screen.findByRole('dialog', { name: '360 view of Gym' })
    await waitFor(() => expect(viewers).toHaveLength(1))
    expect(viewers[0].opts).toMatchObject({
      type: 'equirectangular', panorama: '/images/360/gym.jpg', title: 'Gym',
      autoLoad: true, draggable: true, minPitch: -45, maxPitch: 60,
    })
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(dialog).not.toBeInTheDocument()
    expect(viewers[0].destroyed).toBe(true)
    expect(open).toHaveFocus()
  })

  it('without WebGL it still shows a 360 view, drawn on a plain canvas', async () => {
    HTMLCanvasElement.prototype.getContext.mockImplementation((type) => (/webgl/.test(type) ? null : {}))
    files = ['/images/360/gym.jpg']
    renderAt(<PanoButton src="/images/360/gym.jpg" title="Gym" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await userEvent.click(await screen.findByRole('button', { name: 'Open 360 view of Gym' }))
    expect(await screen.findByRole('application', { name: /360 view of Gym\. Drag or use the arrow keys/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(viewers).toHaveLength(0)
  })

  it('when the browser cannot draw on a canvas at all, it shows the flat photo', async () => {
    HTMLCanvasElement.prototype.getContext.mockReturnValue(null)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    files = ['/images/360/gym.jpg']
    renderAt(<PanoButton src="/images/360/gym.jpg" title="Gym" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await userEvent.click(await screen.findByRole('button', { name: 'Open 360 view of Gym' }))
    expect(await screen.findByAltText('360 panorama of Gym')).toHaveAttribute('src', '/images/360/gym.jpg')
    expect(screen.getByRole('region', { name: 'Gym panorama, scroll sideways to look around' })).toBeInTheDocument()
    expect(screen.getByText(/couldn't draw the 360 view/)).toBeInTheDocument()
  })
})

describe('PanoViewer switches to the canvas 360 view instead of a blank box', () => {
  const soft = () => screen.queryByRole('application', { name: /360 view of Café/ })
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))

  it('when Pannellum reports an error', () => {
    renderAt(<PanoViewer src="/images/360/cafe.jpg" caption="Café" />)
    expect(soft()).toBeNull()
    act(() => viewers[0].fire('error', 'Something went wrong with WebGL!'))
    expect(soft()).not.toBeNull()
    expect(viewers[0].destroyed).toBe(true)
  })

  it('when the graphics context is lost', () => {
    renderAt(<PanoViewer src="/images/360/cafe.jpg" caption="Café" />)
    const canvas = document.createElement('canvas')
    viewers[0].el.appendChild(canvas)
    act(() => { canvas.dispatchEvent(new Event('webglcontextlost')) })
    expect(soft()).not.toBeNull()
  })

  it('when it never finishes loading, but not once it has loaded', () => {
    vi.useFakeTimers()
    try {
      const { unmount } = renderAt(<PanoViewer src="/images/360/cafe.jpg" caption="Café" />)
      act(() => vi.advanceTimersByTime(LOAD_TIMEOUT_MS))
      expect(soft()).not.toBeNull()
      unmount()

      renderAt(<PanoViewer src="/images/360/cafe.jpg" caption="Café" />)
      act(() => viewers[1].fire('load'))
      act(() => vi.advanceTimersByTime(LOAD_TIMEOUT_MS * 2))
      expect(soft()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('360 buttons on the page', () => {
  it('every room card shows one, even before its 360 photo is added', async () => {
    renderAt(<RoomCard room={{ id: 'pg-101', no: '101', floor: 1, type: 'AC', features: [], image: '/images/rooms/pg-101.webp', rentBasis: 'bed', billing: 'month', price: 1, deposit: 0, beds: null, totalBeds: 2 }} categoryName="Monthly PG" />)
    expect(await screen.findByRole('button', { name: 'Open 360 view of Room 101' })).toBeInTheDocument()
  })

  it('the hero shows it only for the photo on display, and keeps that photo open while it has focus', async () => {
    renderAt(<Hero scrollTo={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Open 360 view of Gym' })
    expect(btn).toHaveAttribute('tabindex', '-1')

    const gym = screen.getByRole('button', { name: 'Gym' })
    fireEvent.focus(gym)
    expect(btn).toHaveAttribute('tabindex', '0')
    fireEvent.blur(gym, { relatedTarget: btn })
    expect(screen.getByText('Fully equipped gym open all day for residents.').closest('.z-20').className).toContain('opacity-100')
  })

  it('the mouse can cross other photos on its way to the 360 button without switching photo', () => {
    vi.useFakeTimers()
    try {
      renderAt(<Hero scrollTo={() => {}} />)
      const mouse = { pointerType: 'mouse' }
      const panel = (text) => screen.getByText(text).closest('.z-20').className
      const cafe = 'A cosy space to work, chat or grab a coffee.'

      fireEvent.pointerEnter(screen.getByRole('button', { name: 'Café Area' }), mouse)
      expect(panel(cafe)).toContain('opacity-100')

      // passes over Pickleball and Gym, then lands on the café's text + button
      fireEvent.pointerEnter(screen.getByRole('button', { name: 'Pickleball Court' }), mouse)
      fireEvent.pointerEnter(screen.getByRole('button', { name: 'Gym' }), mouse)
      fireEvent.pointerEnter(screen.getByText(cafe).parentElement, mouse)
      act(() => vi.advanceTimersByTime(1000))
      expect(panel(cafe)).toContain('opacity-100')
      expect(screen.getByRole('button', { name: 'Open 360 view of Café Area' })).toHaveAttribute('tabindex', '0')

      // resting on another photo still switches to it
      fireEvent.pointerEnter(screen.getByRole('button', { name: 'Gym' }), mouse)
      act(() => vi.advanceTimersByTime(300))
      expect(panel('Fully equipped gym open all day for residents.')).toContain('opacity-100')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('canvas 360 projection', () => {
  // 8 x 4 photo; each column has its own red value (column x 20), so a pixel's red says where it came from
  const W = 8, H = 4
  const src = Uint32Array.from({ length: W * H }, (_, i) => (0xff000000 | ((i % W) * 20)) >>> 0)
  const centreRed = (yaw, pitch = 0) => {
    const t = viewTable(W, H, 3, 3, pitch, 90)
    const out = new Uint32Array(9)
    drawView(src, W, H, t, yaw, out)
    return out[4] & 255
  }

  it('looking straight ahead shows the middle of the photo, blended between neighbouring pixels', () => {
    const t = viewTable(W, H, 3, 3, 0, 90)
    expect(t.u[4]).toBeCloseTo(W / 2 - 0.5) // halfway between columns 3 and 4
    expect(t.v[4]).toBeCloseTo(H / 2 - 0.5)
    expect(centreRed(0)).toBe(70) // (60 + 80) / 2: smooth, not a jagged nearest-pixel pick
  })

  it('turning right moves along the photo and wraps around the seam', () => {
    expect(centreRed(90)).toBe(110) // columns 5 and 6
    expect(centreRed(-90)).toBe(30) // columns 1 and 2
    expect(centreRed(180)).toBe(70) // column 7 (140) blended with column 0 (0) across the seam
  })

  it('looking up shows the top of the photo, and the left of the view is the left of the photo', () => {
    expect(viewTable(W, H, 3, 3, 60, 90).v[4]).toBeLessThan(1)
    const t = viewTable(W, H, 3, 3, 0, 120)
    expect(t.u[3]).toBeLessThan(t.u[5])
  })

  it('keeps the view inside the allowed pitch range', () => {
    expect(clampPitch(80, 100, 16 / 9)).toBeLessThan(60)
    expect(clampPitch(-80, 100, 16 / 9)).toBeGreaterThan(-45)
    expect(clampPitch(-5, 100, 16 / 9)).toBe(-5)
  })
})
