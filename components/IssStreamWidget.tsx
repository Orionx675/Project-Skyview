// =============================================================================
// components/IssStreamWidget.tsx — "Eyes of the Orbit" live PiP feed
// =============================================================================
// When the camera-locked (tracked) entity is the ISS (ZARYA), this floats a
// picture-in-picture window streaming NASA's live "Earth from the ISS" feed.
//
//   · Draggable anywhere on desktop (a header grab-handle drives Framer Motion
//     drag, constrained to the viewport).
//   · On mobile, swipe the window down to tuck it into a floating "ISS LIVE"
//     pill; tap the pill to restore, or ✕ to dismiss.
//   · Orbital-night aware: ~⅓ of every orbit the ISS is in Earth's shadow and
//     the optical feed goes black, so we estimate eclipse geometrically (see
//     lib/eclipse.ts) and drop a glass overlay explaining the darkness instead.
//
// Self-contained: it reads the tracked object's satrec from the tracker and the
// sim clock from the viewer bridge; it needs no extra page state. Intervals are
// cleared on unmount and all activation state resets when the target changes.
//
// Historical note: NASA's original HDEV (High Definition Earth-Viewing)
// experiment was decommissioned in 2019; this embeds NASA's current live ISS
// feed instead, overridable via NEXT_PUBLIC_ISS_STREAM_URL.
// =============================================================================

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { GripHorizontal, Minus, X, Moon, Radio, VideoOff, RefreshCw } from "lucide-react";
import { useTracker } from "@/hooks/useTracker";
import { useViewerBridge } from "@/lib/viewerBridge";
import { useIsMobile } from "@/hooks/useIsMobile";
import { isSatelliteInEclipse } from "@/lib/eclipse";

/** NORAD catalog number of the ISS (ZARYA) — the activation key. */
const ISS_NORAD_ID = "25544";

/** Eclipse re-check cadence (ms). The shadow boundary moves slowly. */
const ECLIPSE_POLL_MS = 4000;

/** NASA's live ISS feed (HDEV is retired). Overridable at build time. */
const ISS_STREAM_URL =
  process.env.NEXT_PUBLIC_ISS_STREAM_URL ??
  "https://www.youtube.com/embed/live_stream?channel=UCLA_DiR1FfKNvjuUpBHmylQ&autoplay=1&mute=1";

export default function IssStreamWidget({ objectId }: { objectId: string | null }) {
  const tracker = useTracker();
  const bridge = useViewerBridge();
  const isMobile = useIsMobile();
  const dragControls = useDragControls();
  const containerRef = useRef<HTMLDivElement>(null);

  const [minimized, setMinimized] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [eclipsed, setEclipsed] = useState(false);
  const [iframeError, setIframeError] = useState(false);

  // Resolve the locked object to the static catalog entry (satrec + NORAD id).
  const entry = objectId ? tracker.getCatalogEntry(objectId) : null;
  const isIss = entry?.noradId === ISS_NORAD_ID;
  const satrec = entry?.satrec ?? null;

  // Read "now" from the Cesium sim clock when present (so time-travel scrubbing
  // moves the eclipse state too); otherwise wall-clock.
  const currentTime = useCallback((): Date => {
    if (bridge && !bridge.viewer.isDestroyed()) {
      try {
        return bridge.Cesium.JulianDate.toDate(bridge.viewer.clock.currentTime);
      } catch {
        /* viewer mid-teardown — fall through to wall clock */
      }
    }
    return new Date();
  }, [bridge]);

  // Fresh activation whenever the tracked target changes.
  useEffect(() => {
    setMinimized(false);
    setDismissed(false);
    setIframeError(false);
  }, [objectId]);

  // Poll orbital-night (eclipse) state while the ISS feed is active.
  useEffect(() => {
    if (!isIss || !satrec) {
      setEclipsed(false);
      return;
    }
    const compute = () => setEclipsed(isSatelliteInEclipse(satrec, currentTime()));
    compute();
    const id = setInterval(compute, ECLIPSE_POLL_MS);
    return () => clearInterval(id);
  }, [isIss, satrec, currentTime]);

  if (!isIss || dismissed) return null;

  return (
    <div ref={containerRef} className="pointer-events-none fixed inset-0 z-40">
      <AnimatePresence mode="wait">
        {minimized ? (
          /* ----------------------------- minimized pill ------------------- */
          <motion.div
            key="iss-pill"
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 10 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="glass-raised pointer-events-auto absolute bottom-24 right-3 flex items-center gap-2
                       rounded-full py-1.5 pl-3 pr-1.5 md:bottom-10 md:right-4"
          >
            <button
              type="button"
              onClick={() => setMinimized(false)}
              aria-label="Restore ISS live feed"
              className="focus-ring flex items-center gap-2 rounded-full"
            >
              <span className="pulse-live h-2 w-2 rounded-full bg-alert" />
              <Radio size={14} className="text-zenith-cyan" />
              <span className="font-mono text-[10px] font-bold tracking-widest text-starlight">ISS LIVE</span>
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss ISS live feed"
              className="focus-ring grid h-6 w-6 place-items-center rounded-full text-stardust
                         transition-colors hover:bg-alert/20 hover:text-alert"
            >
              <X size={12} />
            </button>
          </motion.div>
        ) : (
          /* ------------------------------- full window -------------------- */
          <motion.div
            key="iss-window"
            drag
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={containerRef}
            dragMomentum={false}
            dragElastic={isMobile ? 0.18 : 0.04}
            onDragEnd={(_e, info) => {
              // Mobile: a firm downward swipe tucks it away into the pill.
              if (isMobile && (info.offset.y > 90 || info.velocity.y > 600)) setMinimized(true);
            }}
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="glass-raised pointer-events-auto absolute bottom-24 right-3 w-[min(86vw,360px)]
                       overflow-hidden rounded-2xl md:bottom-10 md:right-4"
          >
            {/* header — left zone is the drag handle, right zone the controls */}
            <div className="flex items-center justify-between gap-2 border-b border-grid/70 px-3 py-2">
              <div
                onPointerDown={(e) => dragControls.start(e)}
                className="flex flex-1 cursor-grab touch-none items-center gap-2 active:cursor-grabbing"
              >
                <GripHorizontal size={14} className="shrink-0 text-faint" />
                <span className="pulse-live h-1.5 w-1.5 shrink-0 rounded-full bg-alert" />
                <span className="truncate font-mono text-[10px] font-bold tracking-widest text-starlight">
                  ISS · LIVE EARTH VIEW
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  aria-label="Minimize ISS live feed"
                  className="focus-ring grid h-7 w-7 place-items-center rounded-md text-stardust
                             transition-colors hover:bg-panel-raised hover:text-starlight"
                >
                  <Minus size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  aria-label="Close ISS live feed"
                  className="focus-ring grid h-7 w-7 place-items-center rounded-md text-stardust
                             transition-colors hover:bg-alert/20 hover:text-alert"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* video stage */}
            <div className="relative aspect-video bg-black">
              <iframe
                src={ISS_STREAM_URL}
                title="NASA live view of Earth from the International Space Station"
                className="absolute inset-0 h-full w-full"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                referrerPolicy="strict-origin-when-cross-origin"
                loading="lazy"
                onError={() => setIframeError(true)}
              />

              {/* orbital-night overlay — glassmorphic, sits above the feed */}
              <AnimatePresence>
                {eclipsed && !iframeError && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="glass-raised absolute inset-0 z-10 flex flex-col items-center justify-center
                               gap-2 px-5 text-center"
                  >
                    <Moon size={24} className="text-aurora" />
                    <p className="text-xs font-medium leading-relaxed text-starlight">
                      The ISS is currently traversing Earth&apos;s shadow. Optical feed will resume at
                      sunrise.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* stream-load failure fallback */}
              {iframeError && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5
                                bg-void/90 px-5 text-center">
                  <VideoOff size={22} className="text-stardust" />
                  <p className="text-[11px] leading-relaxed text-stardust">
                    The live feed couldn&apos;t load right now.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIframeError(false)}
                    className="focus-ring flex items-center gap-1.5 rounded-lg border border-grid px-3 py-1.5
                               font-mono text-[10px] font-bold uppercase tracking-wider text-zenith-cyan
                               transition-colors hover:bg-zenith-cyan/15"
                  >
                    <RefreshCw size={12} /> Retry
                  </button>
                </div>
              )}
            </div>

            {/* caption strip */}
            <div className="flex items-center justify-between px-3 py-1.5 font-mono text-[9px] uppercase
                            tracking-wider text-faint">
              <span>NASA live · Earth from ISS</span>
              <span className={eclipsed ? "text-aurora" : "text-signal"}>
                {eclipsed ? "Orbital night" : "Daylit pass"}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
