// =============================================================================
// components/AboutPanel.tsx — "About" feature guide overlay
// =============================================================================
// A scrollable, glassmorphic overlay that explains everything Project SkyView
// can do. Shown when the app is in "about" mode (the header tab on desktop, the
// bottom-nav item on mobile); the live globe keeps turning behind it. Shared by
// both views, so it self-contains its layout and animations and only needs an
// `active` flag plus an `onClose` back to the tracker.
// =============================================================================

"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Rocket,
  SatelliteDish,
  Orbit,
  MapPin,
  Layers,
  Search,
  Info,
  Radio,
  Frame,
  Telescope,
  Clock,
  Zap,
  Moon,
  Smartphone,
} from "lucide-react";

interface Feature {
  Icon: typeof Rocket;
  title: string;
  body: string;
  accent: string;
}

/** Everything the site does — kept in one place, rendered as a card grid. */
const FEATURES: Feature[] = [
  {
    Icon: SatelliteDish,
    title: "Real-Time Zenith Tracker",
    body: "Live ISS & satellite positions, propagated every frame with SGP4 from fresh CelesTrak elements — see exactly what's passing overhead right now.",
    accent: "#38d9ff",
  },
  {
    Icon: Orbit,
    title: "Celestial Bodies",
    body: "The Sun, Moon and every planet, computed locally from a precision ephemeris — no network needed — and placed in your live sky.",
    accent: "#b39bff",
  },
  {
    Icon: MapPin,
    title: "Observe From Anywhere",
    body: "Set your vantage point with one tap of your GPS, by typing coordinates, or by clicking any spot on the 3D globe.",
    accent: "#34d399",
  },
  {
    Icon: Layers,
    title: "Data Layers",
    body: "Toggle Space Stations, the 100 brightest satellites, a live Starlink sample, the GPS constellation, and the Solar System.",
    accent: "#38d9ff",
  },
  {
    Icon: Search,
    title: "Sky Search",
    body: "Forgiving fuzzy search across every tracked object — pick one and the camera locks on and follows it around its orbit.",
    accent: "#b39bff",
  },
  {
    Icon: Info,
    title: "Object Inspector",
    body: "Orbital parameters, the next visible passes over your location, the raw two-line element set, and a live ISS cross-check.",
    accent: "#34d399",
  },
  {
    Icon: Radio,
    title: "Eyes of the Orbit",
    body: "NASA's live view of Earth from the ISS in a draggable window — with orbital-night detection that explains the dark when it's in Earth's shadow.",
    accent: "#fb7185",
  },
  {
    Icon: Frame,
    title: "Astrophotography Planner",
    body: "Choose a camera sensor and focal length and read off exactly when — and for how long — a target crosses your frame.",
    accent: "#38d9ff",
  },
  {
    Icon: Telescope,
    title: "Clear Sky Planner",
    body: "Weather-aware “golden windows” that cross-reference upcoming bright passes with the live cloud forecast for your location.",
    accent: "#fbbf24",
  },
  {
    Icon: Clock,
    title: "Cosmic Time Machine",
    body: "Scrub, fast-forward or rewind time and watch the entire sky — satellites, planets, day/night terminator — re-plot to that instant.",
    accent: "#b39bff",
  },
  {
    Icon: Zap,
    title: "Space Weather & Aurora",
    body: "Live NOAA planetary Kp index with geomagnetic-storm alerts and procedural auroral-oval rings drawn around the poles on the globe.",
    accent: "#34d399",
  },
  {
    Icon: Moon,
    title: "Night Vision Mode",
    body: "One tap shifts the whole interface to deep red, preserving your dark-adapted vision at the eyepiece while the globe stays full colour.",
    accent: "#fb7185",
  },
  {
    Icon: Smartphone,
    title: "Built For Every Screen",
    body: "A full mission-control dashboard on desktop and a separate touch-first experience on mobile, complete with a device-orientation “Magic Window.”",
    accent: "#38d9ff",
  },
];

export default function AboutPanel({ active, onClose }: { active: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 z-20 flex items-center justify-center p-4 pb-20"
          aria-label="About Project SkyView"
          role="region"
        >
          {/* dimming scrim — click to return to the tracker */}
          <div className="absolute inset-0 bg-void/70 backdrop-blur-sm" onClick={onClose} aria-hidden />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="glass-raised scrollbar-thin relative flex max-h-[82vh] w-full max-w-3xl flex-col
                       overflow-y-auto rounded-3xl"
          >
            {/* ------------------------------- header ------------------------------- */}
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-grid
                            bg-panel/80 px-5 py-4 backdrop-blur-xl sm:px-7">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-zenith-cyan/10 text-zenith-cyan">
                  <Rocket size={22} />
                </span>
                <div>
                  <h2 className="font-display text-lg font-bold tracking-tight text-starlight">
                    About Project SkyView
                  </h2>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stardust">The Celestial Eye</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close about"
                className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-lg text-stardust
                           transition-colors hover:bg-panel-raised hover:text-starlight"
              >
                <X size={18} />
              </button>
            </div>

            {/* ------------------------------- intro ------------------------------- */}
            <div className="px-5 pt-5 sm:px-7">
              <p className="text-sm leading-relaxed text-stardust">
                Project SkyView is a real-time cosmic radar that turns any point on Earth into a
                mission-control window on the sky. Everything below is live — propagated, computed and
                forecast from real data sources, on your screen, right now.
              </p>
            </div>

            {/* ---------------------------- feature grid ---------------------------- */}
            <motion.ul
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } } }}
              className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 sm:px-7"
            >
              {FEATURES.map(({ Icon, title, body, accent }) => (
                <motion.li
                  key={title}
                  variants={{
                    hidden: { opacity: 0, y: 14 },
                    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 320, damping: 26 } },
                  }}
                  className="flex gap-3 rounded-2xl border border-grid bg-void/40 p-4
                             transition-colors hover:bg-panel-raised/50"
                >
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                    style={{ backgroundColor: `${accent}1f`, color: accent }}
                  >
                    <Icon size={20} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-starlight">{title}</h3>
                    <p className="mt-1 text-[12px] leading-relaxed text-stardust">{body}</p>
                  </div>
                </motion.li>
              ))}
            </motion.ul>

            {/* ------------------------------- footer ------------------------------- */}
            <div className="border-t border-grid px-5 py-4 sm:px-7">
              <p className="text-[11px] leading-relaxed text-faint">
                Built with Next.js, CesiumJS, satellite.js, astronomy-engine and Framer Motion. Data from
                CelesTrak, NASA, NOAA SWPC and Open-Meteo. Created for AstralWeb Innovate 2026.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
