import { HttpError } from './errors.js'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

// API answers are per user by default; a public route can set its own Cache-Control afterwards.
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cache-Control', 'no-store')
  next()
}

// Cookies mean the browser only talks to us from origins we list (exact match).
export const corsMiddleware = (allowed) => (req, res, next) => {
  const origin = req.headers.origin
  const ok = Boolean(origin) && allowed.includes(origin)
  res.append('Vary', 'Origin')
  if (ok) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  if (req.method === 'OPTIONS') {
    if (ok) {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Access-Control-Max-Age', '600')
    }
    return res.sendStatus(204)
  }
  next()
}

// CSRF defence on top of SameSite cookies: a browser always sends Origin on a cross-site write, so a write from
// an unlisted site is refused. Requests with no Origin (Razorpay's webhook, curl) are not browsers; the webhook
// proves itself with its signature instead.
export const originGuard = (allowed) => (req, res, next) => {
  if (SAFE.has(req.method)) return next()
  const origin = req.headers.origin
  if (origin && !allowed.includes(origin)) return next(new HttpError(403, 'Origin not allowed'))
  next()
}
