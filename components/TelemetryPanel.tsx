// =============================================================================
// components/TelemetryPanel.tsx — live look-angle readout for the focus target
// =============================================================================
// Floats over the globe. Focus priority: the ISS if tracked, otherwise the
// object closest to the observer's zenith. Values glide on springs
// (AnimatedNumber writes to the DOM without re-renders); when the focus
// TARGET changes, the header cross-fades via AnimatePresence.
// =============================================================================

"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Lock, ArrowUpRight, Sparkles } from "lucide-react";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import { useTrackerSnapshot } from "@/hooks/useTracker";
import { azimuthToCompass } from "@/utils/orbitalMath";

export default function TelemetryPanel({
  onInspect,
  lockedId = null,
}: {
  onInspect: (id: string) => void;
  /** A target-locked object overrides the automatic focus. */
  lockedId?: string | null;
}) {
  const { objects } = useTrackerSnapshot();

  const focus = useMemo(() => {
    if (objects.length === 0) return null;
    if (lockedId) {
      const locked = objects.find((o) => o.id === lockedId);
      if (locked) return locked;
    }
    return (
      objects.find((o) => o.name.toUpperCase().includes("ISS")) ??
      [...objects].sort((a, b) => a.degreesFromZenith - b.degreesFromZenith)[0]
    );
  }, [objects, lockedId]);

  if (!focus) {
    return (
      <div className="glass rounded-xl p-4">
        <p className="font-mono text-xs text-faint">AWAITING TELEMETRY…</p>
      </div>
    );
  }

  const atZenith = focus.degreesFromZenith < 10;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="glass w-72 overflow-hidden rounded-xl"
    >
      {/* Header cross-fades when the focus target itself changes */}
      <div className="flex items-center justify-between border-b border-grid px-4 py-3">
        <AnimatePresence mode="wait">
          <motion.h3
            key={focus.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="flex min-w-0 items-center gap-2 font-mono text-sm font-semibold text-starlight"
          >
            <span className="truncate">{focus.name}</span>
            {lockedId === focus.id && (
              <span className="flex shrink-0 items-center gap-1 rounded bg-zenith-cyan/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-zenith-cyan">
                <Lock size={9} /> LOCK
              </span>
            )}
          </motion.h3>
        </AnimatePresence>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider
            ${focus.aboveHorizon ? "bg-signal/15 text-signal" : "bg-alert/15 text-alert"}`}
        >
          {focus.aboveHorizon ? "IN SKY" : "BELOW HZN"}
        </span>
      </div>

      {/* Spring-smoothed telemetry grid */}
      <div className="grid grid-cols-2 gap-px bg-grid">
        <Readout label="ALTITUDE">
          <AnimatedNumber value={focus.altitude} decimals={1} suffix="°" className="text-zenith-cyan" />
        </Readout>
        <Readout label="AZIMUTH" sub={azimuthToCompass(focus.azimuth)}>
          <AnimatedNumber value={focus.azimuth} decimals={1} suffix="°" className="text-zenith-cyan" />
        </Readout>
        <Readout label="RANGE">
          <AnimatedNumber value={focus.rangeKm} grouped suffix=" km" className="text-aurora" />
        </Readout>
        <Readout label="ZENITH OFFSET">
          <AnimatedNumber
            value={focus.degreesFromZenith}
            decimals={1}
            suffix="°"
            className={atZenith ? "text-signal" : "text-aurora"}
          />
        </Readout>
      </div>

      {/* Zenith banner slides in only while the target is within 10° of zenith */}
      <AnimatePresence>
        {atZenith && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-grid"
          >
            <p className="flex items-center justify-center gap-1.5 px-4 py-2 text-center font-mono text-[11px] font-semibold tracking-widest text-signal">
              <Sparkles size={11} /> PASSING THROUGH YOUR ZENITH <Sparkles size={11} />
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ backgroundColor: "rgba(56, 217, 255, 0.12)" }}
        whileTap={{ scale: 0.98 }}
        onClick={() => onInspect(focus.id)}
        className="focus-ring flex w-full items-center justify-center gap-1.5 border-t border-grid px-4 py-2
                   font-mono text-[11px] font-semibold uppercase tracking-widest text-zenith-cyan"
      >
        Inspect object <ArrowUpRight size={13} />
      </motion.button>
    </motion.div>
  );
}

function Readout({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-panel/95 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">{label}</p>
      <p className="mt-0.5 font-mono text-lg font-semibold">
        {children}
        {sub && <span className="ml-1.5 text-xs text-stardust">{sub}</span>}
      </p>
    </div>
  );
}
