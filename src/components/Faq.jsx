import { faqs } from '../data/site'

// Native <details>: keyboard and screen-reader friendly with no JS.
export default function Faq() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {faqs.map((f) => (
        <details key={f.q} className="group rounded-2xl border border-navy/10 bg-white p-4 open:shadow-sm">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-3 font-medium focus-visible:outline-2 focus-visible:outline-navy">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wide text-gold-deep">{f.group}</span>
              {f.q}
            </span>
            <span aria-hidden="true" className="mt-1 text-gold transition group-open:rotate-45">+</span>
          </summary>
          <p className="mt-3 text-sm text-slate-600">{f.a}</p>
        </details>
      ))}
    </div>
  )
}
