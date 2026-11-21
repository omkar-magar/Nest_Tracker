import { useState } from 'react'

// Small SVG charts for the dashboard and reports. One y-axis, thin bars with rounded tops, recessive grid,
// a legend for 2+ series, a hover tooltip on every bar / point, and the numbers always in a table next to them.
// Series colours come from the theme (chart-1..3, validated for colour-blind separation) in this fixed order.
const SERIES = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)']
const fmt = (n) => (Math.abs(n) >= 100000 ? `${(n / 100000).toFixed(1)}L` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)))

function niceMax(v) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / p) * p
}

function Legend({ series }) {
  if (series.length < 2) return null
  return (
    <ul className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i] }} />{s.label}
        </li>
      ))}
    </ul>
  )
}

// data: [{ label, ...values }], series: [{ key, label }]
export function BarChart({ data, series, title, height = 220, money = true, action }) {
  const [hover, setHover] = useState(null)
  const W = 640; const H = height; const pad = { l: 44, r: 8, t: 10, b: 28 }
  const all = data.flatMap((d) => series.map((s) => Number(d[s.key] || 0)))
  const max = niceMax(Math.max(0, ...all)); const min = Math.min(0, ...all)
  const span = max - min || 1
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - min) / span)
  const groupW = (W - pad.l - pad.r) / Math.max(data.length, 1)
  const barW = Math.max(3, Math.min(28, (groupW - 6) / series.length - 2))
  return (
    <figure className="rounded-2xl border border-navy/10 bg-white p-4">
      <figcaption className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">{title}{action}</figcaption>
      <Legend series={series} />
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title} chart. The same numbers are in the table below.`}>
          {[0, 0.5, 1].map((t) => {
            const v = min + span * t
            return (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-navy/10" />
                <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fill-slate-500 text-[10px]">{fmt(v)}</text>
              </g>
            )
          })}
          {data.map((d, i) => {
            const x0 = pad.l + i * groupW + (groupW - series.length * (barW + 2)) / 2
            return (
              <g key={d.label}>
                {series.map((s, j) => {
                  const v = Number(d[s.key] || 0)
                  const top = Math.min(y(v), y(0)); const h = Math.max(Math.abs(y(v) - y(0)), v ? 1 : 0)
                  return <rect key={s.key} x={x0 + j * (barW + 2)} y={top} width={barW} height={h} rx={Math.min(4, barW / 2)} fill={SERIES[j]} />
                })}
                {/* hit area bigger than the bars */}
                <rect x={pad.l + i * groupW} y={pad.t} width={groupW} height={H - pad.t - pad.b} fill="transparent"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
                {(data.length <= 14 || i % 2 === 0) && (
                  <text x={pad.l + i * groupW + groupW / 2} y={H - 10} textAnchor="middle" className="fill-slate-500 text-[10px]">{d.label}</text>
                )}
              </g>
            )
          })}
        </svg>
        {hover !== null && (
          <div role="status" className="pointer-events-none absolute top-2 rounded-xl border border-navy/10 bg-white px-3 py-2 text-xs shadow"
            style={{ left: `${Math.min(70, ((hover + 0.5) / data.length) * 100)}%` }}>
            <p className="font-semibold">{data[hover].label}</p>
            {series.map((s, j) => (
              <p key={s.key} className="flex items-center gap-1.5 text-slate-700">
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ background: SERIES[j] }} />
                {s.label}: {money ? '₹' : ''}{Number(data[hover][s.key] || 0).toLocaleString('en-IN')}
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}

// Horizontal bars for one measure across categories (e.g. expense by category), sorted largest first
export function HBarChart({ data, title, money = true }) {
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const max = Math.max(1, ...sorted.map((d) => d.value))
  return (
    <figure className="rounded-2xl border border-navy/10 bg-white p-4">
      <figcaption className="mb-3 text-sm font-semibold">{title}</figcaption>
      {sorted.length === 0 ? <p className="text-sm text-slate-500">No data for this period.</p> : (
        <ul className="space-y-2">
          {sorted.map((d) => (
            <li key={d.label} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2 text-xs" title={`${d.label}: ${d.value}`}>
              <span className="truncate text-slate-700">{d.label}</span>
              <span className="h-3 rounded-r" style={{ width: `${(d.value / max) * 100}%`, background: SERIES[0] }} />
              <span className="font-medium text-navy">{money ? '₹' : ''}{Number(d.value).toLocaleString('en-IN')}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}

// Funnel: each stage as a bar with count and % of the first stage
export function Funnel({ stages, title }) {
  const first = stages[0]?.value || 0
  return (
    <figure className="rounded-2xl border border-navy/10 bg-white p-4">
      <figcaption className="mb-3 text-sm font-semibold">{title}</figcaption>
      <ol className="space-y-2">
        {stages.map((s) => (
          <li key={s.label} className="grid grid-cols-[7rem_1fr_6rem] items-center gap-2 text-xs">
            <span className="text-slate-700">{s.label}</span>
            <span className="h-4 rounded-r" style={{ width: `${first ? (s.value / first) * 100 : 0}%`, minWidth: s.value ? 4 : 0, background: SERIES[0] }} />
            <span className="font-medium text-navy">{s.value}{first ? ` · ${Math.round((s.value / first) * 100)}%` : ''}</span>
          </li>
        ))}
      </ol>
    </figure>
  )
}
