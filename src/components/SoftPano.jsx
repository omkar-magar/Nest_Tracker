import { useEffect, useRef } from 'react'

// 360 view without WebGL: each frame is projected from the equirectangular photo onto a plain 2D canvas.
// Used when the browser has no working WebGL. Same feel as the Pannellum view: drag, zoom, slow spin.
const MIN_PITCH = -45 // the floor under the camera is distorted
const MAX_PITCH = 60
const MIN_HFOV = 50
const MAX_HFOV = 120
const MAX_RENDER_WIDTH = 720 // drawn at most this wide and scaled up
const MIN_RENDER_WIDTH = 320
const SLOW_FRAME_MS = 35 // a frame slower than this lowers the drawing width, so slow machines stay smooth
const IDLE_MS = 4000 // the spin starts again this long after the visitor lets go
const SPIN_DEG_PER_S = 2
const RAD = Math.PI / 180

// Fill `out` (cw x ch pixels) with the view at yaw/pitch/hfov (degrees) taken from `src` (W x H, 2:1)
export function project(src, W, H, out, cw, ch, { yaw, pitch, hfov }) {
  const f = cw / 2 / Math.tan((hfov * RAD) / 2)
  const cy = Math.cos(yaw * RAD), sy = Math.sin(yaw * RAD)
  const cp = Math.cos(pitch * RAD), sp = Math.sin(pitch * RAD)
  const ku = W / (2 * Math.PI), kv = H / Math.PI
  let i = 0
  for (let y = 0; y < ch; y++) {
    const vy = ch / 2 - y - 0.5
    const yp = vy * cp + f * sp
    const zp = f * cp - vy * sp
    for (let x = 0; x < cw; x++) {
      const vx = x - cw / 2 + 0.5
      const x2 = vx * cy + zp * sy
      const z2 = zp * cy - vx * sy
      let u = Math.floor((Math.atan2(x2, z2) + Math.PI) * ku)
      let v = Math.floor((Math.PI / 2 - Math.atan2(yp, Math.sqrt(x2 * x2 + z2 * z2))) * kv)
      if (u >= W) u = W - 1
      if (v >= H) v = H - 1
      out[i++] = src[v * W + u]
    }
  }
}

// keep the top and bottom edges of the view inside MIN_PITCH..MAX_PITCH
export function clampPitch(pitch, hfov, aspect) {
  const half = Math.atan(Math.tan((hfov * RAD) / 2) / aspect) / RAD
  const lo = MIN_PITCH + half, hi = MAX_PITCH - half
  return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, pitch))
}

export default function SoftPano({ src, caption, onFail }) {
  const box = useRef(null)
  const canvas = useRef(null)
  const api = useRef({ zoom: () => {} })
  const fail = useRef(onFail)
  fail.current = onFail

  useEffect(() => {
    const el = box.current, cv = canvas.current
    const ctx = cv.getContext('2d')
    if (!ctx) { fail.current('no 2D canvas'); return }

    const view = { yaw: 0, pitch: -5, hfov: 100 }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let pano = null, frame = null, out = null, dirty = true, touched = -Infinity, drag = null
    let last = performance.now(), raf = 0, maxWidth = MAX_RENDER_WIDTH, drawn = 0, avg = 0

    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height)
        pano = { px: new Uint32Array(d.data.buffer), W: c.width, H: c.height }
        dirty = true
      } catch (err) {
        fail.current(err)
      }
    }
    img.onerror = () => fail.current('360 photo did not load')
    img.src = src

    const size = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || !h) return
      const s = Math.min(1, maxWidth / w)
      cv.width = Math.max(1, Math.round(w * s))
      cv.height = Math.max(1, Math.round(h * s))
      frame = ctx.createImageData(cv.width, cv.height)
      out = new Uint32Array(frame.data.buffer)
      dirty = true
    }
    size()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(size)
    ro?.observe(el)

    const nextFrame = window.requestAnimationFrame?.bind(window) ?? ((fn) => setTimeout(() => fn(performance.now()), 16))
    const cancelFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (pano && !drag && !reduceMotion && now - touched > IDLE_MS) { view.yaw -= SPIN_DEG_PER_S * dt; dirty = true }
      if (dirty && pano && out) {
        const t0 = performance.now()
        view.pitch = clampPitch(view.pitch, view.hfov, cv.width / cv.height)
        project(pano.px, pano.W, pano.H, out, cv.width, cv.height, view)
        ctx.putImageData(frame, 0, 0)
        dirty = false
        // running average, ignoring the first frames while the JS engine warms up
        drawn++
        avg = avg * 0.8 + (performance.now() - t0) * 0.2
        if (drawn > 8 && avg > SLOW_FRAME_MS && cv.width > MIN_RENDER_WIDTH) {
          maxWidth = Math.max(MIN_RENDER_WIDTH, Math.round(cv.width * 0.8))
          drawn = 0
          avg = 0
          size()
        }
      }
      raf = nextFrame(tick)
    }
    raf = nextFrame(tick)

    const touch = () => { touched = performance.now(); dirty = true }
    const zoom = (factor) => { view.hfov = Math.min(MAX_HFOV, Math.max(MIN_HFOV, view.hfov * factor)); touch() }
    api.current.zoom = zoom

    // drag the picture: moving the pointer right turns the view left, like grabbing the scene
    const down = (e) => {
      if (e.button > 0) return
      drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch }
      el.setPointerCapture?.(e.pointerId)
      touch()
    }
    const move = (e) => {
      if (!drag) return
      const deg = view.hfov / (el.clientWidth || 1)
      view.yaw = drag.yaw - (e.clientX - drag.x) * deg
      view.pitch = drag.pitch + (e.clientY - drag.y) * deg
      touch()
    }
    const up = () => { drag = null; touch() }
    const wheel = (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1) }
    const key = (e) => {
      const turn = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key]
      if (turn) { e.preventDefault(); view.yaw += turn[0]; view.pitch += turn[1]; touch() }
      else if (e.key === '+' || e.key === '=') zoom(1 / 1.1)
      else if (e.key === '-') zoom(1.1)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('keydown', key)
    return () => {
      cancelFrame(raf)
      ro?.disconnect()
      img.onload = img.onerror = null
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('keydown', key)
    }
  }, [src])

  const btn = 'flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-lg font-bold text-navy shadow-sm transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun'
  return (
    <div className="relative h-full w-full bg-navy">
      <div
        ref={box}
        tabIndex={0}
        role="application"
        aria-label={`360 view of ${caption}. Drag or use the arrow keys to look around, plus and minus to zoom.`}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sun"
      >
        <canvas ref={canvas} className="block h-full w-full" />
      </div>
      <div className="absolute left-3 top-3 flex flex-col gap-2">
        <button type="button" aria-label="Zoom in" onClick={() => api.current.zoom(1 / 1.2)} className={btn}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => api.current.zoom(1.2)} className={btn}>−</button>
      </div>
    </div>
  )
}
