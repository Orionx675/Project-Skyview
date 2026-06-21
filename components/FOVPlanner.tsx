// =============================================================================
// components/FOVPlanner.tsx — astrophotography FOV planner panel
// =============================================================================
// The Stellarium-style planning UI: pick a sensor, dial a focal length, and
// read off exactly when (and for how long) the locked target crosses your
// camera frame. All 3D work happens in useFovPlanner — this component is
// pure controls + readouts.
//
// Default rig per the brief: Sony IMX890 (8.19 × 6.14 mm) @ 50 mm.
// =============================================================================

"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Crosshair, Frame, X } from "lucide-react";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import { useFovPlanner } from "@/hooks/useFovPlanner";
import { useTrackedObject } from "@/hooks/useTracker";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSheetDrag } from "@/lib/sheetDrag";
import {
  DEFAULT_FOCAL_LENGTH_MM,
  DEFAULT_SENSOR,
  fovDegrees,
  SENSOR_PRESETS,
} from "@/lib/fovMath";
import type { Observer } from "@/lib/layers";

interface FOVPlannerProps {
  open: boolean;
  /** The camera-locked object — the planner's target. */
  targetId: string | null;
  observer: Observer;
  onClose: () => void;
}

export default function FOVPlanner({ open, targetId, observer, onClose }: FOVPlannerProps) {
  const isMobile = useIsMobile();
  const { sheetProps, handleProps } = useSheetDrag(onClose, isMobile);
  const [focalLengthMm, setFocalLengthMm] = useState(DEFAULT_FOCAL_LENGTH_MM);
  const [sensorId, setSensorId] = useState(DEFAULT_SENSOR.id);
  const [recenterKey, setRecenterKey] = useState(0);

  const sensor = SENSOR_PRESETS.find((s) => s.id === sensorId) ?? DEFAULT_SENSOR;
  const live = useTrackedObject(open ? targetId : null);

  const { aim, transit, drifted } = useFovPlanner({
    active: open && targetId !== null,
    targetId,
    observer,
    focalLengthMm,
    sensor,
    recenterKey,
  });

  const relock = () => setRecenterKey((k) => k + 1);

  const hFov = fovDegrees(sensor.widthMm, focalLengthMm);
  const vFov = fovDegrees(sensor.heightMm, focalLengthMm);

  return (
    <>
      {/* Floating re-lock chip: appears when the user free-looks off-aim */}
      <AnimatePresence>
        {open && targetId && drifted && (
          <motion.button
            initial={{ opacity: 0, y: 18, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={relock}
            className="focus-ring absolute bottom-32 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5
                       rounded-full border border-amber/50 bg-void/85 px-4 py-2 font-mono text-[11px]
                       font-bold tracking-widest text-amber shadow-panel backdrop-blur-xl
                       transition-colors hover:bg-amber/15 md:bottom-12"
          >
            <Crosshair size={13} /> RE-LOCK TARGET
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.aside
          initial={isMobile ? { opacity: 0, y: 80 } : { opacity: 0, x: 48 }}
          animate={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, x: 0 }}
          exit={isMobile ? { opacity: 0, y: 80 } : { opacity: 0, x: 48 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          {...sheetProps}
          className="glass-raised scrollbar-thin absolute inset-x-2 bottom-20 z-20 max-h-[58vh] overflow-y-auto rounded-xl
                     md:inset-x-auto md:right-4 md:top-4 md:bottom-auto md:max-h-[calc(100vh-6rem)] md:w-80"
          aria-label="Field of view planner"
        >
          {/* mobile grab handle — drag down to dismiss the sheet */}
          <div {...handleProps} className="flex cursor-grab touch-none justify-center py-2.5 active:cursor-grabbing md:hidden">
            <span className="h-1.5 w-12 rounded-full bg-grid" />
          </div>

          {/* ------------------------------------------------- header ----- */}
          <div className="flex items-center justify-between border-b border-grid px-4 py-3">
            <h2 className="flex items-center gap-1.5 font-mono text-xs font-bold tracking-[0.2em] text-zenith-cyan">
              <Frame size={13} /> FOV PLANNER
            </h2>
            <button
              onClick={onClose}
              aria-label="Close FOV planner"
              className="focus-ring rounded p-1 text-stardust transition-colors hover:bg-panel-raised hover:text-starlight"
            >
              <X size={15} />
            </button>
          </div>

          {!targetId ? (
            <p className="p-4 text-xs leading-relaxed text-stardust">
              Lock a target first — search the sky above (try{" "}
              <span className="font-mono text-zenith-cyan">ISS</span>) and hit Enter, then reopen
              the planner.
            </p>
          ) : (
            <div className="space-y-4 p-4">
              {/* ------------------------------------------- target row ----- */}
              <div className="rounded-lg border border-grid bg-void/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-sm font-semibold text-starlight">
                    {live?.name ?? "—"}
                  </span>
                  {live && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider
                        ${live.aboveHorizon ? "bg-signal/15 text-signal" : "bg-alert/15 text-alert"}`}
                    >
                      {live.aboveHorizon ? "IN SKY" : "BELOW HZN"}
                    </span>
                  )}
                </div>
                {live && (
                  <p className="mt-1.5 font-mono text-[11px] text-stardust">
                    LIVE&nbsp;&nbsp;ALT{" "}
                    <AnimatedNumber value={live.altitude} decimals={1} suffix="°" className="text-zenith-cyan" />
                    &nbsp;&nbsp;AZ{" "}
                    <AnimatedNumber value={live.azimuth} decimals={1} suffix="°" className="text-zenith-cyan" />
                  </p>
                )}
                {aim && (
                  <p className="mt-0.5 font-mono text-[11px] text-faint">
                    FRAME AIM&nbsp;&nbsp;ALT {aim.altitude.toFixed(1)}° · AZ {aim.azimuth.toFixed(1)}°
                  </p>
                )}
              </div>

              {/* ---------------------------------------------- sensor ----- */}
              <div>
                <label
                  htmlFor="fov-sensor"
                  className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-faint"
                >
                  Sensor
                </label>
                <select
                  id="fov-sensor"
                  value={sensorId}
                  onChange={(e) => setSensorId(e.target.value)}
                  className="w-full rounded-lg border border-grid bg-void/60 px-2.5 py-2 font-mono
                             text-xs text-starlight focus:border-zenith-cyan/60 focus:outline-none"
                >
                  {SENSOR_PRESETS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} — {s.widthMm} × {s.heightMm} mm
                    </option>
                  ))}
                </select>
              </div>

              {/* ----------------------------------------- focal length ----- */}
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label
                    htmlFor="fov-focal"
                    className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint"
                  >
                    Focal length
                  </label>
                  <span className="font-mono text-sm font-bold text-zenith-cyan">{focalLengthMm} mm</span>
                </div>
                <input
                  id="fov-focal"
                  type="range"
                  min={12}
                  max={600}
                  step={1}
                  value={focalLengthMm}
                  onChange={(e) => setFocalLengthMm(Number(e.target.value))}
                  className="w-full accent-(--color-zenith-cyan)"
                  aria-valuetext={`${focalLengthMm} millimeters`}
                />
                {/* Live optics readout: FOV = 2·atan(sensor / 2f) */}
                <p className="mt-1.5 text-center font-mono text-[11px] text-stardust">
                  FIELD OF VIEW{" "}
                  <AnimatedNumber value={hFov} decimals={2} suffix="°" className="text-aurora" /> ×{" "}
                  <AnimatedNumber value={vFov} decimals={2} suffix="°" className="text-aurora" />
                </p>
              </div>

              {/* -------------------------------------- transit window ----- */}
              <div
                className={`rounded-lg border p-3 font-mono text-xs leading-relaxed
                  ${
                    transit?.status === "never"
                      ? "border-alert/30 bg-alert/5"
                      : "border-signal/30 bg-signal/5"
                  }`}
              >
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-faint">
                  Frame transit · next {live?.kind === "planet" ? "90" : "15"} min
                </p>
                {!transit ? (
                  <p className="text-faint">COMPUTING PATH…</p>
                ) : transit.status === "never" ? (
                  <p className="text-alert">
                    Target never enters this frame — zoom out (shorter focal) or re-center.
                  </p>
                ) : transit.status === "always" ? (
                  <p className="text-signal">Target stays in frame for the whole window.</p>
                ) : (
                  <>
                    <p className="text-starlight">
                      IN FRAME {fmtClock(transit.enter)} → {fmtClock(transit.exit)}
                    </p>
                    <p className="mt-0.5 font-bold text-signal">
                      {fmtDuration(transit.durationS ?? 0)} across the sensor
                    </p>
                  </>
                )}
              </div>

              {/* -------------------------------------------- actions ------ */}
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={relock}
                  className="focus-ring flex flex-1 items-center justify-center gap-1.5 rounded-lg border
                             border-zenith-cyan/40 bg-zenith-cyan/10 px-3 py-2 text-[10px] font-semibold
                             uppercase tracking-wider text-zenith-cyan transition-colors hover:bg-zenith-cyan/20"
                >
                  <Crosshair size={13} /> Re-lock on target
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={onClose}
                  className="focus-ring rounded-lg border border-grid px-3 py-2 text-[10px] font-semibold
                             uppercase tracking-wider text-stardust transition-colors hover:bg-panel-raised"
                >
                  Exit
                </motion.button>
              </div>

              <p className="text-[10px] leading-relaxed text-faint">
                Drag the sky to look around (compass letters mark N·E·S·W on the horizon), scroll
                to zoom. The frame stays frozen like a tripod; the glowing line is the target's
                predicted path. Wander off and a re-lock chip appears. Click another object on the
                globe to retarget.
              </p>
            </div>
          )}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function fmtClock(d?: Date): string {
  if (!d) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDuration(s: number): string {
  if (s < 90) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${s % 60} s`;
}
