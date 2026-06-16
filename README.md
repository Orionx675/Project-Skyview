# Project Zenith — The Celestial Eye

Real-time cosmic radar for **AstralWeb Innovate 2026** (Round 2 build): pick
any coordinate on Earth and watch the ISS, satellites, planets, Sun and Moon
move through that location's sky — live, in 3D.

## Stack

| Concern            | Choice                                              |
| ------------------ | --------------------------------------------------- |
| Framework          | Next.js 15 (App Router) + React 19 + TypeScript     |
| Styling / motion   | Tailwind CSS v4 + framer-motion                     |
| 3D visualization   | CesiumJS — continuous render, per-frame propagation |
| Orbital math       | satellite.js (SGP4) — `utils/orbitalMath.js`        |
| Planetary ephemeris| astronomy-engine (local, no API)                    |
| Telemetry sources  | CelesTrak GP (`/api/tle`) + OpenNotify (`/api/iss`) |

## Quickstart

```bash
npm install
npm run dev        # http://localhost:3000  (webpack dev — NOT --turbopack)
npm run build      # production build (verifies types + Cesium asset copy)
```

> **Do not run `next dev --turbopack`** — Cesium's static-asset copy in
> `next.config.js` runs through the webpack pipeline.

Optional `.env.local`: `NEXT_PUBLIC_CESIUM_ION_TOKEN=` for Ion terrain/imagery
(the app is fully functional without it — CARTO dark basemap).

## Architecture: how 1 Hz live data never stutters the globe

```
            user intent (clicks)                town clock (time)
                    │                                  │
app/page.tsx ───────┤                    lib/tracker.ts (ZenithTracker)
  observer, layers, │                      · slow loop: fetch+compile TLEs
  selection state   │                      · fast loop: 1 Hz snapshot publish
                    ▼                                  │
            <TrackerProvider>──────────────────────────┤
                    │                                  │
   ┌────────────────┼───────────────────┐              │
   │ useSyncExternalStore subscribers   │   imperative subscriber (no React)
   │  HeaderStats / Sidebar / Telemetry │   components/CesiumGlobe.tsx
   │  re-render 1 Hz (tiny subtrees)    │    · entities rebuilt only on
   └────────────────────────────────────┘      catalogVersion change
                                             · positions = CallbackProperty
                                               (SGP4 per rendered frame)
```

- `page.tsx` re-renders **only** on user actions — never on data ticks.
- Telemetry digits glide via framer-motion springs (`AnimatedNumber` writes
  MotionValues straight to DOM text nodes — zero re-renders mid-animation).
- `/api/tle` parses + validates TLEs **server-side** with satellite.js
  (`satrec.error` gate) and enriches them with derived orbital parameters.
- The detail modal predicts the next visible passes (24 h horizon scan) and
  cross-checks our ISS ground track against OpenNotify, time-matched to their
  timestamp.

## File map

```
app/page.tsx                  composition root (user-intent state only)
app/api/tle/route.ts          CelesTrak fetch -> satellite.js parse -> enriched JSON
app/api/iss/route.ts          OpenNotify proxy (independent ISS cross-check)
lib/tracker.ts                ZenithTracker engine (framework-free)
lib/layers.ts                 layer registry + shared types
lib/celestialBodies.ts        astronomy-engine wrappers (sky pos, rise/set, …)
hooks/useTracker.tsx          provider + useSyncExternalStore bindings
utils/orbitalMath.js          SGP4 pipeline, look angles, passes, ground tracks
components/CesiumGlobe.tsx    3D globe (ssr:false), per-frame propagation
components/Sidebar.tsx        observer + animated layer toggles
components/TelemetryPanel.tsx live focus readout (spring digits)
components/ObjectModal.tsx    deep-dive: orbit facts, passes, TLE, cross-check
components/HeaderStats.tsx    live counters (isolated 1 Hz subscriber)
components/ui/                Modal / ToggleSwitch / AnimatedNumber primitives
next.config.js                Cesium asset copy + CESIUM_BASE_URL define
```


