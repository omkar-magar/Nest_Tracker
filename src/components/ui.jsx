import { Link } from 'react-router-dom'

const base = 'inline-flex items-center justify-center rounded-full px-5 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-50'
const variants = {
  primary: 'bg-navy text-white hover:bg-navy/90',
  sun: 'bg-sun text-navy shadow-sm hover:brightness-95',
  outline: 'border border-navy/30 text-navy hover:bg-navy/5',
  danger: 'border border-red-300 text-red-700 hover:bg-red-50',
}

export function Button({ variant = 'primary', className = '', to, href, ...rest }) {
  const cls = `${base} ${variants[variant]} ${className}`
  if (to) return <Link to={to} className={cls} {...rest} />
  if (href) return <a href={href} className={cls} {...rest} />
  return <button type="button" className={cls} {...rest} />
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-sm text-slate-600">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-navy/20 border-t-navy" aria-hidden="true" />
      {label}…
    </div>
  )
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null
  return (
    <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-semibold">Something went wrong</p>
      <p className="mt-1">{error.message || String(error)}</p>
      {onRetry && <button onClick={onRetry} className="mt-3 rounded-full border border-red-300 px-4 py-1 font-medium">Try again</button>}
    </div>
  )
}

export function Notice({ tone = 'info', children }) {
  const tones = { info: 'border-navy/10 bg-white text-slate-700', warn: 'border-gold/40 bg-sun/15 text-navy', ok: 'border-green-200 bg-green-50 text-green-900' }
  return <div role="status" className={`rounded-2xl border p-4 text-sm ${tones[tone]}`}>{children}</div>
}

export function Empty({ title, children }) {
  return (
    <div className="rounded-2xl border border-dashed border-navy/20 bg-white/60 p-8 text-center">
      <p className="font-semibold text-navy">{title}</p>
      {children && <p className="mt-1 text-sm text-slate-600">{children}</p>}
    </div>
  )
}

const badgeTones = {
  green: 'bg-green-100 text-green-900',
  amber: 'bg-sun/30 text-navy',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-slate-100 text-slate-700',
  navy: 'bg-navy text-white',
}
export const Badge = ({ tone = 'gray', children }) => (
  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeTones[tone]}`}>{children}</span>
)

export const Card = ({ className = '', ...rest }) => (
  <div className={`rounded-2xl border border-navy/10 bg-white p-5 ${className}`} {...rest} />
)

export const Stat = ({ label, value, hint, tone }) => (
  <Card>
    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`mt-1 text-2xl font-bold ${tone === 'red' ? 'text-red-700' : 'text-navy'}`}>{value}</p>
    {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
  </Card>
)

export const Field = ({ label, children }) => (
  <label className="block text-sm font-medium text-navy">
    {label}
    <div className="mt-1 font-normal">{children}</div>
  </label>
)

export const inputCls = 'w-full rounded-xl border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus-visible:outline-2 focus-visible:outline-navy'

export function Section({ id, title, action, children }) {
  return (
    <section id={id} className="scroll-mt-16 py-14 text-navy">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-2xl font-bold md:text-3xl">{title}</h2>
          {action}
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </section>
  )
}

export function PageHeader({ title, intro }) {
  return (
    <div className="border-b border-navy/10 bg-white/50 text-navy">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-3xl font-bold md:text-4xl">{title}</h1>
        {intro && <p className="mt-2 max-w-2xl text-slate-600">{intro}</p>}
      </div>
    </div>
  )
}

// Simple responsive table: scrolls sideways on narrow screens
export function Table({ head, children, empty }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-navy/10 bg-white">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="border-b border-navy/10 bg-cream text-xs uppercase tracking-wide text-slate-500">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-navy/5">{children}</tbody>
      </table>
      {empty}
    </div>
  )
}
