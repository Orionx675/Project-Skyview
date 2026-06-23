// =============================================================================
// app/about/page.tsx — "The Celestial Eye" cinematic landing page
// =============================================================================
// A full-screen, scroll-driven marketing page that lives at /about, separate
// from the functional Tracker app at /. The whole viewport is a live cosmos:
//
//   · A real CesiumJS globe is mounted as a fixed backdrop (reusing the SAME
//     CesiumGlobe component + its CDN loader — never a second Cesium import),
//     and its camera is driven entirely by page scroll through the viewer
//     bridge. cameraSuppressed=true stands its internal lock logic down so we
//     own the camera; we also disable user input so scroll is the only driver.
//   · A canvas star-field drifts with parallax over the globe.
//   · Framer Motion (chosen over GSAP — zero extra deps, React-idiomatic,
//     hardware-accelerated transform/opacity, and respects reduced motion)
//     powers the kinetic typography, the assemble-on-scroll holographic cards,
//     spring float/hover, the typewriter, and the scroll→camera mapping.
//
// Everything degrades gracefully: if the globe can't boot, the star-field and
// content still render. All Cesium access is guarded by viewer.isDestroyed().
// =============================================================================

"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  motion,
  useScroll,
  useMotionValueEvent,
  useReducedMotion,
  type MotionValue,
} from "framer-motion";
import {
  ArrowRight,
  SatelliteDish,
  MapPin,
  Layers,
  Search,
  Radio,
  Frame,
  Telescope,
  Clock,
  Zap,
  Moon,
  Orbit,
  Info,
  Telescope as Scope,
  ChevronDown,
} from "lucide-react";
import GlobeFallback from "@/components/GlobeFallback";
import { TrackerProvider, useTrackerSnapshot } from "@/hooks/useTracker";
import { useViewerBridge } from "@/lib/viewerBridge";
import { DATA_LAYERS, type Observer } from "@/lib/layers";

// Cesium dereferences `window` at module-eval — load it client-only.
const CesiumGlobe = dynamic(() => import("@/components/CesiumGlobe"), {
  ssr: false,
  loading: () => <GlobeFallback />,
});

// The page's hero/observer location — the camera swoops here mid-scroll.
const THIRUVANANTHAPURAM: Observer = {
  latitude: 8.5241,
  longitude: 76.9366,
  label: "Thiruvananthapuram, IN",
};

// Keep the backdrop light: stations (ISS + crewed platforms) and the planets.
const BACKDROP_LAYERS = new Set(["stations", "solar-system"]);

// =============================================================================
// Scroll → Cesium camera mapping
// =============================================================================
// Each key is a camera POSE (sub-point lon/lat, altitude, heading, pitch) at a
// scroll fraction. We smoothstep-interpolate between the bracketing keys, so
// scrolling continuously pans/zooms/rotates the globe — and the Data-Layers
// fraction lands the camera in a tight swoop over Thiruvananthapuram.

interface CamKey {
  p: number;
  lon: number;
  lat: number;
  h: number;
  heading: number;
  pitch: number;
}

const CAM_KEYS: CamKey[] = [
  { p: 0.0, lon: 58, lat: 16, h: 26_000_000, heading: 0, pitch: -78 }, // hero
  { p: 0.2, lon: 30, lat: 26, h: 22_000_000, heading: 14, pitch: -60 }, // tracker
  { p: 0.42, lon: 76.94, lat: 8.52, h: 13_000_000, heading: 0, pitch: -72 }, // approach
  { p: 0.56, lon: 76.94, lat: 8.52, h: 2_300_000, heading: 0, pitch: -55 }, // Thiruvananthapuram swoop
  { p: 0.74, lon: 94, lat: 12, h: 7_000_000, heading: -18, pitch: -48 }, // inspector
  { p: 1.0, lon: 132, lat: 22, h: 20_000_000, heading: -30, pitch: -66 }, // outro
];

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function cameraPose(Cesium: typeof import("cesium"), p: number) {
  let a = CAM_KEYS[0];
  let b = CAM_KEYS[CAM_KEYS.length - 1];
  for (let i = 0; i < CAM_KEYS.length - 1; i++) {
    if (p >= CAM_KEYS[i].p && p <= CAM_KEYS[i + 1].p) {
      a = CAM_KEYS[i];
      b = CAM_KEYS[i + 1];
      break;
    }
  }
  const t = smoothstep(clamp01((p - a.p) / (b.p - a.p || 1)));
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    destination: Cesium.Cartesian3.fromDegrees(mix(a.lon, b.lon), mix(a.lat, b.lat), mix(a.h, b.h)),
    orientation: {
      heading: Cesium.Math.toRadians(mix(a.heading, b.heading)),
      pitch: Cesium.Math.toRadians(mix(a.pitch, b.pitch)),
      roll: 0,
    },
  };
}

/** Drives the live Cesium camera from page scroll. Renders nothing. */
function ScrollCameraDriver({ progress }: { progress: MotionValue<number> }) {
  const bridge = useViewerBridge();
  const latest = useRef(0);

  const apply = (p: number) => {
    if (!bridge || bridge.viewer.isDestroyed()) return;
    const pose = cameraPose(bridge.Cesium, p);
    bridge.viewer.camera.cancelFlight();
    bridge.viewer.camera.setView(pose);
  };

  useMotionValueEvent(progress, "change", (p) => {
    latest.current = p;
    apply(p);
  });

  // Take ownership of the camera once the globe is live; restore on teardown.
  useEffect(() => {
    if (!bridge || bridge.viewer.isDestroyed()) return;
    const controller = bridge.viewer.scene.screenSpaceCameraController;
    controller.enableInputs = false;
    apply(latest.current || progress.get());
    return () => {
      if (!bridge.viewer.isDestroyed()) controller.enableInputs = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  return null;
}

// =============================================================================
// Canvas star-field — parallax drift over the globe, reduced-motion aware
// =============================================================================

function StarField({ progress }: { progress: MotionValue<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let stars: { x: number; y: number; z: number; r: number; tw: number }[] = [];
    let w = 0;
    let h = 0;

    const seed = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(220, Math.floor((w * h) / 9000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random() * 0.85 + 0.15, // depth → parallax + size
        r: Math.random() * 1.3 + 0.2,
        tw: Math.random() * Math.PI * 2,
      }));
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, w, h);
      const p = progress.get();
      for (const s of stars) {
        // Parallax: deeper stars drift less as you scroll.
        const drift = ((p * 600 * s.z) % (h + 40)) - 20;
        const y = (s.y + drift) % (h + 40);
        const twinkle = reduce ? 0.7 : 0.45 + 0.55 * Math.abs(Math.sin(time * 0.0011 + s.tw));
        ctx.globalAlpha = Math.min(1, twinkle * s.z);
        ctx.fillStyle = s.z > 0.7 ? "#dfe9ff" : "#9fb4e8";
        ctx.beginPath();
        ctx.arc(s.x, y, s.r * s.z, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    seed();
    draw(0);
    const onResize = () => seed();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [progress, reduce]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />;
}

// =============================================================================
// Reusable kinetic pieces
// =============================================================================

/** Hero title that assembles letter-by-letter, then ignites the shimmer. */
function AssemblingTitle({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const [lit, setLit] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => setLit(true), 150 + text.length * 45 + 400);
    return () => clearTimeout(t);
  }, [reduce, text.length]);

  // NOTE: background-clip:text can't span inline-block children, so the shimmer
  // gradient is applied per-letter (each span clips its own glyph) — that also
  // lets the assemble transforms work, which need inline-block.
  return (
    <h1 className="max-w-5xl text-center font-display text-4xl font-bold leading-tight tracking-tight text-starlight sm:text-6xl md:text-7xl">
      {text.split("").map((ch, i) => (
        <motion.span
          key={i}
          initial={reduce ? false : { opacity: 0, scale: 0.2, filter: "blur(8px)", y: (i % 2 ? -1 : 1) * 18 }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)", y: 0 }}
          transition={{ delay: 0.15 + i * 0.045, type: "spring", stiffness: 260, damping: 20 }}
          className={`inline-block ${lit ? "holo-text" : ""}`}
        >
          {ch === " " ? " " : ch}
        </motion.span>
      ))}
    </h1>
  );
}

/** Types `text` out one character at a time once `start` is true. */
function Typewriter({ text, start, className }: { text: string; start: boolean; className?: string }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!start) {
      setN(0);
      return;
    }
    if (reduce) {
      setN(text.length);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [start, text, reduce]);

  return (
    <p className={className} aria-label={text}>
      {text.slice(0, n)}
      {start && n < text.length && <span className="text-zenith-cyan">▋</span>}
    </p>
  );
}

/** Glass holographic card: assembles on scroll, floats forever, springs on hover. */
function HoloCard({
  children,
  className = "",
  floatDelay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  floatDelay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 64, scale: 0.92 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: false, amount: 0.3 }}
      transition={{ type: "spring", stiffness: 110, damping: 18 }}
      whileHover={{ scale: 1.03 }}
      className={`holo-border glass-raised rounded-3xl ${className}`}
    >
      <motion.div
        animate={reduce ? {} : { y: [0, -10, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: floatDelay }}
        className="h-full w-full"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/** A small holographic wireframe globe that floats below the hero title. */
function WireGlobe() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 1.1, type: "spring", stiffness: 120, damping: 16 }}
      className="holo-float"
    >
      <motion.svg
        viewBox="0 0 200 200"
        className="h-28 w-28 sm:h-36 sm:w-36"
        animate={{ rotate: 360 }}
        transition={{ duration: 36, repeat: Infinity, ease: "linear" }}
        aria-hidden
      >
        <defs>
          <linearGradient id="wire" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38d9ff" />
            <stop offset="60%" stopColor="#b39bff" />
            <stop offset="100%" stopColor="#ff8af0" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#wire)" strokeWidth="1.1" opacity="0.85">
          <circle cx="100" cy="100" r="78" />
          <ellipse cx="100" cy="100" rx="78" ry="26" />
          <ellipse cx="100" cy="100" rx="78" ry="52" />
          <ellipse cx="100" cy="100" rx="26" ry="78" />
          <ellipse cx="100" cy="100" rx="52" ry="78" />
          <line x1="22" y1="100" x2="178" y2="100" />
        </g>
        <circle cx="100" cy="100" r="4" fill="#38d9ff" />
      </motion.svg>
    </motion.div>
  );
}

/** Section heading with the eyebrow label + shimmering title. */
function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-8">
      <motion.p
        initial={{ opacity: 0, x: -16 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: false, amount: 0.6 }}
        className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.4em] text-stardust"
      >
        {eyebrow}
      </motion.p>
      <motion.h2
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: false, amount: 0.6 }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
        className="holo-text font-display text-3xl font-bold tracking-tight sm:text-5xl"
      >
        {title}
      </motion.h2>
    </div>
  );
}

// =============================================================================
// Sections
// =============================================================================

function HeroSection() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <motion.span
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="flex items-center gap-2 rounded-full border border-grid bg-void/50 px-3.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-stardust backdrop-blur-md"
      >
        <span className="pulse-live h-1.5 w-1.5 rounded-full bg-signal" /> AstralWeb Innovate 2026
      </motion.span>

      <AssemblingTitle text="Project SkyView: The Celestial Eye" />

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.0, duration: 0.8 }}
        className="max-w-2xl text-base leading-relaxed text-stardust sm:text-lg"
      >
        Turn any point on Earth into a mission-control window on the sky. Real satellites, the live
        ISS, the planets and the aurora — propagated, computed and forecast from real data, right
        now.
      </motion.p>

      <WireGlobe />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.25, type: "spring", stiffness: 140, damping: 18 }}
        className="flex flex-wrap items-center justify-center gap-3"
      >
        <Link
          href="/"
          className="holo-cta focus-ring group flex items-center gap-2 rounded-full border border-zenith-cyan/50 bg-zenith-cyan/15 px-6 py-3 font-mono text-xs font-bold uppercase tracking-widest text-zenith-cyan hover:bg-zenith-cyan/25 hover:shadow-[0_0_28px_rgba(56,217,255,0.5)]"
        >
          <SatelliteDish size={15} /> Enter Tracker
          <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
        </Link>
        <a
          href="#features"
          className="holo-cta focus-ring flex items-center gap-2 rounded-full border border-grid bg-void/40 px-6 py-3 font-mono text-xs font-bold uppercase tracking-widest text-stardust hover:border-aurora/60 hover:text-aurora hover:shadow-[0_0_28px_rgba(179,155,255,0.4)]"
        >
          <Info size={15} /> Feature Guide
        </a>
      </motion.div>

      <motion.div
        animate={{ y: [0, 8, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-8 text-faint"
        aria-hidden
      >
        <ChevronDown size={22} />
      </motion.div>
    </section>
  );
}

/** Section 2 — Real-Time Zenith Tracker: card splits/reforms, icons fly in, text types. */
function TrackerSection() {
  const [inView, setInView] = useState(false);
  return (
    <section id="features" className="relative flex min-h-screen items-center px-6 py-24 sm:px-12">
      <motion.div
        onViewportEnter={() => setInView(true)}
        onViewportLeave={() => setInView(false)}
        viewport={{ amount: 0.5 }}
        className="mx-auto grid w-full max-w-5xl items-center gap-10 md:grid-cols-2"
      >
        <div>
          <SectionHead eyebrow="01 · Live Engine" title="Real-Time Zenith Tracker" />
          <Typewriter
            start={inView}
            text="Every satellite is propagated with SGP4 from fresh CelesTrak elements — re-evaluated on every single rendered frame, not once a second. See exactly what is crossing your zenith right now."
            className="max-w-md font-mono text-sm leading-relaxed text-stardust"
          />
          <div className="mt-6 flex flex-wrap gap-2">
            {["SGP4", "satellite.js", "Per-frame", "CelesTrak"].map((t, i) => (
              <motion.span
                key={t}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: false }}
                transition={{ delay: 0.2 + i * 0.08 }}
                className="rounded-full border border-grid bg-void/40 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan"
              >
                {t}
              </motion.span>
            ))}
          </div>
        </div>

        {/* the card reforms around the data; icons fly in from opposite sides */}
        <div className="relative">
          {/* procedural orbit "trails" drawn behind the card */}
          <svg className="pointer-events-none absolute -inset-8 -z-10 h-[calc(100%+4rem)] w-[calc(100%+4rem)]" viewBox="0 0 400 300" aria-hidden>
            {[0, 1, 2].map((i) => (
              <motion.path
                key={i}
                d={`M -20 ${90 + i * 70} C 120 ${30 + i * 60}, 280 ${250 - i * 50}, 420 ${110 + i * 40}`}
                fill="none"
                stroke={["#38d9ff", "#b39bff", "#34d399"][i]}
                strokeOpacity="0.5"
                strokeWidth="1.5"
                strokeDasharray="4 8"
                initial={{ pathLength: 0, opacity: 0 }}
                whileInView={{ pathLength: 1, opacity: 1 }}
                viewport={{ once: false, amount: 0.4 }}
                transition={{ duration: 1.4, delay: i * 0.2, ease: "easeInOut" }}
              />
            ))}
          </svg>

          <HoloCard className="p-6">
            <div className="flex items-center justify-between">
              <motion.span
                initial={{ x: -120, opacity: 0, rotate: -30 }}
                whileInView={{ x: 0, opacity: 1, rotate: 0 }}
                viewport={{ once: false, amount: 0.5 }}
                transition={{ type: "spring", stiffness: 180, damping: 16 }}
                className="grid h-12 w-12 place-items-center rounded-2xl bg-zenith-cyan/15 text-zenith-cyan"
              >
                <SatelliteDish size={24} />
              </motion.span>
              <motion.span
                initial={{ x: 120, opacity: 0, rotate: 30 }}
                whileInView={{ x: 0, opacity: 1, rotate: 0 }}
                viewport={{ once: false, amount: 0.5 }}
                transition={{ type: "spring", stiffness: 180, damping: 16 }}
                className="grid h-12 w-12 place-items-center rounded-2xl bg-signal/15 text-signal"
              >
                <MapPin size={24} />
              </motion.span>
            </div>
            <LiveTrackerReadout />
          </HoloCard>
        </div>
      </motion.div>
    </section>
  );
}

/** Tiny live readout inside the Tracker card — pulls the real overhead count. */
function LiveTrackerReadout() {
  const { objects, totalOverhead } = useTrackerSnapshot();
  const iss = objects.find((o) => o.name.toUpperCase().includes("ISS"));
  return (
    <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-grid">
      <Stat label="Tracking" value={`${objects.length}`} accent="text-starlight" />
      <Stat label="In your sky" value={`${totalOverhead}`} accent="text-signal" />
      <Stat label="ISS altitude" value={iss ? `${iss.altitude.toFixed(1)}°` : "—"} accent="text-zenith-cyan" />
      <Stat label="ISS range" value={iss ? `${Math.round(iss.rangeKm).toLocaleString()} km` : "—"} accent="text-aurora" />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-panel/80 px-4 py-3">
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-faint">{label}</p>
      <p className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

/** Section 3 — Data Layers: toggle chips orbit the card in 3D; globe swoops to Kerala. */
function DataLayersSection() {
  return (
    <section className="relative flex min-h-screen items-center px-6 py-24 sm:px-12">
      <div className="mx-auto w-full max-w-4xl text-center">
        <SectionHead eyebrow="02 · The Orbit" title="Toggle the Cosmos" />
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: false }}
          className="mx-auto mb-14 max-w-xl text-sm leading-relaxed text-stardust"
        >
          Space Stations, the brightest satellites, a live Starlink sample, the GPS constellation and
          the whole Solar System — each a layer you flip on. Scroll in and the globe itself swoops
          down over Thiruvananthapuram.
        </motion.p>

        {/* the chips orbit this central card */}
        <div className="relative mx-auto grid h-[22rem] w-full max-w-md place-items-center">
          <motion.div
            className="absolute inset-0"
            animate={{ rotate: 360 }}
            transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
            aria-hidden
          >
            {DATA_LAYERS.map((layer, i) => {
              const angle = (i / DATA_LAYERS.length) * Math.PI * 2;
              const rx = 46; // % radius
              const ry = 30;
              const left = 50 + Math.cos(angle) * rx;
              const top = 50 + Math.sin(angle) * ry;
              return (
                <motion.div
                  key={layer.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${left}%`, top: `${top}%` }}
                  animate={{ rotate: -360 }} // counter-rotate to stay upright
                  transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
                >
                  <span className="flex items-center gap-2 whitespace-nowrap rounded-full border border-grid bg-panel/85 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-starlight shadow-panel backdrop-blur-md">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: layer.color, boxShadow: `0 0 8px ${layer.color}` }}
                    />
                    {layer.label}
                  </span>
                </motion.div>
              );
            })}
          </motion.div>

          <HoloCard className="h-40 w-40 rounded-full">
            <div className="flex h-full w-full flex-col items-center justify-center text-center">
              <Layers size={30} className="text-zenith-cyan" />
              <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-stardust">
                {DATA_LAYERS.length} live layers
              </p>
            </div>
          </HoloCard>
        </div>
      </div>
    </section>
  );
}

/** SGP4-flavoured equations that scroll up behind the Inspector readout. */
const SGP4_LINES = [
  "n₀ = 2π / T_period",
  "a = (μ / n₀²)^(1/3)",
  "M = M₀ + n₀ (t − t₀)",
  "E − e·sin E = M",
  "ν = 2·atan2(√(1+e)·sin(E/2), √(1−e)·cos(E/2))",
  "r⃗_eci = R_z(−Ω) R_x(−i) R_z(−ω) r⃗_pqw",
  "r⃗_ecf = R_z(GMST) · r⃗_eci",
  "ρ⃗ = r⃗_sat − r⃗_obs",
  "el = asin(ρ⃗ · ẑ_up / |ρ⃗|)",
  "az = atan2(ρ⃗ · ê_east, ρ⃗ · n̂_north)",
  "θ_zenith = 90° − el",
  "Δ_km = R⊕ · haversine(φ₁,λ₁,φ₂,λ₂)",
];

/** Section 4 — Object Inspector: data projects up from a glowing core. */
function InspectorSection() {
  const { objects } = useTrackerSnapshot();
  const iss = objects.find((o) => o.name.toUpperCase().includes("ISS")) ?? objects[0] ?? null;

  const rows = [
    { label: "Altitude", value: iss ? `${iss.altitude.toFixed(1)}°` : "—", accent: "text-zenith-cyan" },
    { label: "Azimuth", value: iss ? `${iss.azimuth.toFixed(1)}°` : "—", accent: "text-zenith-cyan" },
    { label: "Range", value: iss ? `${Math.round(iss.rangeKm).toLocaleString()} km` : "—", accent: "text-aurora" },
    { label: "Zenith offset", value: iss ? `${iss.degreesFromZenith.toFixed(1)}°` : "—", accent: "text-signal" },
  ];

  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-24">
      {/* flowing SGP4 equations behind everything */}
      <div className="pointer-events-none absolute inset-0 flex justify-center overflow-hidden opacity-[0.14]" aria-hidden>
        <div className="code-flow flex flex-col gap-4 font-mono text-xs text-zenith-cyan sm:text-sm">
          {[...SGP4_LINES, ...SGP4_LINES].map((line, i) => (
            <span key={i} className="whitespace-nowrap">
              {line}
            </span>
          ))}
        </div>
      </div>

      <div className="relative z-10 w-full max-w-2xl text-center">
        <SectionHead eyebrow="03 · Holographic Readout" title="The Object Inspector" />
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: false }}
          className="mx-auto mb-12 max-w-lg text-sm leading-relaxed text-stardust"
        >
          Lock any object and its live geometry projects up from the core — derived in real time from
          the same SGP4 math streaming behind this panel.
        </motion.p>

        {/* the glowing core the data rises from */}
        <div className="relative mx-auto flex max-w-md flex-col items-center">
          <div className="grid grid-cols-2 gap-4">
            {rows.map((r, i) => (
              <motion.div
                key={r.label}
                initial={{ opacity: 0, y: 50, filter: "blur(6px)" }}
                whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                viewport={{ once: false, amount: 0.5 }}
                transition={{ delay: i * 0.12, type: "spring", stiffness: 140, damping: 18 }}
                className="holo-border glass-raised rounded-2xl px-5 py-4"
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-faint">{r.label}</p>
                <p className={`mt-1 font-mono text-2xl font-bold tabular-nums ${r.accent}`}>{r.value}</p>
              </motion.div>
            ))}
          </div>
          {/* glowing emission core under the grid */}
          <motion.div
            className="mt-6 h-1.5 w-40 rounded-full bg-zenith-cyan"
            animate={{ opacity: [0.4, 1, 0.4], boxShadow: ["0 0 20px #38d9ff", "0 0 44px #38d9ff", "0 0 20px #38d9ff"] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            aria-hidden
          />
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.3em] text-faint">
            {iss ? `Live · ${iss.name}` : "Awaiting telemetry"}
          </p>
        </div>
      </div>
    </section>
  );
}

/** Compact feature grid recapping everything else, then the closing CTA. */
const EXTRA_FEATURES = [
  { Icon: Radio, title: "Eyes of the Orbit", body: "NASA's live ISS feed with orbital-night detection.", accent: "#fb7185" },
  { Icon: Frame, title: "Astrophotography Planner", body: "Sensor + focal length → exact frame-transit windows.", accent: "#38d9ff" },
  { Icon: Telescope, title: "Clear Sky Planner", body: "Weather-aware golden windows for bright passes.", accent: "#fbbf24" },
  { Icon: Clock, title: "Cosmic Time Machine", body: "Scrub time; the whole sky re-plots to that instant.", accent: "#b39bff" },
  { Icon: Zap, title: "Space Weather & Aurora", body: "Live NOAA Kp, storm alerts and auroral-oval rings.", accent: "#34d399" },
  { Icon: Moon, title: "Night Vision", body: "One tap shifts the UI to deep red for the eyepiece.", accent: "#fb7185" },
  { Icon: Search, title: "Sky Search", body: "Forgiving fuzzy search that locks the camera on.", accent: "#b39bff" },
  { Icon: Orbit, title: "Celestial Bodies", body: "Sun, Moon and planets from a local ephemeris.", accent: "#38d9ff" },
];

function MoreFeaturesSection() {
  return (
    <section className="relative px-6 py-24 sm:px-12">
      <div className="mx-auto max-w-5xl">
        <SectionHead eyebrow="04 · Everything Else" title="A Full Mission Control" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {EXTRA_FEATURES.map(({ Icon, title, body, accent }, i) => (
            <HoloCard key={title} className="p-5" floatDelay={i * 0.3}>
              <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ backgroundColor: `${accent}1f`, color: accent }}>
                <Icon size={20} />
              </span>
              <h3 className="mt-3 text-sm font-semibold text-starlight">{title}</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-stardust">{body}</p>
            </HoloCard>
          ))}
        </div>
      </div>
    </section>
  );
}

function ClosingCTA() {
  return (
    <section className="relative flex min-h-[70vh] flex-col items-center justify-center gap-6 px-6 text-center">
      <Scope size={30} className="text-zenith-cyan" />
      <h2 className="holo-text font-display text-3xl font-bold tracking-tight sm:text-5xl">Look up.</h2>
      <p className="max-w-md text-sm leading-relaxed text-stardust">
        The sky overhead is full of motion. Open the tracker and watch it live.
      </p>
      <Link
        href="/"
        className="holo-cta focus-ring group flex items-center gap-2 rounded-full border border-zenith-cyan/50 bg-zenith-cyan/15 px-7 py-3.5 font-mono text-xs font-bold uppercase tracking-widest text-zenith-cyan hover:bg-zenith-cyan/25 hover:shadow-[0_0_30px_rgba(56,217,255,0.55)]"
      >
        <SatelliteDish size={16} /> Enter the Tracker
        <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
      </Link>
      <p className="mt-6 font-mono text-[10px] leading-relaxed text-faint">
        Built with Next.js · CesiumJS · satellite.js · astronomy-engine · Framer Motion ·
        Data from CelesTrak, NASA, NOAA SWPC & Open-Meteo
      </p>
    </section>
  );
}

// =============================================================================
// Page
// =============================================================================

export default function AboutPage() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ container: scrollRef });

  return (
    <TrackerProvider observer={THIRUVANANTHAPURAM} enabledLayerIds={BACKDROP_LAYERS}>
      <main className="relative h-screen w-screen overflow-hidden bg-void text-starlight">
        {/* ---------------- fixed cosmic backdrop (behind everything) ---------------- */}
        <div className="pointer-events-none absolute inset-0 z-0">
          <CesiumGlobe
            observer={THIRUVANANTHAPURAM}
            selectedObjectId={null}
            trackedObjectId={null}
            cameraSuppressed
            onSelectLocation={() => {}}
            onInspectObject={() => {}}
          />
          <ScrollCameraDriver progress={scrollYProgress} />
          <StarField progress={scrollYProgress} />
          <div className="globe-vignette absolute inset-0" />
          {/* gradient floor so text always has contrast over the bright globe */}
          <div className="absolute inset-0 bg-gradient-to-b from-void/40 via-transparent to-void/80" />
        </div>

        {/* ---------------- a tiny fixed back-link ---------------- */}
        <Link
          href="/"
          className="focus-ring fixed left-4 top-4 z-30 flex items-center gap-1.5 rounded-full border border-grid bg-void/60 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-stardust backdrop-blur-md transition-colors hover:text-starlight"
        >
          <SatelliteDish size={12} /> SkyView Tracker
        </Link>

        {/* ---------------- the scroll-driving content ---------------- */}
        <div ref={scrollRef} className="scrollbar-thin relative z-10 h-screen overflow-y-auto overflow-x-hidden">
          <HeroSection />
          <TrackerSection />
          <DataLayersSection />
          <InspectorSection />
          <MoreFeaturesSection />
          <ClosingCTA />
        </div>
      </main>
    </TrackerProvider>
  );
}
