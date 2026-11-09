import express from 'express'
import { errorHandler, notFound } from './errors.js'
import { corsMiddleware, originGuard, securityHeaders } from './middleware.js'

// Builds the Express app. Taking the config and pool as arguments (instead of reading them from the
// environment) is what lets the tests run it with no database. `extra(app)` is for tests to add routes.
export function createApp({ config, pool, extra }) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1) // Render's load balancer is one hop in front of us

  app.use(securityHeaders)
  app.use(corsMiddleware(config.allowedOrigins))
  app.use(originGuard(config.allowedOrigins))
  app.use(express.json({ limit: '100kb' }))

  // Render's health check: only "the process is up", so a database hiccup does not restart the service.
  app.get('/api/health', (req, res) => res.json({ ok: true }))
  app.get('/api/health/db', async (req, res) => {
    try {
      await pool.query('select 1')
      res.json({ ok: true })
    } catch (err) {
      console.error('database check failed', err.message)
      res.status(503).json({ ok: false, error: 'Database unavailable' })
    }
  })

  extra?.(app)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
