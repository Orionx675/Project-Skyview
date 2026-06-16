// =============================================================================
// components/TimeMachine.tsx — the "Cosmic Time Machine" (time scrubbing)
// =============================================================================
// Drives Cesium's clock as the single source of truth for simulation time:
//   · Setting viewer.clock.currentTime instantly moves the day/night
//     terminator and sun (Cesium derives them from the clock).
//   · The ZenithTracker reads the same clock (CesiumGlobe wired its
//     timeProvider), so satellite + planet altitude/azimuth re-propagate to
//     the chosen instant — past or future.
//
// Modes:
//   LIVE      clockStep = SYSTEM_CLOCK  → currentTime tracks real time.
//   TRAVEL    paused: shouldAnimate=false, frozen at currentTime.
//             playing: SYSTEM_CLOCK_MULTIPLIER at `rate`× real time.
//
// Closing the panel returns to LIVE so the rest of the app never gets stranded
// in the past.
// =============================================================================

"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Pause, Play, Radio, Rewind, FastForward, X } from "lucide-react";
import { useViewerBridge } from "@/lib/viewerBridge";

interface TimeMachineProps {
  open: boolean;
  onClose: () => void;
}

const SCRUB_RANGE_H = 72; // slider spans ±72 h around the anchor
const SPEEDS = [
  { label: "1 min/s", rate: 60 },
  { label: "10 min/s", rate: 600 },
  { label: "1 hr/s", rate: 3600 },
  { label: "6 hr/s", rate: 21600 },
];

/** Format a Date for a <input type="datetime-local"> (local, minute precision). */
function toInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function TimeMachine({ open, onClose }: TimeMachineProps) {
  const bridge = useViewerBridge();

  const [traveling, setTraveling] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(60);
  const [baseDate, setBaseDate] = useState<Date>(() => new Date());
  const [scrubHours, setScrubHours] = useState(0);
  const [display, setDisplay] = useState<Date>(() => new Date());

  // Imperative clock helpers ------------------------------------------------
  const clockDate = (): Date => {
    if (!bridge) return new Date();
    return bridge.Cesium.JulianDate.toDate(bridge.viewer.clock.currentTime);
  };

  const setClockTime = (date: Date) => {
    if (!bridge) return;
    bridge.viewer.clock.currentTime = bridge.Cesium.JulianDate.fromDate(date);
  };

  const freeze = () => {
    if (!bridge) return;
    const { clock } = bridge.viewer;
    clock.shouldAnimate = false;
    clock.clockStep = bridge.Cesium.ClockStep.TICK_DEPENDENT;
    clock.multiplier = 0;
  };

  const goLive = () => {
    setTraveling(false);
    setPlaying(false);
    setScrubHours(0);
    setBaseDate(new Date());
    if (!bridge) return;
    const { clock } = bridge.viewer;
    clock.shouldAnimate = true;
    clock.clockStep = bridge.Cesium.ClockStep.SYSTEM_CLOCK; // currentTime ← real now
  };

  const jumpTo = (date: Date) => {
    setTraveling(true);
    setPlaying(false);
    setBaseDate(date);
    setScrubHours(0);
    setClockTime(date);
    freeze();
  };

  const onScrub = (hours: number) => {
    setScrubHours(hours);
    setTraveling(true);
    setPlaying(false);
    setClockTime(new Date(baseDate.getTime() + hours * 3_600_000));
    freeze();
  };

  const quickJump = (deltaHours: number) => jumpTo(new Date(clockDate().getTime() + deltaHours * 3_600_000));

  const togglePlay = () => {
    if (!bridge) return;
    const { clock } = bridge.viewer;
    if (playing) {
      // Pause: freeze, and re-anchor the scrubber to where playback stopped.
      setPlaying(false);
      freeze();
      setBaseDate(clockDate());
      setScrubHours(0);
    } else {
      if (!traveling) {
        setBaseDate(new Date());
        setScrubHours(0);
      }
      setTraveling(true);
      setPlaying(true);
      clock.shouldAnimate = true;
      clock.clockStep = bridge.Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
      clock.multiplier = rate;
    }
  };

  const changeRate = (r: number) => {
    setRate(r);
    if (bridge && playing) bridge.viewer.clock.multiplier = r;
  };

  // Live readout: poll the clock a few times a second for the display ------
  useEffect(() => {
    if (!open || !bridge) return;
    const id = setInterval(() => setDisplay(clockDate()), 250);
    setDisplay(clockDate());
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bridge]);

  // Always return to LIVE when the panel closes/unmounts.
  useEffect(() => {
    if (open) return;
    goLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const deltaMs = display.getTime() - Date.now();
  const offsetLabel = describeOffset(deltaMs);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 48 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="absolute bottom-10 left-1/2 z-30 w-[min(92vw,40rem)] -translate-x-1/2 overflow-hidden
                     rounded-2xl border border-grid bg-panel/90 shadow-2xl shadow-black/60 backdrop-blur-md"
          aria-label="Cosmic Time Machine"
        >
          {/* header */}
          <div className="flex items-center justify-between gap-3 border-b border-grid px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Clock size={15} className={traveling ? "text-aurora" : "text-zenith-cyan"} />
              <h2 className="font-mono text-xs font-bold tracking-[0.2em] text-starlight">COSMIC TIME MACHINE</h2>
              <span
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest
                  ${traveling ? "bg-aurora/15 text-aurora" : "bg-signal/15 text-signal"}`}
              >
                {traveling ? "TIME TRAVEL" : <><span className="pulse-live h-1.5 w-1.5 rounded-full bg-signal" /> LIVE</>}
              </span>
            </div>
            <button
              onClick={onClose}
              aria-label="Close time machine"
              className="rounded-lg p-1.5 text-stardust transition-colors hover:bg-panel-raised hover:text-starlight"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3 p-4">
            {/* big readout */}
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="font-mono text-2xl font-bold tabular-nums text-starlight">
                  {display.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </p>
                <p className="font-mono text-[11px] text-stardust">
                  {display.toLocaleDateString([], { weekday: "short", year: "numeric", month: "short", day: "numeric" })}
                  {" · "}
                  {display.toUTCString().slice(17, 22)} UTC
                </p>
              </div>
              <span className={`font-mono text-xs ${Math.abs(deltaMs) < 1000 ? "text-signal" : "text-aurora"}`}>
                {offsetLabel}
              </span>
            </div>

            {/* datetime picker */}
            <div className="flex items-center gap-2">
              <label htmlFor="tm-picker" className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-faint">
                Jump to
              </label>
              <input
                id="tm-picker"
                type="datetime-local"
                value={toInputValue(traveling ? display : new Date())}
                onChange={(e) => {
                  const d = new Date(e.target.value);
                  if (!Number.isNaN(d.getTime())) jumpTo(d);
                }}
                className="flex-1 rounded-lg border border-grid bg-void/60 px-2.5 py-1.5 font-mono text-xs
                           text-starlight focus:border-zenith-cyan/60 focus:outline-none
                           [color-scheme:dark]"
              />
            </div>

            {/* scrub slider */}
            <div>
              <input
                type="range"
                min={-SCRUB_RANGE_H}
                max={SCRUB_RANGE_H}
                step={0.5}
                value={scrubHours}
                onChange={(e) => onScrub(Number(e.target.value))}
                aria-label="Scrub time, hours from anchor"
                className="w-full accent-(--color-aurora)"
              />
              <div className="flex justify-between font-mono text-[9px] text-faint">
                <span>−72h</span>
                <span>anchor</span>
                <span>+72h</span>
              </div>
            </div>

            {/* transport controls */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => quickJump(-24)}
                className="rounded-lg border border-grid px-2.5 py-1.5 font-mono text-[10px] text-stardust transition-colors hover:bg-panel-raised hover:text-starlight"
              >
                −1d
              </button>
              <button
                onClick={() => quickJump(-1)}
                className="rounded-lg border border-grid px-2.5 py-1.5 font-mono text-[10px] text-stardust transition-colors hover:bg-panel-raised hover:text-starlight"
              >
                <Rewind size={12} />
              </button>

              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={togglePlay}
                className="flex items-center gap-1.5 rounded-lg border border-aurora/50 bg-aurora/15 px-3 py-1.5
                           font-mono text-[11px] font-bold uppercase tracking-wider text-aurora transition-colors hover:bg-aurora/25"
              >
                {playing ? <Pause size={13} /> : <Play size={13} />}
                {playing ? "Pause" : "Play"}
              </motion.button>

              <button
                onClick={() => quickJump(1)}
                className="rounded-lg border border-grid px-2.5 py-1.5 font-mono text-[10px] text-stardust transition-colors hover:bg-panel-raised hover:text-starlight"
              >
                <FastForward size={12} />
              </button>
              <button
                onClick={() => quickJump(24)}
                className="rounded-lg border border-grid px-2.5 py-1.5 font-mono text-[10px] text-stardust transition-colors hover:bg-panel-raised hover:text-starlight"
              >
                +1d
              </button>

              {/* speed */}
              <select
                value={rate}
                onChange={(e) => changeRate(Number(e.target.value))}
                aria-label="Playback speed"
                className="rounded-lg border border-grid bg-void/60 px-2 py-1.5 font-mono text-[10px] text-starlight focus:outline-none"
              >
                {SPEEDS.map((s) => (
                  <option key={s.rate} value={s.rate}>
                    {s.label}
                  </option>
                ))}
              </select>

              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={goLive}
                disabled={!traveling}
                className="ml-auto flex items-center gap-1.5 rounded-lg border border-signal/50 bg-signal/10 px-3 py-1.5
                           font-mono text-[11px] font-bold uppercase tracking-wider text-signal transition-colors
                           hover:bg-signal/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Radio size={12} /> Live
              </motion.button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/** "+3d 04h", "−18h 20m", or "now". */
function describeOffset(ms: number): string {
  if (Math.abs(ms) < 1000) return "● now";
  const sign = ms > 0 ? "+" : "−";
  let s = Math.abs(Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${sign}${d}d ${String(h).padStart(2, "0")}h`;
  if (h > 0) return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
  return `${sign}${m}m`;
}
