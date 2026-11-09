// Starts the API. Render runs `node server/index.js`.
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { createPool } from './db.js'

const config = loadConfig()
if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set (see server/.env.example)')
  process.exit(1)
}

const pool = createPool(config)
const server = createApp({ config, pool }).listen(config.port, () => {
  console.log(`API listening on :${config.port} (${config.production ? 'production' : 'development'})`)
})

// Render sends SIGTERM on every deploy: stop taking requests, let running ones finish, then close the database.
function shutdown(signal) {
  console.log(`${signal} received, shutting down`)
  server.close(() => pool.end().finally(() => process.exit(0)))
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
