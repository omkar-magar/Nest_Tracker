// One place that turns any error into a { error: message } response, the same shape the
// old Supabase Edge Functions used, so the frontend keeps reading `.error`.
export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// What a Postgres error means to a visitor. Our SQL functions use `raise exception` for rules
// ("Only 2 bed(s) left in this room"), which arrive as P0001 and are safe to show.
function describe(err) {
  if (err instanceof HttpError) return { status: err.status, message: err.message }
  if (err.type === 'entity.parse.failed') return { status: 400, message: 'Invalid JSON' }
  if (err.type === 'entity.too.large') return { status: 413, message: 'Request is too large' }

  switch (err.code) {
    case '42501': // insufficient_privilege: our own messages ("Admins only") or a raw RLS / grant failure
      return { status: 403, message: /row-level security|permission denied/i.test(err.message) ? 'Not allowed' : err.message }
    case 'P0001':
      return { status: 400, message: err.message }
    case '23505':
      return { status: 409, message: 'That already exists' }
    case '23503':
      return { status: 409, message: 'This is linked to other records' }
    case '23514': case '22P02': case '22007': case '22008': case '22003':
      return { status: 400, message: 'Invalid value' }
    case '40001': case '40P01': // serialization failure / deadlock: retrying works
      return { status: 409, message: 'Please try again' }
    default:
      return { status: 500, message: 'Something went wrong' }
  }
}

export const notFound = (req, res, next) => next(new HttpError(404, 'Not found'))

// eslint-disable-next-line no-unused-vars -- Express recognises an error handler by its four arguments
export function errorHandler(err, req, res, next) {
  const { status, message } = describe(err)
  if (status >= 500) console.error(`${req.method} ${req.originalUrl}`, err)
  res.status(status).json({ error: message })
}
