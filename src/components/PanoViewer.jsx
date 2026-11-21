import { useEffect, useRef, useState } from 'react'
import 'pannellum/build/pannellum.css'
import 'pannellum/build/pannellum.js' // plain script: sets window.pannellum
import SoftPano from './SoftPano'

// Pannellum needs WebGL 1; it is off when the browser has hardware acceleration disabled
// or a blocked graphics driver
export function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl') || c.getContext('experimental-webgl'))
  } catch {
    return false
  }
}

// how long the WebGL view may take to appear before the canvas 360 view is used instead
export const LOAD_TIMEOUT_MS = 10000

// Loaded lazily by PanoButton, so the viewer code and its CSS only download when someone opens a 360 view.
// Pannellum (WebGL) first. Any trouble with it (no WebGL, an error, a lost graphics context, never
// finishing loading) switches to SoftPano, a 360 view drawn without WebGL; the flat photo is the last resort.
export default function PanoViewer({ src, caption }) {
  const [mode, setMode] = useState(() => (hasWebGL() ? 'sphere' : 'soft'))
  if (mode === 'sphere') return <SphereViewer src={src} caption={caption} onFail={() => setMode('soft')} />
  if (mode === 'soft') return <SoftPano src={src} caption={caption} onFail={() => setMode('flat')} />
  return <FlatPano src={src} caption={caption} />
}

// Pannellum: drag with the mouse (or a finger) to look around, scroll or +/- to zoom.
// It turns slowly by itself and starts again a few seconds after the visitor lets go.
function SphereViewer({ src, caption, onFail }) {
  const box = useRef(null)
  const fail = useRef(onFail)
  fail.current = onFail
  useEffect(() => {
    const el = box.current
    let viewer
    const giveUp = (why) => { console.warn('WebGL 360 view failed, using the canvas view:', why); fail.current() }
    // webglcontextlost does not bubble, so listen in the capture phase
    const lost = () => giveUp('WebGL context lost')
    el.addEventListener('webglcontextlost', lost, true)
    const timer = setTimeout(() => giveUp('not loaded in time'), LOAD_TIMEOUT_MS)
    try {
      viewer = window.pannellum.viewer(el, {
        type: 'equirectangular',
        panorama: src,
        title: caption,
        autoLoad: true,
        autoRotate: -2,
        autoRotateInactivityDelay: 4000,
        draggable: true,
        mouseZoom: true,
        showZoomCtrl: true,
        showFullscreenCtrl: true,
        hfov: 100,
        pitch: -5,
        // the floor right under the camera is distorted, so looking down is limited
        maxPitch: 60,
        minPitch: -45,
        strings: { loadingLabel: 'Loading 360 view…' },
      })
      viewer.on('load', () => clearTimeout(timer))
      viewer.on('error', (msg) => giveUp(msg))
    } catch (err) {
      giveUp(err)
    }
    return () => {
      clearTimeout(timer)
      el.removeEventListener('webglcontextlost', lost, true)
      try { viewer?.destroy() } catch { /* already torn down */ }
    }
  }, [src, caption])
  // dark while loading instead of Pannellum's near-white default
  return <div ref={box} className="h-full w-full cursor-grab bg-navy! active:cursor-grabbing" />
}

// Last resort (the photo could not be drawn as a 360 view): the panorama as a wide photo, dragged sideways
function FlatPano({ src, caption }) {
  const strip = useRef(null)
  const drag = useRef(null)

  // start in the middle of the photo
  const center = () => {
    const el = strip.current
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
  }
  const down = (e) => {
    if (e.pointerType !== 'mouse') return // touch scrolls natively
    drag.current = { x: e.clientX, left: strip.current.scrollLeft }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e) => {
    if (drag.current) strip.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x)
  }
  const up = () => { drag.current = null }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={strip}
        tabIndex={0}
        role="region"
        aria-label={`${caption} panorama, scroll sideways to look around`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="min-h-0 flex-1 cursor-grab overflow-x-auto overflow-y-hidden select-none active:cursor-grabbing focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sun"
      >
        <img src={src} alt={`360 panorama of ${caption}`} onLoad={center} draggable={false} className="h-full w-auto max-w-none" />
      </div>
      <p className="px-4 py-2 text-center text-xs text-white/80">
        Showing a flat panorama because this browser couldn't draw the 360 view.
      </p>
    </div>
  )
}
