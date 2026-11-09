// @vitest-environment node
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../server/app.js'
import { loadConfig } from '../../server/config.js'
import { HttpError } from '../../server/errors.js'

const SITE = 'https://yolo-nest.onrender.com'
const config = loadConfig({ APP_ORIGIN: `${SITE}/, http://localhost:5174` })

const pgError = (code, message = 'db said no') => Object.assign(new Error(message), { code })
const fakePool = (query = async () => ({ rows: [] })) => ({ query })

// a route per error kind, so every mapping is checked through real HTTP
function boom(app) {
  app.get('/api/t/pg/:code', (req, res, next) => next(pgError(req.params.code, req.query.m)))
  app.get('/api/t/http', (req, res, next) => next(new HttpError(418, 'teapot')))
  app.get('/api/t/crash', () => { throw new Error('secret internals: password=hunter2') })
  app.post('/api/t/write', (req, res) => res.json({ got: req.body }))
}
const build = (pool = fakePool()) => createApp({ config, pool, extra: boom })

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('config', () => {
  it('has safe development defaults', () => {
    const c = loadConfig({})
    expect(c.production).toBe(false)
    expect(c.allowedOrigins).toEqual(['http://localhost:5174'])
    expect(c.port).toBe(3000)
  })
  it('splits APP_ORIGIN and drops trailing slashes', () => {
    expect(config.allowedOrigins).toEqual([SITE, 'http://localhost:5174'])
  })
  it('refuses to start in production with missing settings, and says which', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL.*JWT_SECRET.*APP_ORIGIN/)
  })
  it('rejects a short JWT secret in production', () => {
    const env = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', APP_ORIGIN: SITE, JWT_SECRET: 'short' }
    expect(() => loadConfig(env)).toThrow(/JWT_SECRET/)
    expect(loadConfig({ ...env, JWT_SECRET: 'x'.repeat(32) }).production).toBe(true)
  })
})

describe('health', () => {
  it('/api/health is up without touching the database', async () => {
    const query = vi.fn()
    const res = await request(build(fakePool(query))).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(query).not.toHaveBeenCalled()
  })
  it('/api/health/db checks the database', async () => {
    const query = vi.fn(async () => ({ rows: [{ '?column?': 1 }] }))
    const res = await request(build(fakePool(query))).get('/api/health/db')
    expect(res.status).toBe(200)
    expect(query).toHaveBeenCalledWith('select 1')
  })
  it('/api/health/db answers 503 when the database is down, without leaking why', async () => {
    const res = await request(build(fakePool(async () => { throw new Error('ECONNREFUSED 10.0.0.5:5432') }))).get('/api/health/db')
    expect(res.status).toBe(503)
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5')
  })
})

describe('basics', () => {
  it('does not advertise Express and sends safe headers', async () => {
    const res = await request(build()).get('/api/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toBe('no-store')
  })
  it('unknown routes are a JSON 404', async () => {
    const res = await request(build()).get('/api/nope')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not found' })
  })
})

describe('CORS', () => {
  it('allows a listed origin, with credentials', async () => {
    const res = await request(build()).get('/api/health').set('Origin', SITE)
    expect(res.headers['access-control-allow-origin']).toBe(SITE)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(res.headers.vary).toMatch(/Origin/)
  })
  it('gives an unlisted origin nothing, so the browser blocks it', async () => {
    const res = await request(build()).get('/api/health').set('Origin', 'https://evil.example')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(res.headers['access-control-allow-credentials']).toBeUndefined()
  })
  it('answers preflight for a listed origin', async () => {
    const res = await request(build()).options('/api/t/write').set('Origin', SITE).set('Access-Control-Request-Method', 'POST')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-methods']).toMatch(/POST/)
  })
  it('answers preflight for an unlisted origin without permission headers', async () => {
    const res = await request(build()).options('/api/t/write').set('Origin', 'https://evil.example')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-methods']).toBeUndefined()
  })
})

describe('origin guard (CSRF)', () => {
  it('refuses a write from an unlisted origin', async () => {
    const res = await request(build()).post('/api/t/write').set('Origin', 'https://evil.example').send({ a: 1 })
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Origin not allowed' })
  })
  it('allows a write from a listed origin', async () => {
    const res = await request(build()).post('/api/t/write').set('Origin', SITE).send({ a: 1 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ got: { a: 1 } })
  })
  it('allows a write with no Origin (server-to-server, e.g. the Razorpay webhook)', async () => {
    const res = await request(build()).post('/api/t/write').send({ a: 1 })
    expect(res.status).toBe(200)
  })
  it('never blocks reads, whatever the origin', async () => {
    const res = await request(build()).get('/api/health').set('Origin', 'https://evil.example')
    expect(res.status).toBe(200)
  })
})

describe('error mapping', () => {
  const get = (path) => request(build()).get(path)

  it('shows a rule raised by our SQL functions (P0001) as a 400', async () => {
    const res = await get('/api/t/pg/P0001?m=Only 2 bed(s) left in this room')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Only 2 bed(s) left in this room' })
  })
  it('keeps our own permission messages (42501) as a 403', async () => {
    const res = await get('/api/t/pg/42501?m=Admins only')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Admins only')
  })
  it('hides the wording of raw row-level-security and grant failures', async () => {
    for (const m of ['new row violates row-level security policy for table "reviews"', 'permission denied for table payments']) {
      const res = await get(`/api/t/pg/42501?m=${encodeURIComponent(m)}`)
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('Not allowed')
    }
  })
  it.each([
    ['23505', 409], ['23503', 409], ['40001', 409], ['40P01', 409],
    ['23514', 400], ['22P02', 400], ['22007', 400],
  ])('maps SQLSTATE %s to %i without showing database text', async (code, status) => {
    const res = await get(`/api/t/pg/${code}?m=duplicate key value violates unique constraint "bills_pkey"`)
    expect(res.status).toBe(status)
    expect(res.body.error).not.toMatch(/constraint|bills_pkey/)
  })
  it('turns unknown errors into a generic 500 and logs the real one', async () => {
    const res = await get('/api/t/crash')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Something went wrong' })
    expect(console.error).toHaveBeenCalled()
  })
  it('uses the status of an HttpError', async () => {
    const res = await get('/api/t/http')
    expect(res.status).toBe(418)
    expect(res.body).toEqual({ error: 'teapot' })
  })
  it('answers malformed JSON with a 400, not a 500', async () => {
    const res = await request(build()).post('/api/t/write').set('Content-Type', 'application/json').send('{"broken')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid JSON' })
  })
  it('refuses oversized bodies', async () => {
    const res = await request(build()).post('/api/t/write').send({ blob: 'x'.repeat(200_000) })
    expect(res.status).toBe(413)
  })
})
