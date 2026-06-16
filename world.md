# 🌌 Project Zenith — The Celestial Eye

> A real-time cosmic radar. Pick any point on Earth and watch the ISS,
> satellites, planets, the Sun and the Moon move through that location's sky —
> live, in 3D — then plan the exact camera shot of any of them.

Built for **AstralWeb Innovate 2026** (online hackathon, 10–30 June 2026).
Round 1 (the Logic & Design Blueprint) passed; this is the full Round 2 build.

---

## 1. What it is

Project Zenith answers a deceptively simple question: **"What is in the sky
above this spot, right now — and where exactly will it go?"**

It blends scientific rigor with a mission-control interface:

- A **3D globe** (CesiumJS) showing live satellite positions propagated from
  real orbital data, the day/night terminator, and your chosen observer point.
- A **telemetry HUD** that reads out the altitude, azimuth, range and
  zenith-offset of whatever is most overhead — updating every second.
- A **search + target-lock** system to find any tracked object and have the
  camera follow it across its orbit.
- An **astrophotography FOV planner** that projects a real camera's field of
  view onto the sky and predicts when a target will transit the frame.

Everything is computed from authoritative sources — no faked motion, no
placeholder data.

---

## 2. The core concept: the *zenith*

The product is named after the **zenith** — the point directly overhead at an
observer's location. The whole experience revolves around the observer's
**local sky**, expressed in the two angles an astronomer actually uses:

| Term | Meaning |
| --- | --- |
| **Altitude** | Angular height above the horizon. `0°` = on the horizon, `90°` = exactly at the zenith. |
| **Azimuth** | Compass bearing. `0°` = North, `90°` = East, `180°` = South, `270°` = West. |
| **Zenith offset** | `90° − altitude`. How far an object is from being directly overhead. `0°` means it is passing through your zenith *right now*. |

When an object's zenith offset drops below 10°, the telemetry panel lights up:
**★ PASSING THROUGH YOUR ZENITH ★**.

---

## 3. Features

### 🌍 Interactive 3D globe
- Token-free dark basemap (CARTO) that matches the mission-control theme; an
  optional Cesium Ion token unlocks terrain/satellite imagery.
- **Live day/night lighting** — the terminator is real, driven by the Sun's
  true position.
- **Click anywhere on the globe** to relocate the observer to that coordinate.
- **"Use my location"** uses browser geolocation for a one-tap real observer.
- Satellites **glide continuously** (not in 1-second steps) because each one's
  position is recomputed every rendered frame.

### 📡 Live object tracking
- **Space Stations** (ISS, Tiangong, crewed platforms) — on by default.
- **Brightest Satellites** (the 100 brightest visual objects).
- **Starlink** (a live sample of the constellation).
- **GPS Constellation** (operational MEO birds, ~20,200 km).
- **Solar System** — the Sun, Moon and all planets, on by default.

Each layer can be toggled in the sidebar, which also shows a **live count of
how many objects in that layer are currently above your horizon** (e.g.
`3↑`).

### 🛰️ Object inspector
Click any object (or "Inspect" from the HUD) for a deep-dive modal:
- **Live sky position** — altitude, azimuth, range, zenith offset.
- **Orbital parameters** (satellites) — period, inclination, eccentricity,
  apogee/perigee, derived from the TLE via SGP4.
- **Next visible passes** — a real 24-hour horizon scan listing when the
  object rises above 10° over *your* location, with start/peak/end bearings
  and max elevation.
- **Ephemeris** (planets) — constellation, magnitude, distance, rise/set.
- **OpenNotify cross-check** (ISS) — compares our SGP4 ground track against
  an independent live feed, time-matched, and reports the agreement in km.
- **Raw TLE** — the exact two-line element set used.

### 🔍 Search with target-lock
- A search bar (focus shortcut: **`/`**) searches everything currently
  tracked — satellites *and* planets.
- **Browse before you type**: focusing the empty field shows suggestions
  ranked by closeness to your zenith, so you can navigate without knowing a
  name.
- **Forgiving matching**: exact prefix → word-start → substring → in-order
  fuzzy (typing `zrya` still finds *ISS (ZARYA)*). The matched fragment is
  highlighted so you see *why* a result appeared.
- Selecting a result engages a **camera target-lock**: the globe flies to a
  sensible standoff distance and then *follows the object as it orbits*, with
  its full orbit drawn as a glowing trail. A floating chip shows the lock; ✕
  releases it and returns to your observer.

### 📷 Astrophotography FOV Planner
A Stellarium-class tool for planning the perfect shot of a locked target.
- **Sensor presets** — defaults to the **Sony IMX890 (8.19 × 6.14 mm)**, plus
  1″, Micro Four Thirds, APS-C and full-frame.
- **Variable focal length** (12–600 mm) on a live slider. The field of view is
  computed exactly: `FOV = 2 · atan(sensor / (2 · focal))`. At 50 mm the
  IMX890 reads **9.36° × 7.03°**.
- **A real framing reticle** projected onto the sky — frame border, rule-of-
  thirds grid and a center crosshair — that **resizes in real time** as you
  drag the focal slider, with zero stutter.
- **Trajectory prediction** — the target's path over the next 15 minutes
  (90 minutes for slow-moving planets) drawn as a glowing line through the
  reticle, with time pips (`+5′`, `+10′`…) so you can read transit speed.
- **Transit window** — the planner reports the exact clock times the target
  will be **inside your camera frame**, and for how long
  (e.g. *"IN FRAME 09:49:49 PM → 09:51:19 PM · 1 min 30 s across the sensor"*).
- **Horizon compass** — a Stellarium-style dashed horizon ring with cardinal
  letters (**N** in amber, E/S/W bright, intercardinals faint) so you always
  know which way you're facing.
- **Free look** — grab the sky to pan in any direction, scroll to zoom the
  viewfinder, exactly like Stellarium. Your feet stay planted at the observer
  (it's a tripod, not a jetpack).
- **Re-lock** — wander more than 1° off the frame and an amber **RE-LOCK
  TARGET** chip appears; one click re-aims the rig at the target's current
  position.
- **Click-to-retarget** — while the planner is open, clicking any other object
  on the globe re-points the whole rig at it.

### ✨ Experience & motion
- A cinematic **boot sequence**: a targeting reticle draws itself over
  expanding radar pings, the wordmark assembles letter-by-letter, a boot log
  streams with checkmarks, and the screen de-focuses away to reveal a globe
  that's *already alive* (Cesium and the first data fetch happen during the
  intro, so it hides load time rather than adding it). Respects
  `prefers-reduced-motion` and is click-to-skip.
- Orchestrated dashboard entrance, spring-loaded toggles, telemetry digits
  that glide between values, animated modals, and a mobile slide-in drawer.
- HUD dressing: edge vignette and cyan corner brackets framing the globe.

---

## 4. Data sources

| Source | Used for | How |
| --- | --- | --- |
| **CelesTrak GP** | Satellite orbital elements (TLEs) | Fetched + parsed server-side, cached 2 h, shared across all visitors |
| **satellite.js (SGP4)** | Propagating TLEs to live positions, passes, trajectories | Runs in the browser every frame and server-side for validation |
| **astronomy-engine** | Sun, Moon & planet positions, rise/set, magnitude, constellation | Computed locally — no API call needed |
| **OpenNotify** | Independent ISS position cross-check | Proxied server-side (it's plain HTTP) |

---

## 5. Tech stack

| Concern | Choice |
| --- | --- |
| Framework | **Next.js 15** (App Router) + **React 19** + **TypeScript** |
| Styling | **Tailwind CSS v4** (design tokens in `app/globals.css`) |
| Motion | **Framer Motion** |
| 3D engine | **CesiumJS** (client-only, continuous render) |
| Orbital math | **satellite.js** |
| Planetary math | **astronomy-engine** |

---

## 6. How it stays smooth (architecture in one breath)

The hard problem is updating live data every second **without re-rendering the
page or stuttering the 3D globe**. The solution:

- All live data lives in a **framework-free engine** (`ZenithTracker`) *outside*
  React. It runs two loops: a **slow loop** (fetch + compile TLEs once every
  2 hours) and a **fast loop** (propagate everything to "now" at 1 Hz).
- Small UI leaves (telemetry, header counts, sidebar) **subscribe** to the
  engine via `useSyncExternalStore` and re-render at 1 Hz — cheap, because
  they're a handful of DOM nodes.
- The **page never subscribes**, so it only re-renders on user actions.
- The **Cesium globe never re-renders from data at all**. It reads the engine
  imperatively and mutates entities in place; satellite positions are
  per-frame `CallbackProperty`s, so they move at 60 fps while React sleeps.

Measured under an active target-lock: **~130 fps, zero dropped frames.**

### Project map
```
app/page.tsx                  composition root (user-intent state only)
app/api/tle/route.ts          CelesTrak fetch → satellite.js parse → enriched JSON
app/api/iss/route.ts          OpenNotify proxy (independent ISS cross-check)
lib/tracker.ts                ZenithTracker engine (framework-free)
lib/layers.ts                 data-layer registry + shared types
lib/celestialBodies.ts        astronomy-engine wrappers (sky pos, rise/set…)
lib/fovMath.ts                pinhole optics + sky-frame geometry
lib/viewerBridge.ts           shared handle to the live Cesium viewer
hooks/useTracker.tsx          provider + useSyncExternalStore bindings
hooks/useFovPlanner.ts        FOV planner engine (camera + reticle + transit)
utils/orbitalMath.js          SGP4 pipeline, look angles, passes, ground tracks
components/CesiumGlobe.tsx     3D globe, per-frame propagation, target-lock
components/Sidebar.tsx         observer controls + animated layer toggles
components/TelemetryPanel.tsx  live focus readout
components/ObjectModal.tsx     deep-dive inspector
components/SearchBar.tsx       sky search with browse + fuzzy matching
components/FOVPlanner.tsx      astrophotography planner UI
components/IntroOverlay.tsx    cinematic boot sequence
components/HeaderStats.tsx     live header counters
components/ui/                 Modal / ToggleSwitch / AnimatedNumber primitives
next.config.js                 CesiumJS asset bundling + CESIUM_BASE_URL
```

---

## 7. Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run start    # serve the production build
```

> ⚠️ **Always use plain `npm run dev`** — never `next dev --turbopack`. Cesium's
> static assets are copied through the webpack pipeline in `next.config.js`,
> which Turbopack skips.
>
> ⚠️ **Don't run `npm run build` while the dev server is running** — they share
> the `.next` folder and the build will corrupt the live server.

No API keys are required; the app runs fully on the token-free basemap.
Optionally add `NEXT_PUBLIC_CESIUM_ION_TOKEN` in `.env.local` for Ion imagery.

---

## 8. Quick tour

1. Watch the **boot sequence**, then the globe centered on your observer
   (default: New Delhi — click the globe or "Use my location" to change it).
2. Toggle data layers in the sidebar; watch the **"in your sky"** counts.
3. Press **`/`** and type `iss` (or just focus and browse), hit **Enter** to
   **target-lock** — the camera follows the ISS along its glowing orbit.
4. Hit **◱ PLAN SHOT** to open the **FOV planner**. Pick a sensor, drag the
   focal length, and read off when the ISS crosses your camera frame.
5. **Drag the sky** to look around (note the **N·E·S·W** compass on the
   horizon), **scroll** to zoom, and hit **RE-LOCK** to snap back to target.

---

*Project Zenith — built to make the invisible traffic of the sky visible,
accurate, and beautiful.*
