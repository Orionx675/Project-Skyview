// =============================================================================
// components/ClearSkyPlanner.tsx — the "Clear Sky" stargazing planner
// =============================================================================
// A general-public-friendly panel that cross-references upcoming bright
// satellite passes with the live Open-Meteo forecast to surface "Golden
// Windows" — clear-sky, dark passes you could actually go outside and watch.
//
// Keeps the app's aerospace dark theme but stays digestible for casual users:
// one celebratory headline, then a scannable timeline of cards with a weather
// icon, a friendly sentence, and the few numbers that matter. Responsive —
// a right-docked panel on desktop, a bottom sheet on mobile.
// =============================================================================

"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  Cloud,
  CloudMoon,
  CloudRain,
  CloudSun,
  Cloudy,
  Loader2,
  MapPin,
  Moon,
  Sparkles,
  Sun,
  Telescope,
  X,
} from "lucide-react";
import { useClearSky } from "@/hooks/useClearSky";
import { goldenDarkWindows, selectBestWindows, type SkyQuality, type SkyWindow } from "@/lib/clearSky";
import type { Observer } from "@/lib/layers";

interface ClearSkyPlannerProps {
  open: boolean;
  observer: Observer;
  onClose: () => void;
  /** Optional: camera-lock onto a pass's object ("Track this pass"). */
  onTrackPass?: (objectId: string) => void;
}

/** Per-quality visual language. */
const QUALITY_STYLE: Record<
  SkyQuality,
  { pill: string; border: string; label: string; accent: string }
> = {
  golden: {
    pill: "bg-amber/15 text-amber",
    border: "border-amber/40",
    label: "GOLDEN WINDOW",
    accent: "text-amber",
  },
  good: {
    pill: "bg-zenith-cyan/15 text-zenith-cyan",
    border: "border-grid",
    label: "FAIR",
    accent: "text-zenith-cyan",
  },
  poor: {
    pill: "bg-grid text-stardust",
    border: "border-grid",
    label: "POOR",
    accent: "text-stardust",
  },
};

export default function ClearSkyPlanner({ open, observer, onClose, onTrackPass }: ClearSkyPlannerProps) {
  const { loading, error, windows, hasSatellites, fetchedAt } = useClearSky(observer, open);

  // Headline reflects ALL windows (e.g. total golden count); the list shows
  // only the most watchable handful so it stays scannable.
  const shown = useMemo(() => selectBestWindows(windows, 8), [windows]);
  const headline = useMemo(() => buildHeadline(windows, hasSatellites, loading), [windows, hasSatellites, loading]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          className="absolute inset-x-2 bottom-2 z-30 flex max-h-[80vh] flex-col overflow-hidden rounded-2xl
                     border border-grid bg-panel/95 shadow-2xl shadow-black/60 backdrop-blur-md
                     sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-4 sm:w-[26rem]"
          aria-label="Clear Sky stargazing planner"
        >
          {/* ------------------------------------------------- header ----- */}
          <div className="flex items-start justify-between gap-3 border-b border-grid px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-zenith-cyan/10 text-zenith-cyan">
                <Telescope size={18} strokeWidth={2} />
              </span>
              <div>
                <h2 className="text-sm font-bold tracking-tight text-starlight">Clear Sky Planner</h2>
                <p className="text-[11px] text-stardust">Your next 24 hours of stargazing</p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close Clear Sky planner"
              className="rounded-lg p-1.5 text-stardust transition-colors hover:bg-panel-raised hover:text-starlight"
            >
              <X size={16} />
            </button>
          </div>

          {/* location + freshness */}
          <div className="flex items-center justify-between gap-2 border-b border-grid px-5 py-2 text-[11px] text-faint">
            <span className="flex items-center gap-1.5">
              <MapPin size={12} />
              {observer.label ?? `${observer.latitude.toFixed(2)}°, ${observer.longitude.toFixed(2)}°`}
            </span>
            {fetchedAt && <span>Updated {fetchedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
          </div>

          {/* ----------------------------------------------- content ----- */}
          <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
            {/* headline banner */}
            <motion.div
              key={headline.title}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mb-4 rounded-xl border p-4 ${headline.border}`}
            >
              <div className="flex items-center gap-2">
                <headline.Icon size={18} className={headline.accent} />
                <h3 className={`text-sm font-bold ${headline.accent}`}>{headline.title}</h3>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-stardust">{headline.sub}</p>
            </motion.div>

            {/* states */}
            {loading ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Loader2 size={26} className="animate-spin text-zenith-cyan" />
                <p className="font-mono text-xs text-stardust">Checking the skies…</p>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-alert/30 bg-alert/5 p-4 text-xs leading-relaxed text-alert">
                Couldn&apos;t load the forecast ({error}). The orbital passes are still accurate — only
                the weather overlay is missing.
              </div>
            ) : windows.length === 0 ? (
              <div className="rounded-xl border border-grid bg-void/40 p-4 text-xs leading-relaxed text-stardust">
                {hasSatellites
                  ? "No bright passes clear the horizon in the next 24 hours from here. Try a different location."
                  : "Enable the Space Stations or Brightest Satellites layer to forecast passes."}
              </div>
            ) : (
              <motion.ul
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
                className="space-y-3"
              >
                {shown.map((w) => (
                  <WindowCard key={`${w.objectId}-${w.peak.getTime()}`} window={w} onTrackPass={onTrackPass} />
                ))}
              </motion.ul>
            )}
          </div>

          {/* ----------------------------------------------- footer ------ */}
          <div className="border-t border-grid px-5 py-2.5 text-[10px] leading-relaxed text-faint">
            Passes via SGP4 (satellite.js) · Cloud &amp; rain via Open-Meteo. A “Golden Window” is a
            bright pass under clear skies (&lt;20% cloud).
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------------- */

function WindowCard({ window: w, onTrackPass }: { window: SkyWindow; onTrackPass?: (id: string) => void }) {
  const style = QUALITY_STYLE[w.quality];
  const WxIcon = weatherIcon(w);
  const today = w.peak.toDateString() === new Date().toDateString();
  const day = today ? "Tonight" : w.peak.toLocaleDateString([], { weekday: "short" });
  const time = w.peak.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <motion.li
      variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
      className={`overflow-hidden rounded-xl border bg-void/40 ${style.border}`}
    >
      <div className="flex gap-3 p-3.5">
        {/* weather glyph */}
        <span className={`mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-panel ${style.accent}`}>
          <WxIcon size={22} strokeWidth={1.8} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-starlight">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: w.color }} />
              {w.name}
            </span>
            <span
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider ${style.pill}`}
            >
              {w.quality === "golden" && <Sparkles size={9} />}
              {style.label}
            </span>
          </div>

          <p className="mt-0.5 text-[11px] font-medium text-stardust">
            {day} · <span className={`font-mono ${style.accent}`}>{time}</span>
          </p>

          <p className="mt-1.5 text-[11px] leading-relaxed text-stardust">{w.message}</p>

          {/* stat strip */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-faint">
            <span>PEAK <span className="text-starlight">{Math.round(w.maxAltitude)}°</span></span>
            {w.cloudCover != null && (
              <span>CLOUD <span className="text-starlight">{w.cloudCover}%</span></span>
            )}
            {w.precipProbability != null && (
              <span>RAIN <span className="text-starlight">{w.precipProbability}%</span></span>
            )}
            <span>{w.isDark ? "DARK SKY" : "DAYLIGHT"}</span>
          </div>

          {onTrackPass && (
            <button
              onClick={() => onTrackPass(w.objectId)}
              className="mt-2.5 flex items-center gap-1 font-mono text-[10px] font-semibold uppercase
                         tracking-wider text-zenith-cyan transition-opacity hover:opacity-80"
            >
              Track this pass <ArrowUpRight size={12} />
            </button>
          )}
        </div>
      </div>
    </motion.li>
  );
}

/* ------------------------------- helpers --------------------------------- */

/** Pick a weather glyph from cloud cover, rain chance and day/night. */
function weatherIcon(w: SkyWindow) {
  if (w.precipProbability != null && w.precipProbability >= 40) return CloudRain;
  const cloud = w.cloudCover ?? 0;
  if (cloud < 20) return w.isDark ? Moon : Sun;
  if (cloud < 50) return w.isDark ? CloudMoon : CloudSun;
  if (cloud < 80) return Cloud;
  return Cloudy;
}

/** Adaptive headline driven by the best window available. */
function buildHeadline(windows: SkyWindow[], hasSatellites: boolean, loading: boolean) {
  if (loading) {
    return {
      Icon: Loader2,
      accent: "text-zenith-cyan",
      border: "border-grid",
      title: "Reading the forecast…",
      sub: "Cross-referencing upcoming passes with live cloud cover.",
    };
  }

  const golden = goldenDarkWindows(windows);
  if (golden.length > 0) {
    const next = golden[0];
    const time = next.peak.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return {
      Icon: Sparkles,
      accent: "text-amber",
      border: "border-amber/40 bg-amber/5",
      title: golden.length === 1 ? "Perfect conditions tonight!" : `${golden.length} golden windows ahead!`,
      sub: `${next.name} will be brightly visible with clear, dark skies at ${time}. Wrap up warm and look up.`,
    };
  }

  const anyGolden = windows.some((w) => w.quality === "golden");
  if (anyGolden) {
    return {
      Icon: Sun,
      accent: "text-zenith-cyan",
      border: "border-zenith-cyan/30 bg-zenith-cyan/5",
      title: "Clear skies ahead",
      sub: "Skies are clear, but the bright passes fall in daylight. Catch a clear pass after dark for the best view.",
    };
  }

  const anyGood = windows.some((w) => w.quality === "good");
  if (anyGood) {
    return {
      Icon: CloudSun,
      accent: "text-zenith-cyan",
      border: "border-grid",
      title: "Partly cloudy tonight",
      sub: "A few passes are coming up — you might catch one between the clouds.",
    };
  }

  if (windows.length > 0) {
    return {
      Icon: Cloudy,
      accent: "text-stardust",
      border: "border-grid",
      title: "Cloudy skies tonight",
      sub: "Tough viewing conditions for the next 24 hours. The passes are listed below in case the forecast shifts.",
    };
  }

  return {
    Icon: Telescope,
    accent: "text-stardust",
    border: "border-grid",
    title: "No bright passes right now",
    sub: hasSatellites
      ? "Nothing clears the horizon here in the next 24 hours — try another location."
      : "Turn on a bright-satellite layer to see when the ISS and others fly over.",
  };
}
