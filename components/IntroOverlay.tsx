// =============================================================================
// components/IntroOverlay.tsx — mission-boot startup sequence
// =============================================================================
// A ~3.2 s cinematic cold-open: a targeting reticle draws itself over
// expanding radar pings, "PROJECT ZENITH" assembles letter by letter, a boot
// log streams in with checkmarks, and a progress bar charges — then the whole
// overlay blurs and scales away, revealing the dashboard.
//
// Two non-negotiable production details:
//   · The overlay is OPAQUE, and the dashboard mounts BEHIND it — Cesium and
//     the first TLE fetch do their heavy lifting during the show, so the
//     reveal lands on a globe that is already alive. The intro doesn't cost
//     3 seconds; it hides them.
//   · prefers-reduced-motion users (and anyone who clicks) skip straight in.
// =============================================================================

"use client";

import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Check } from "lucide-react";

const TITLE = "PROJECT SKYVIEW";
const BOOT_LINES = [
  "ACQUIRING CELESTRAK TELEMETRY",
  "COMPILING SGP4 PROPAGATORS",
  "LOADING PLANETARY EPHEMERIS",
  "CALIBRATING ZENITH AXIS",
];
const TOTAL_MS = 3200;

// Deterministic starfield (pure function of index — identical on server and
// client, so no hydration mismatch from Math.random()).
const STARS = Array.from({ length: 64 }, (_, i) => ({
  left: `${(i * 53 + 17) % 100}%`,
  top: `${(i * 37 + 7) % 100}%`,
  size: 1 + (i % 3) * 0.7,
  delay: `${(i % 9) * 0.3}s`,
}));

export default function IntroOverlay({ onComplete }: { onComplete: () => void }) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    // Reduced-motion: no show, straight to the app.
    if (reduceMotion) {
      onComplete();
      return;
    }
    const timer = setTimeout(onComplete, TOTAL_MS);
    return () => clearTimeout(timer);
  }, [onComplete, reduceMotion]);

  if (reduceMotion) return null;

  return (
    <motion.div
      onClick={onComplete}
      // Exit: the whole boot screen de-focuses and falls away.
      exit={{ opacity: 0, scale: 1.06, filter: "blur(10px)" }}
      transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
      className="fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center
                 overflow-hidden bg-void"
      aria-label="Loading Project Skyview — click to skip"
    >
      {/* twinkling starfield */}
      {STARS.map((s, i) => (
        <span
          key={i}
          className="intro-star"
          style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: s.delay }}
        />
      ))}

      {/* ------------------------- reticle + radar pings ------------------- */}
      <div className="relative mb-8 flex h-28 w-28 items-center justify-center">
        {/* expanding pings */}
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute inset-0 rounded-full border border-zenith-cyan/40"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: [0.6, 2.3], opacity: [0.55, 0] }}
            transition={{ duration: 2, delay: 0.3 + i * 0.65, repeat: Infinity, ease: "easeOut" }}
          />
        ))}
        {/* self-drawing targeting reticle */}
        <svg viewBox="0 0 100 100" className="h-24 w-24" aria-hidden>
          <motion.circle
            cx="50" cy="50" r="34"
            fill="none" stroke="var(--color-zenith-cyan)" strokeWidth="1.5" strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, delay: 0.15, ease: "easeInOut" }}
          />
          {/* crosshair ticks: N E S W */}
          {[
            { x1: 50, y1: 4, x2: 50, y2: 16 },
            { x1: 96, y1: 50, x2: 84, y2: 50 },
            { x1: 50, y1: 96, x2: 50, y2: 84 },
            { x1: 4, y1: 50, x2: 16, y2: 50 },
          ].map((l, i) => (
            <motion.line
              key={i} {...l}
              stroke="var(--color-zenith-cyan)" strokeWidth="1.5" strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.95 + i * 0.08 }}
            />
          ))}
          <motion.circle
            cx="50" cy="50" r="2.5" fill="var(--color-zenith-cyan)"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.6, 1], opacity: 1 }}
            transition={{ duration: 0.4, delay: 1.25 }}
          />
        </svg>
      </div>

      {/* ----------------------------- wordmark ---------------------------- */}
      <h1
        className="flex font-display text-3xl font-bold tracking-[0.18em] text-starlight sm:text-4xl"
        style={{ perspective: 600 }}
      >
        {TITLE.split("").map((ch, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 26, rotateX: 85 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ delay: 0.45 + i * 0.04, type: "spring", stiffness: 320, damping: 24 }}
          >
            {ch === " " ? " " : ch}
          </motion.span>
        ))}
      </h1>
      <motion.p
        initial={{ opacity: 0, letterSpacing: "0.7em" }}
        animate={{ opacity: 1, letterSpacing: "0.32em" }}
        transition={{ delay: 1.0, duration: 0.9, ease: "easeOut" }}
        className="mt-3 text-[11px] uppercase text-stardust"
      >
        The Celestial Eye
      </motion.p>

      {/* ----------------------------- boot log ---------------------------- */}
      <div className="mt-8 h-24 font-mono text-[10px] leading-relaxed">
        {BOOT_LINES.map((line, i) => (
          <motion.p
            key={line}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.15 + i * 0.42, duration: 0.25 }}
            className="flex items-center gap-2 text-stardust"
          >
            <ChevronRight size={11} className="shrink-0 text-zenith-cyan" />
            {line}
            <motion.span
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.45 + i * 0.42, type: "spring", stiffness: 500, damping: 22 }}
              className="text-signal"
            >
              <Check size={12} />
            </motion.span>
          </motion.p>
        ))}
      </div>

      {/* --------------------------- progress bar -------------------------- */}
      <div className="mt-2 h-px w-56 overflow-hidden rounded bg-grid">
        <motion.div
          className="h-full origin-left"
          style={{ background: "linear-gradient(90deg, var(--color-zenith-cyan), var(--color-aurora))" }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 2.6, delay: 0.35, ease: "easeInOut" }}
        />
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.6 }}
        transition={{ delay: 1.8 }}
        className="absolute bottom-6 font-mono text-[9px] uppercase tracking-[0.25em] text-faint"
      >
        Click to skip
      </motion.p>
    </motion.div>
  );
}
