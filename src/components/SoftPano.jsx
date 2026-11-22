import { useEffect, useRef } from 'react'

// 360 view without WebGL: each frame is projected from the equirectangular photo onto a plain 2D canvas.
// Used when the browser has no working WebGL. Same feel as the Pannellum view: drag, zoom, slow spin.
const MIN_PITCH = -45 // the floor under the camera is distorted
const MAX_PITCH = 60
const MIN_HFOV = 50
const MAX_HFOV = 120
const MAX_RENDER_WIDTH = 1920 // canvas pixels: the view is drawn at the screen's own resolution up to this
const DETAIL = 2 // ...and never at more than this many canvas pixels per photo pixel, which would add no detail
const MIN_RENDER_WIDTH = 480
const MAX_PHOTO_WIDTH = 8192 // larger photos are scaled down on load to keep memory sane
const SLOW_FRAME_MS = 30 // when the sharp frames average slower than this, the resolution steps down
const SETTLE_MS = 150 // after dragging up/down or zooming stops, the view is redrawn sharp
const IDLE_MS = 4000 // the spin starts again this long after the visitor lets go
const SPIN_DEG_PER_S = 2
const RAD = Math.PI / 180

// Where each canvas pixel looks in the photo, for a given pitch and zoom (yaw 0).
// Turning left/right only slides along the photo, so the costly trig runs once per pitch/zoom, not per frame.
export function viewTable(W, H, cw, ch, pitch, hfov) {
  const f = cw / 2 / Math.tan((hfov * RAD) / 2)
  const cp = Math.cos(pitch * RAD), sp = Math.sin(pitch * RAD)
  const ku = W / (2 * Math.PI), kv = H / Math.PI
  const u = new Float32Array(cw * ch), v = new Float32Array(cw * ch)
  let i = 0
  for (let y = 0; y < ch; y++) {
    const vy = ch / 2 - y - 0.5
    const yp = vy * cp + f * sp
    const zp = f * cp - vy * sp
    for (let x = 0; x < cw; x++) {
      const vx = x - cw / 2 + 0.5
      // photo pixel centres sit at +0.5, so shift by half a pixel for the bilinear lookup
      u[i] = (Math.atan2(vx, zp) + Math.PI) * ku - 0.5
      v[i] = (Math.PI / 2 - Math.atan2(yp, Math.sqrt(vx * vx + zp * zp))) * kv - 0.5
      i++
    }
  }
  return { u, v, cw, ch, pitch, hfov }
}

// Fill `out` with the view at `yaw` degrees, blending the four nearest photo pixels (no jagged edges)
export function drawView(src, W, H, table, yaw, out) {
  const { u, v } = table
  const shift = ((((yaw / 360) * W) % W) + W) % W
  for (let i = 0, n = u.length; i < n; i++) {
    let x = u[i] + shift
    if (x >= W) x -= W
    else if (x < 0) x += W
    const x0 = x | 0, fx = x - x0, x1 = x0 + 1 === W ? 0 : x0 + 1
    let y = v[i]
    if (y < 0) y = 0
    else if (y > H - 1) y = H - 1
    const y0 = y | 0, fy = y - y0, r0 = y0 * W, r1 = (y0 + 1 < H ? y0 + 1 : y0) * W
    const a = src[r0 + x0], b = src[r0 + x1], c = src[r1 + x0], d = src[r1 + x1]
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy
    const R = (a & 255) * w00 + (b & 255) * w10 + (c & 255) * w01 + (d & 255) * w11
    const G = ((a >> 8) & 255) * w00 + ((b >> 8) & 255) * w10 + ((c >> 8) & 255) * w01 + ((d >> 8) & 255) * w11
    const B = ((a >> 16) & 255) * w00 + ((b >> 16) & 255) * w10 + ((c >> 16) & 255) * w01 + ((d >> 16) & 255) * w11
    out[i] = 0xff000000 | (((B + 0.5) | 0) << 16) | (((G + 0.5) | 0) << 8) | ((R + 0.5) | 0)
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
    let pano = null, dirty = true, touched = -Infinity, drag = null
    let last = performance.now(), raf = 0, maxWidth = MAX_RENDER_WIDTH, drawn = 0, avg = 0
    let lastPitch = NaN, lastHfov = NaN, changedAt = -Infinity

    const img = new Image()
    img.onload = () => {
      try {
        const s = Math.min(1, MAX_PHOTO_WIDTH / img.naturalWidth)
        const c = document.createElement('canvas')
        c.width = Math.round(img.naturalWidth * s)
        c.height = Math.round(img.naturalHeight * s)
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0, c.width, c.height)
        const d = g.getImageData(0, 0, c.width, c.height)
        pano = { px: new Uint32Array(d.data.buffer), W: c.width, H: c.height }
        size()
      } catch (err) {
        fail.current(err)
      }
    }
    img.onerror = () => fail.current('360 photo did not load')
    img.src = src

    // 'full': the screen's own resolution (sharp). 'low': half that, only while dragging up/down or zooming.
    const sizes = {}, frames = {}, tables = {}
    let shown = null
    const size = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || !h) return
      const photoPx = pano ? (view.hfov / 360) * pano.W * DETAIL : Infinity
      const s = Math.min(window.devicePixelRatio || 1, 2, maxWidth / w, photoPx / w)
      const fw = Math.max(1, Math.round(w * s)), fh = Math.max(1, Math.round(h * s))
      sizes.full = [fw, fh]
      sizes.low = [Math.max(1, fw >> 1), Math.max(1, fh >> 1)]
      tables.full = tables.low = null
      shown = null
      dirty = true
    }
    size()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(size)
    ro?.observe(el)

    // draws one frame at quality q; returns true when the pitch/zoom table had to be rebuilt
    const draw = (q) => {
      const [w, h] = sizes[q]
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
      let fr = frames[q]
      if (!fr || fr.img.width !== w || fr.img.height !== h) {
        const im = ctx.createImageData(w, h)
        fr = frames[q] = { img: im, px: new Uint32Array(im.data.buffer) }
      }
      let t = tables[q], rebuilt = false
      if (!t || t.cw !== w || t.ch !== h || t.pitch !== view.pitch || t.hfov !== view.hfov) {
        t = tables[q] = viewTable(pano.W, pano.H, w, h, view.pitch, view.hfov)
        rebuilt = true
      }
      drawView(pano.px, pano.W, pano.H, t, view.yaw, fr.px)
      ctx.putImageData(fr.img, 0, 0)
      shown = q
      return rebuilt
    }

    const nextFrame = window.requestAnimationFrame?.bind(window) ?? ((fn) => setTimeout(() => fn(performance.now()), 16))
    const cancelFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (pano && sizes.full) {
        if (!drag && !reduceMotion && now - touched > IDLE_MS) { view.yaw -= SPIN_DEG_PER_S * dt; dirty = true }
        view.pitch = clampPitch(view.pitch, view.hfov, sizes.full[0] / sizes.full[1])
        if (view.pitch !== lastPitch || view.hfov !== lastHfov) {
          if (shown) changedAt = now
          if (view.hfov !== lastHfov) size()
          lastPitch = view.pitch
          lastHfov = view.hfov
          dirty = true
        }
        const q = now - changedAt < SETTLE_MS ? 'low' : 'full'
        if (q !== shown) dirty = true
        if (dirty) {
          const t0 = performance.now()
          const rebuilt = draw(q)
          dirty = false
          // sharp frames on a slow machine: step the resolution down (ignore the first, JIT warm-up frames)
          if (q === 'full' && !rebuilt) {
            drawn++
            avg = avg * 0.8 + (performance.now() - t0) * 0.2
            if (drawn > 8 && avg > SLOW_FRAME_MS && sizes.full[0] > MIN_RENDER_WIDTH) {
              // cost grows with the pixel count, so aim straight for a width that meets the budget
              maxWidth = Math.max(MIN_RENDER_WIDTH, Math.round(sizes.full[0] * Math.sqrt(SLOW_FRAME_MS / avg) * 0.9))
              drawn = 0
              avg = 0
              size()
            }
          }
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
