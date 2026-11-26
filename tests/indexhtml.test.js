import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

// iOS Safari takes the manifest (and so the home-screen start page) from the first page load,
// so index.html must pick it before React runs.
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
const script = html.match(/<script id="pwa-identity">([\s\S]*?)<\/script>/)[1]

const run = (path) => {
  window.history.replaceState(null, '', path)
  new Function(script)()
}
const attr = (sel, a) => document.head.querySelector(sel)?.getAttribute(a)

describe('index.html PWA identity', () => {
  beforeEach(() => { document.head.innerHTML = '' })

  it.each([
    ['/admin/login', '/manifest-admin.webmanifest', 'YOLO Admin'],
    ['/admin', '/manifest-admin.webmanifest', 'YOLO Admin'],
    ['/staff/login', '/manifest-staff.webmanifest', 'YOLO Staff'],
    ['/staff/manager', '/manifest-manager.webmanifest', 'YOLO Manager'],
    ['/', '/manifest.webmanifest', 'YOLO Nest'],
    ['/location', '/manifest.webmanifest', 'YOLO Nest'],
  ])('%s gets %s', (path, manifest, title) => {
    run(path)
    expect(attr('link[rel="manifest"]', 'href')).toBe(manifest)
    expect(attr('meta[name="apple-mobile-web-app-title"]', 'content')).toBe(title)
    expect(document.head.querySelectorAll('link[rel="manifest"]')).toHaveLength(1)
  })

  it('has no static manifest link that Safari could read instead', () => {
    expect(html.replace(script, '')).not.toMatch(/rel="manifest"/)
  })
})
