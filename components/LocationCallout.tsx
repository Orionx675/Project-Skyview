// =============================================================================
// components/LocationCallout.tsx — bottom-right reverse-geocode readout
// =============================================================================
// When the user clicks the globe, the page hands this component the picked
// { latitude, longitude }. It reverse-geocodes the point (via /api/geocode)
// and animates a sleek callout in from the bottom-right showing the place
// name — with a spinner while Nominatim resolves, and a graceful "Open ocean"
// fallback for unnamed water. Auto-dismisses after a few seconds; closable.
// =============================================================================

"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MapPin, Waves, X } from "lucide-react";
import { reverseGeocode, type GeocodeResult } from "@/lib/geocode";

interface LocationCalloutProps {
  /** The most recently picked point, or null. A new object identity (or new
   *  coordinates) triggers a fresh lookup + re-entry animation. */
  location: { latitude: number; longitude: number } | null;
}

/** Auto-hide the callout this long after a successful resolve (ms). */
const AUTO_DISMISS_MS = 8000;

export default function LocationCallout({ location }: LocationCalloutProps) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GeocodeResult | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lat = location?.latitude ?? null;
  const lon = location?.longitude ?? null;

  useEffect(() => {
    if (lat == null || lon == null) return;

    let cancelled = false;
    setVisible(true);
    setLoading(true);
    setResult(null);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);

    reverseGeocode(lat, lon)
      .then((res) => {
        if (cancelled) return;
        setResult(res);
      })
      .catch(() => {
        if (!cancelled) setResult({ name: null, ocean: false }); // soft-fail
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        // Linger, then fade out on its own; clicking again resets the timer.
        dismissTimer.current = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
      });

    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  const isOcean = result?.ocean || (!loading && !result?.name);
  const title = loading
    ? "Identifying location…"
    : isOcean
      ? "Open ocean"
      : (result?.name ?? "Unknown region");

  return (
    <AnimatePresence>
      {visible && lat != null && lon != null && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 360, damping: 30 }}
          className="absolute bottom-10 right-4 z-20 w-64 overflow-hidden rounded-xl border border-grid
                     bg-panel/90 shadow-2xl shadow-black/50 backdrop-blur-md"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3 p-3.5">
            {/* state glyph */}
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zenith-cyan/10 text-zenith-cyan">
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : isOcean ? (
                <Waves size={18} />
              ) : (
                <MapPin size={18} />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">
                Selected location
              </p>
              <AnimatePresence mode="wait">
                <motion.p
                  key={title}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  className="mt-0.5 truncate text-sm font-semibold text-starlight"
                  title={result?.display ?? title}
                >
                  {title}
                </motion.p>
              </AnimatePresence>
              <p className="mt-1 font-mono text-[10px] text-stardust">
                {lat.toFixed(4)}°, {lon.toFixed(4)}°
              </p>
            </div>

            <button
              onClick={() => setVisible(false)}
              aria-label="Dismiss location callout"
              className="rounded p-1 text-faint transition-colors hover:bg-panel-raised hover:text-starlight"
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
