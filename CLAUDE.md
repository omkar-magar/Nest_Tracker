# CLAUDE.md

YOLO Nest Co-Living: the public marketing website for one PG in Hinjewadi Phase 1, Pune (monthly/daily PG beds, 1BHK flat, lodge rooms, Airbnb-style stay). Plain React 18 (JSX, no TypeScript) + Vite 6 + Tailwind v4 + react-router-dom. Supabase backend (see docs/setup.md): public site, customer/staff/admin dashboards, demo payments, three PWAs. Without Supabase env vars the public pages fall back to static content in `src/data/site.js`.

This repo used to hold the Nest_Tracker stay-management app (FastAPI backend + TS frontend). That code was removed; it lives in git history and in the stash `pre-yolo-nest: uncommitted Nest_Tracker work`. Don't bring any of it back unless the developer asks.

## Where things are
| Path | Role |
|---|---|
| `src/data/site.js` | **all editable content**: `brand` (name, tagline, phone, address, map query), `heroImages`, `amenities`, `categories`, `rooms`, `nearby` |
| `src/App.jsx` | routes (public, `/account`, `/staff`, `/admin`), layouts; pages in `src/pages/` |
| `src/components/Navbar.jsx` | sticky header; links scroll to section ids |
| `src/components/Hero.jsx` | hero heading, expanding amenity panels, `NearbyMap` |
| `src/components/NearbyMap.jsx` | animated SVG map; routes keyed by place `icon`, CSS inlined in the file |
| `src/components/Img.jsx` | lazy `<img>` with fallback: given src, then same name as `.jpg`, then a gradient placeholder |
| `src/index.css` | Tailwind import + brand colours in `@theme` |
| `public/images/` | `hero/`, `background/`, `rooms/<room-id>.webp`, `categories/<id>.jpg` (empty), `360/<room-id>.jpg` (empty, for `@photo-sphere-viewer/core`), `logo.png` |

## Commands
```bash
npm install
npm run dev       # http://localhost:5174
npm run build     # outputs dist/
npm run preview
```
No linter, formatter or tests are set up; don't add them unless asked. This machine has little free RAM: don't set a large `NODE_OPTIONS` heap.

## Conventions
- Content changes go in `src/data/site.js`, not in components. Keep the comments there that tell the client where image files go.
- Colours: use the theme names only: `navy`, `gold`, `sun`, `gold-deep`, `cream` (plus Tailwind `slate-*` for muted text). Change a brand colour in `@theme`, never with hex in a component. Exception: `NearbyMap`'s inline CSS.
- Font is Poppins (loaded in `index.html`), set as `font-sans`.
- Images: prefer `.webp`; use `Img` for content photos so missing files degrade gracefully. Room photos are named after the room `id`.
- Styling: Tailwind utility classes inline, rounded-2xl cards with `border-navy/10`, pill buttons (`rounded-full`). Container is `mx-auto max-w-6xl px-4`.
- Code style: function components, 2-space indent, single quotes, no semicolons, short comments only where something is non-obvious.
- Every section needs an `id` matching the Navbar link and `scroll-mt-16` so it clears the sticky header.
- Must work at 390px width, keep visible focus (`focus-visible`), meaningful `alt` text, and 4.5:1 text contrast.
- Business logic lives in `src/services/` and in `supabase/migrations/` (RLS + RPCs); keep components thin. Payments go through `src/services/payments` only; see docs/payments.md.
- Prices in `rooms` are demo values and `nearby` distances are `'x'` placeholders: don't invent real ones; ask the developer.

## Commits
- Author is the repo-local git user (`git config --local user.name`). **Never** add Claude as author or co-author, and no `Co-Authored-By` or "Generated with" lines.
- Small, focused commits with short plain messages, e.g. `add rooms gallery`, `fix navbar on mobile`.
- Never commit `node_modules/`, `dist/` or `.env` files.
- Commit only when the developer asks.
