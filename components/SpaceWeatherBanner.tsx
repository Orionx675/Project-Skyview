// =============================================================================
// components/SpaceWeatherBanner.tsx — critical geomagnetic-storm alert bar
// =============================================================================
// A full-width, neon-amber warning that springs down from the very top of the
// viewport whenever an active geomagnetic storm (Kp ≥ 5) is detected — across
// every tab. The Desktop and Mobile shells read the same `severe` flag and
// reserve space for it (see their layouts) so it never hides the header.
//
// Dismissible, but re-arms automatically whenever the storm LEVEL changes, so a
// dismissed G1 alert returns if conditions escalate to G3.
// =============================================================================

"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { useSpaceWeather } from "@/hooks/useSpaceWeather";

export default function SpaceWeatherBanner() {
  const { severe, gScale } = useSpaceWeather();
  const [dismissed, setDismissed] = useState(false);

  // Re-arm whenever the storm level changes (escalation should re-alert).
  useEffect(() => {
    setDismissed(false);
  }, [gScale]);

  const show = severe && !dismissed;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="alert"
          aria-live="assertive"
          initial={{ y: "-100%" }}
          animate={{ y: 0 }}
          exit={{ y: "-100%" }}
          transition={{ type: "spring", stiffness: 360, damping: 34 }}
          className="fixed inset-x-0 top-0 z-[70] flex h-9 items-center justify-center gap-2.5 border-b
                     border-amber/60 bg-amber/15 px-3 text-amber backdrop-blur-xl
                     shadow-[0_6px_24px_-6px_rgba(251,191,36,0.45)]"
        >
          <span className="pulse-live h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
          <AlertTriangle size={14} className="shrink-0" />
          <p className="truncate text-center font-mono text-[11px] font-bold uppercase tracking-[0.14em]">
            Critical Space Weather Warning: Geomagnetic Storm Level G{gScale} Active
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss space weather warning"
            className="focus-ring absolute right-2 grid h-6 w-6 place-items-center rounded-md
                       text-amber/80 transition-colors hover:bg-amber/20 hover:text-amber"
          >
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
