import { memo, useState } from 'react'
import { nearby } from '../data/site'

// Flat animated nearby map: YOLO PG in the centre, dashed routes flowing out to nearby places.
// Places, distances and notes live in src/data/site.js (nearby). Hover/tap a dot to show its card.

const ICONS = {
  metro: 'M7 3h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM5 10h14M8 19l-2 2M16 19l2 2',
  hospital: 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM12 8v8M8 12h8',
  work: 'M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18',
  cart: 'M3 4h2l2.4 10a2 2 0 0 0 2 1.6h7a2 2 0 0 0 2-1.5L20 8H6M10 20h.01M17 20h.01',
  food: 'M5 3v7a2 2 0 0 0 4 0V3M7 3v18M17 3c-2 0-3 2-3 5s1 4 3 4v9',
}

const CENTER = { x: 330, y: 210 }

// One route per place type, so each place keeps its spot whatever order site.js lists them in.
const ROUTES = {
  metro: { x: 155, y: 100, d: 'M330 210 C 290 180, 240 160, 200 175 C 165 188, 175 222, 195 206 C 218 188, 172 140, 155 100' },
  hospital: { x: 520, y: 45, d: 'M330 210 C 370 180, 410 172, 440 160 C 472 148, 462 60, 520 45' },
  food: { x: 470, y: 258, d: 'M330 210 C 380 222, 365 262, 470 258' },
  work: { x: 470, y: 385, d: 'M330 210 C 345 250, 318 298, 345 318 C 380 342, 422 300, 430 345 C 436 372, 450 382, 470 385' },
  cart: { x: 110, y: 300, d: 'M330 210 C 280 232, 262 290, 200 285 C 160 282, 150 300, 110 300' },
}

const CSS = `
.nearby-map{--nm-line:#2D2F5E;--nm-dot:#2D2F5E;--nm-hot:#F2C230;width:100%;height:auto;display:block;overflow:visible}
.nearby-map .nm-route{fill:none;stroke:var(--nm-line);stroke-opacity:.8;stroke-width:2;stroke-linecap:round;stroke-dasharray:5 7;animation:nm-flow 1.2s linear infinite;transition:stroke .3s,stroke-width .3s}
.nearby-map .nm-route.hot{stroke:var(--nm-hot);stroke-opacity:1;stroke-width:3}
.nearby-map .nm-reveal{fill:none;stroke:#fff;stroke-width:12;stroke-dasharray:1;stroke-dashoffset:1;animation:nm-draw 1.4s cubic-bezier(.6,.05,.3,1) forwards}
.nearby-map .nm-dot{fill:var(--nm-dot);transform-box:fill-box;transform-origin:center;transform:scale(0);animation:nm-pop .4s cubic-bezier(.3,1.7,.5,1) forwards;transition:fill .3s}
.nearby-map .nm-dot.hot{fill:var(--nm-hot)}
.nearby-map .nm-ping{fill:none;stroke:var(--nm-dot);stroke-width:1.5;opacity:0;transform-box:fill-box;transform-origin:center;animation:nm-ping 2.4s ease-out infinite}
.nearby-map .nm-ping.hot{stroke:var(--nm-hot)}
.nearby-map .nm-pin{cursor:pointer;outline:none}
.nearby-map .nm-pin:focus-visible .nm-dot{stroke:#2D2F5E;stroke-width:3}
.nearby-map .nm-dot.hot{stroke:#2D2F5E;stroke-width:2}
.nearby-map .nm-label{font-size:14px;font-weight:600;fill:#2D2F5E;opacity:0;animation:nm-fade .4s ease-out forwards}
@keyframes nm-flow{to{stroke-dashoffset:-24}}
@keyframes nm-draw{to{stroke-dashoffset:0}}
@keyframes nm-pop{to{transform:scale(1)}}
@keyframes nm-fade{to{opacity:1}}
@keyframes nm-ping{0%{opacity:.6;transform:scale(1)}100%{opacity:0;transform:scale(2.6)}}
@keyframes nm-card{from{opacity:0;transform:translateY(6px)}}
@media (prefers-reduced-motion:reduce){
  .nearby-map .nm-route,.nearby-map .nm-ping{animation:none}
  .nearby-map .nm-reveal{animation:none;stroke-dashoffset:0}
  .nearby-map .nm-dot{animation:none;transform:none}
  .nearby-map .nm-label{animation:none;opacity:1}
}
`

function NearbyMap() {
  const places = nearby.filter((p) => ROUTES[p.icon])
  const featured = places.findIndex((p) => p.featured)
  const [active, setActive] = useState(featured >= 0 ? featured : 0)
  const current = places[active] ?? places[0]

  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <style>{CSS}</style>

      <svg
        className="nearby-map font-sans"
        viewBox="0 0 600 420"
        role="img"
        aria-label={`Map of places near YOLO PG: ${places.map((p) => `${p.name} (${p.km} km)`).join(', ')}`}
      >
        <defs>
          {places.map((p, i) => (
            <mask key={p.name} id={`nm-m${i}`} maskUnits="userSpaceOnUse" x="0" y="0" width="600" height="420">
              <path className="nm-reveal" pathLength="1" style={{ animationDelay: `${0.2 + i * 0.25}s` }} d={ROUTES[p.icon].d} />
            </mask>
          ))}
        </defs>

        {/* routes: dashed, drawn out from the centre, then flowing to each destination */}
        {places.map((p, i) => (
          <path key={p.name} className={`nm-route${i === active ? ' hot' : ''}`} mask={`url(#nm-m${i})`} d={ROUTES[p.icon].d} />
        ))}

        {/* centre (YOLO PG) */}
        <circle className="nm-ping" cx={CENTER.x} cy={CENTER.y} r="13" />
        <circle className="nm-dot" cx={CENTER.x} cy={CENTER.y} r="13"><title>YOLO PG</title></circle>
        <text x={CENTER.x + 20} y={CENTER.y - 16} className="nm-label">YOLO PG</text>

        {/* destinations: each pops in as its line arrives */}
        {places.map((p, i) => {
          const { x, y } = ROUTES[p.icon]
          const on = i === active
          const t = 1.5 + i * 0.25
          return (
            <g
              key={p.name}
              className="nm-pin"
              role="button"
              tabIndex={0}
              aria-label={`${p.name}, ${p.km} km`}
              aria-pressed={on}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setActive(i)}
            >
              <circle cx={x} cy={y} r="22" fill="transparent" />
              <circle className={`nm-ping${on ? ' hot' : ''}`} cx={x} cy={y} r="8" style={{ animationDelay: `${t + 0.1}s` }} />
              <circle className={`nm-dot${on ? ' hot' : ''}`} cx={x} cy={y} r={on ? 10 : 8} style={{ animationDelay: `${t}s` }}>
                <title>{`${p.name} · ${p.km} km`}</title>
              </circle>
              <text
                x={x}
                y={y < 70 ? y + 30 : y - 18}
                textAnchor="middle"
                className="nm-label"
                style={{ animationDelay: `${t}s` }}
              >
                {p.km} km
              </text>
            </g>
          )
        })}
      </svg>


      {/* Info card for the selected place */}
      {current && (
        <div
          key={current.name}
          aria-live="polite"
          className="relative z-10 mt-3 w-full max-w-xs animate-[nm-card_.35s_ease-out] rounded-2xl border border-navy/10 bg-white p-3.5 shadow-[0_8px_30px_rgba(28,31,74,.08)]"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sun/25">
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                <path d={ICONS[current.icon]} fill="none" stroke="#1C1F4A" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight text-navy">{current.name}</p>
              <p className="text-xs text-slate-500">~{current.km} km from YOLO PG</p>
            </div>
          </div>
          {current.note && <p className="mt-2 text-sm text-slate-600">{current.note}</p>}
        </div>
      )}

    </div>
  )
}

export default memo(NearbyMap)
