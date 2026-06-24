# Project SkyView — The Celestial Eye

A real-time cosmic radar and planetarium. Pick any point on Earth and watch the
ISS, satellites, the planets, the Sun and the Moon move through that location's
sky — live, in 3D — then plan the exact camera shot of any of them.

Built for **AstralWeb Innovate 2026** · Live at **https://project-skyview.vercel.app**

## What it does

- **Real-time tracking** — the ISS, crewed stations, the brightest satellites, a
  Starlink sample and the GPS constellation, propagated with SGP4 on every frame.
- **The whole sky** — the Sun, Moon and planets placed from a local ephemeris.
- **Observe from anywhere** — GPS, typed coordinates, or a click on the globe.
- **Search + target-lock** — fuzzy-search any object; the camera locks on and
  follows its orbit, glowing trail and all.
- **Object inspector** — orbital parameters, the next visible passes over your
  location, the raw TLE, and a live ISS cross-check against an independent feed.
- **Eyes of the Orbit** — NASA's live view of Earth from the ISS in a draggable
  window, with orbital-night detection for when the station is in Earth's shadow.
- **Clear Sky planner** — weather-aware "golden windows" for bright passes.
- **Astrophotography FOV planner** — works out when a target crosses your frame.
- **Cosmic Time Machine** — scrub time and watch the whole sky re-plot.
- **Space Weather & Aurora** — live NOAA Kp index, storm alerts and procedural
  auroral-oval rings drawn on the globe.
- **Night Vision** — one tap shifts the whole UI to deep red for the eyepiece.
- **Built for every screen** — a full desktop dashboard and a separate
  touch-first mobile experience, plus a cinematic `/about` landing page.

## Tech stack

| Concern          | Choice                                            |
| ---------------- | ------------------------------------------------- |
| Framework        | Next.js 15 (App Router) · React 19 · TypeScript   |
| Styling / motion | Tailwind CSS v4 · Framer Motion                   |
| 3D globe         | CesiumJS (loaded from CDN, continuous render)     |
| Orbital math     | satellite.js (SGP4)                               |
| Ephemeris        | astronomy-engine (local, no API)                  |
| Icons            | Lucide                                            |
| Data             | CelesTrak · NASA · NOAA SWPC · Open-Meteo · Esri  |

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run start    # serve the production build
```

No API keys are required — the app runs fully on public, token-free data
sources, and CesiumJS is loaded at runtime from a CDN (no asset-copy step).
Optional `.env.local` extras: `NEXT_PUBLIC_CESIUM_ION_TOKEN` (3D terrain),
`NEXT_PUBLIC_ARCGIS_TOKEN` (imagery rate limits) and `NEXT_PUBLIC_ISS_STREAM_ID`
(override the live ISS feed). See `.env.example`.

## Architecture

The hard problem is updating live data every second without re-rendering the
page or stuttering the 3D globe. The solution keeps the real-time engine
completely outside React:

- **`lib/tracker.ts`** — a framework-free `ZenithTracker` engine. A slow loop
  fetches and compiles orbital elements; a fast loop propagates everything to
  "now" at 1 Hz.
- **Small UI leaves** (telemetry, header counters) subscribe via
  `useSyncExternalStore` and re-render at 1 Hz; the page itself never subscribes.
- **The Cesium globe never re-renders from data** — it reads the engine
  imperatively and expresses each satellite's position as a per-frame
  `CallbackProperty`, so objects glide at 60 fps while React sleeps.
- **Server routes** (`app/api/*`) proxy and cache every external source, which
  keeps the client fast, normalises the data and protects coordinates.

### Project map

```
app/page.tsx               composition root (user-intent state + TrackerProvider)
app/about/page.tsx         cinematic scroll-driven landing page
app/api/                   tle · iss · weather · space-weather routes
lib/tracker.ts             ZenithTracker engine (framework-free)
lib/viewerBridge.ts        shared handle to the live Cesium viewer
lib/{layers,fovMath,eclipse,auroraOval,clearSky}.ts   feature math
hooks/useTracker.tsx       React bindings (useSyncExternalStore)
utils/orbitalMath.js       SGP4 pipeline — look angles, passes, ground tracks
components/CesiumGlobe.tsx  3D globe — per-frame propagation, target-lock
components/DesktopView.tsx  · MobileView.tsx   responsive shells
components/...              telemetry, inspector, planners, live feed, aurora
```
