// Reads and checks the environment once at start-up, so a missing setting fails the deploy
// with a clear message instead of failing later on a customer's request.
const origins = (v) => (v || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production'
  const allowedOrigins = origins(env.APP_ORIGIN)
  const config = {
    production,
    port: Number(env.PORT) || 3000,
    databaseUrl: env.DATABASE_URL || '',
    databaseSsl: env.DATABASE_SSL === 'true',
    // exact browser origins allowed to call the API with cookies; the Vite dev server by default
    allowedOrigins: allowedOrigins.length || production ? allowedOrigins : ['http://localhost:5174'],
    appUrl: (env.APP_URL || 'http://localhost:5174').replace(/\/+$/, ''),
    jwtSecret: env.JWT_SECRET || '',
    bcryptRounds: Number(env.BCRYPT_ROUNDS) || 10,
  }

  if (production) {
    const problems = []
    if (!config.databaseUrl) problems.push('DATABASE_URL is not set')
    if (config.jwtSecret.length < 32) problems.push('JWT_SECRET must be at least 32 characters')
    if (!config.allowedOrigins.length) problems.push('APP_ORIGIN is not set')
    if (problems.length) throw new Error(`Bad server configuration: ${problems.join('; ')}`)
  }
  return config
}
