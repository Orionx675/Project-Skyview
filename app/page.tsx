// =============================================================================
// app/page.tsx — Project Zenith mission dashboard (Round 2)
// =============================================================================
// Composition root. Owns exactly the USER-INTENT state — observer, layers,
// modal selection, camera lock, drawer, intro phase — and re-renders only
// when those change. All per-second live data flows through the ZenithTracker
// engine (<TrackerProvider>); the Cesium globe bypasses React entirely.
//
// Choreography: the dashboard mounts immediately BEHIND the opaque
// IntroOverlay (Cesium boots + TLEs sync during the show). When the overlay
// lifts, `introDone` flips and the header/sidebar/telemetry play their
// entrances in sequence — the reveal looks orchestrated because it is.
// =============================================================================

"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Sidebar from "@/components/Sidebar";
import TelemetryPanel from "@/components/TelemetryPanel";
import HeaderStats from "@/components/HeaderStats";
import ObjectModal from "@/components/ObjectModal";
import SearchBar from "@/components/SearchBar";
import IntroOverlay from "@/components/IntroOverlay";
import FOVPlanner from "@/components/FOVPlanner";
import ClearSkyPlanner from "@/components/ClearSkyPlanner";
import LocationCallout from "@/components/LocationCallout";
import RegaliaTab from "@/components/RegaliaTab";
import TimeMachine from "@/components/TimeMachine";
import { Clock, Telescope } from "lucide-react";
import { TrackerProvider, useTrackedObject } from "@/hooks/useTracker";
import { DATA_LAYERS, type Observer } from "@/lib/layers";

const CesiumGlobe = dynamic(() => import("@/components/CesiumGlobe"), {
  ssr: false,
  loading: () => <GlobeFallback />,
});

// Default observer: New Delhi. Replaced the moment the user clicks the globe
// or grants geolocation — this just guarantees a meaningful first paint.
const DEFAULT_OBSERVER: Observer = {
  latitude: 28.6139,
  longitude: 77.209,
  label: "New Delhi, IN (default)",
};

// Shared entrance: rises into place once the intro lifts.
const enter = (delay: number) => ({
  initial: { opacity: 0, y: -16 },
  transition: { type: "spring" as const, stiffness: 260, damping: 26, delay },
});

export default function DashboardPage() {
  // --------------------------- user-intent state (NOT live data) -----------
  const [introDone, setIntroDone] = useState(false);
  const [observer, setObserver] = useState<Observer>(DEFAULT_OBSERVER);
  const [locating, setLocating] = useState(false);
  const [enabledLayerIds, setEnabledLayerIds] = useState<Set<string>>(
    () => new Set(DATA_LAYERS.filter((l) => l.defaultEnabled).map((l) => l.id))
  );
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null); // modal
  const [lockedObjectId, setLockedObjectId] = useState<string | null>(null); // camera lock
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fovPlannerOpen, setFovPlannerOpen] = useState(false);
  const [clearSkyOpen, setClearSkyOpen] = useState(false);
  // Top-level mode: the satellite tracker, or the "Regalia" planetarium tab.
  const [mode, setMode] = useState<"tracker" | "regalia">("tracker");
  // The most recently picked point — drives the reverse-geocode callout. Null
  // on load so the callout doesn't fire for the default observer.
  const [pickedLocation, setPickedLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [timeMachineOpen, setTimeMachineOpen] = useState(false);

  // The planner plans a shot OF the locked target — no lock, no planner.
  useEffect(() => {
    if (!lockedObjectId && fovPlannerOpen) setFovPlannerOpen(false);
  }, [lockedObjectId, fovPlannerOpen]);

  // ----------------------------------------------------------- actions -----
  const finishIntro = useCallback(() => setIntroDone(true), []);

  const toggleLayer = useCallback((layerId: string) => {
    setEnabledLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }, []);

  const selectLocation = useCallback((latitude: number, longitude: number) => {
    setObserver({ latitude, longitude, label: "Selected coordinate" });
    // New object identity each click so the callout re-fetches + re-animates,
    // even if the same spot is clicked twice.
    setPickedLocation({ latitude, longitude });
  }, []);

  // Manual lat/lon entry from the sidebar. Setting the observer drives both the
  // ZenithTracker origin and CesiumGlobe's flyTo (its observer effect).
  const setCoordinates = useCallback((latitude: number, longitude: number) => {
    setObserver({ latitude, longitude, label: "Manual coordinates" });
    setPickedLocation({ latitude, longitude });
  }, []);

  // Clicking an object normally opens the inspector modal; while the FOV
  // planner is up it RETARGETS the planner instead (click-to-target).
  const inspectObject = useCallback(
    (id: string) => {
      if (fovPlannerOpen) setLockedObjectId(id);
      else setSelectedObjectId(id);
    },
    [fovPlannerOpen]
  );
  const closeModal = useCallback(() => setSelectedObjectId(null), []);
  const targetLock = useCallback((id: string) => setLockedObjectId(id), []);
  const unlock = useCallback(() => setLockedObjectId(null), []);

  // Lock from the inspector modal: engage the camera lock and close the modal
  // so the tracked view + orbit trail are unobstructed.
  const lockFromModal = useCallback((id: string) => {
    setLockedObjectId(id);
    setSelectedObjectId(null);
  }, []);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setObserver({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          heightM: pos.coords.altitude ?? 0,
          label: "Your location (GPS)",
        });
        setPickedLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false), // denied/unavailable — keep current observer
      { enableHighAccuracy: false, timeout: 10_000 }
    );
  }, []);

  // Highlight + orbit trail follow whichever focus exists; the camera lock
  // is its own channel.
  const focusObjectId = lockedObjectId ?? selectedObjectId;

  // ------------------------------------------------------------ layout -----
  return (
    <TrackerProvider observer={observer} enabledLayerIds={enabledLayerIds}>
      {/* Boot sequence — dashboard loads underneath it (see header note). */}
      <AnimatePresence>
        {!introDone && <IntroOverlay key="intro" onComplete={finishIntro} />}
      </AnimatePresence>

      <div className="flex h-dvh flex-col">
        {/* ================= header / status bar ================= */}
        <motion.header
          {...enter(0.05)}
          animate={introDone ? { opacity: 1, y: 0 } : {}}
          className="flex h-14 shrink-0 items-center gap-3 border-b border-grid bg-panel/80 px-4 backdrop-blur-sm"
        >
          {/* Mobile drawer trigger (tracker mode only) */}
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open control panel"
            className={`rounded-lg border border-grid p-2 text-stardust transition-colors
                       hover:bg-panel-raised hover:text-starlight md:hidden ${
                         mode === "tracker" ? "" : "hidden"
                       }`}
          >
            <span className="block h-0.5 w-4 bg-current" />
            <span className="mt-1 block h-0.5 w-4 bg-current" />
            <span className="mt-1 block h-0.5 w-4 bg-current" />
          </button>

          <h1 className="flex items-baseline gap-2">
            <span className="text-base font-bold tracking-tight text-starlight">PROJECT&nbsp;SKYVIEW</span>
            <span className="hidden text-[11px] uppercase tracking-[0.25em] text-stardust lg:inline">
              The Celestial Eye
            </span>
          </h1>

          {mode === "tracker" && (
            <span className="flex items-center gap-1.5 rounded-full border border-signal/30 bg-signal/10 px-2.5 py-1">
              <span className="pulse-live h-1.5 w-1.5 rounded-full bg-signal" />
              <span className="font-mono text-[10px] font-bold tracking-widest text-signal">LIVE</span>
            </span>
          )}

          {/* Mode tabs: Tracker ⇄ Regalia */}
          <div className="flex shrink-0 items-center rounded-full border border-grid bg-void/50 p-0.5">
            {(["tracker", "regalia"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`rounded-full px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest
                  transition-colors ${
                    mode === m
                      ? m === "regalia"
                        ? "bg-aurora/20 text-aurora"
                        : "bg-zenith-cyan/20 text-zenith-cyan"
                      : "text-stardust hover:text-starlight"
                  }`}
              >
                {m === "regalia" ? "✦ Regalia" : "Tracker"}
              </button>
            ))}
          </div>

          {/* Tracker-only header controls */}
          {mode === "tracker" && (
            <>
              {/* Sky-object search → camera target lock */}
              <div className="hidden flex-1 justify-center px-4 sm:flex">
                <SearchBar onTargetLock={targetLock} />
              </div>

              {/* Cosmic Time Machine launcher */}
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setTimeMachineOpen((v) => !v)}
                aria-pressed={timeMachineOpen}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono
                  text-[10px] font-bold tracking-widest transition-colors
                  ${
                    timeMachineOpen
                      ? "border-aurora/60 bg-aurora/15 text-aurora"
                      : "border-grid text-stardust hover:bg-panel-raised hover:text-starlight"
                  }`}
              >
                <Clock size={13} />
                <span className="hidden sm:inline">TIME</span>
              </motion.button>

              {/* Clear Sky stargazing planner launcher */}
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => {
                  setFovPlannerOpen(false); // avoid two right-docked panels overlapping
                  setClearSkyOpen((v) => !v);
                }}
                aria-pressed={clearSkyOpen}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono
                  text-[10px] font-bold tracking-widest transition-colors
                  ${
                    clearSkyOpen
                      ? "border-zenith-cyan/60 bg-zenith-cyan/15 text-zenith-cyan"
                      : "border-grid text-stardust hover:bg-panel-raised hover:text-starlight"
                  }`}
              >
                <Telescope size={13} />
                <span className="hidden sm:inline">CLEAR SKY</span>
              </motion.button>

              {/* The only live-data consumer in the header — subscribes alone */}
              <HeaderStats />
            </>
          )}

          {mode === "regalia" && (
            <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.25em] text-aurora/70">
              Eyes of Stars
            </span>
          )}
        </motion.header>

        {/* ================= main: sidebar + globe ================= */}
        <main className="flex min-h-0 flex-1">
          {/* Desktop sidebar — tracker mode only (Regalia has its own panel) */}
          {mode === "tracker" && (
            <motion.div
              initial={{ opacity: 0, x: -32 }}
              animate={introDone ? { opacity: 1, x: 0 } : {}}
              transition={{ type: "spring", stiffness: 240, damping: 28, delay: 0.15 }}
              className="hidden md:flex"
            >
              <Sidebar
                observer={observer}
                enabledLayerIds={enabledLayerIds}
                onToggleLayer={toggleLayer}
                onUseMyLocation={useMyLocation}
                onSetCoordinates={setCoordinates}
                locating={locating}
                entranceActive={introDone}
              />
            </motion.div>
          )}

          {/* Mobile drawer — spring slide-in over a fading backdrop */}
          <AnimatePresence>
            {drawerOpen && (
              <motion.div
                className="fixed inset-0 z-40 md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="absolute inset-0 bg-void/70 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
                <motion.div
                  className="absolute inset-y-0 left-0"
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ type: "spring", stiffness: 360, damping: 36 }}
                >
                  <Sidebar
                    observer={observer}
                    enabledLayerIds={enabledLayerIds}
                    onToggleLayer={toggleLayer}
                    onUseMyLocation={useMyLocation}
                    onSetCoordinates={setCoordinates}
                    locating={locating}
                    onClose={() => setDrawerOpen(false)}
                  />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Globe stage */}
          <section className="relative min-w-0 flex-1 bg-void" aria-label="Mission display">
            <CesiumGlobe
              observer={observer}
              selectedObjectId={focusObjectId}
              trackedObjectId={lockedObjectId}
              cameraSuppressed={fovPlannerOpen}
              regaliaActive={mode === "regalia"}
              onSelectLocation={selectLocation}
              onInspectObject={inspectObject}
            />

            {/* Regalia planetarium overlay (its own panels; renders nothing
                when inactive, and the hook tears its primitives down). */}
            <RegaliaTab active={mode === "regalia"} />

            {/* HUD dressing: edge vignette + corner brackets (non-interactive) */}
            <div className="globe-vignette pointer-events-none absolute inset-0 z-[5]" />
            <div className="pointer-events-none absolute inset-3 z-[6]" aria-hidden>
              <span className="absolute left-0 top-0 h-5 w-5 rounded-tl border-l-2 border-t-2 border-zenith-cyan/25" />
              <span className="absolute right-0 top-0 h-5 w-5 rounded-tr border-r-2 border-t-2 border-zenith-cyan/25" />
              <span className="absolute bottom-0 left-0 h-5 w-5 rounded-bl border-b-2 border-l-2 border-zenith-cyan/25" />
              <span className="absolute bottom-0 right-0 h-5 w-5 rounded-br border-b-2 border-r-2 border-zenith-cyan/25" />
            </div>

            {/* ---- tracker-mode overlays (hidden in Regalia) ---- */}
            {mode === "tracker" && (
              <>
                {/* Target-lock chip (top center) */}
                <LockChip lockedId={lockedObjectId} onUnlock={unlock} />

                {/* Astrophotography FOV planner (right panel + sky reticle) */}
                <FOVPlanner
                  open={fovPlannerOpen}
                  targetId={lockedObjectId}
                  observer={observer}
                  onClose={() => setFovPlannerOpen(false)}
                />

                {/* Clear Sky stargazing planner (weather × visible passes) */}
                <ClearSkyPlanner
                  open={clearSkyOpen}
                  observer={observer}
                  onClose={() => setClearSkyOpen(false)}
                  onTrackPass={(id) => {
                    targetLock(id);
                    setClearSkyOpen(false);
                  }}
                />

                {/* Reverse-geocode callout: names the spot you click on the globe */}
                <LocationCallout location={pickedLocation} />

                {/* Cosmic Time Machine — scrubs viewer.clock (terminator, sun,
                    satellites + planets all follow) */}
                <TimeMachine open={timeMachineOpen} onClose={() => setTimeMachineOpen(false)} />
              </>
            )}

            {/* Planner launcher — appears once a target is locked */}
            <AnimatePresence>
              {mode === "tracker" && lockedObjectId && !fovPlannerOpen && (
                <motion.button
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setFovPlannerOpen(true)}
                  className="absolute bottom-10 right-4 z-10 rounded-full border border-zenith-cyan/40
                             bg-panel/90 px-4 py-2.5 font-mono text-[11px] font-bold tracking-widest
                             text-zenith-cyan shadow-lg shadow-black/40 backdrop-blur-md
                             transition-colors hover:bg-zenith-cyan/15"
                >
                  ◱ PLAN SHOT
                </motion.button>
              )}
            </AnimatePresence>

            {/* Floating telemetry readout (above Cesium's credit line) */}
            {mode === "tracker" && (
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={introDone ? { opacity: 1, y: 0 } : {}}
                transition={{ type: "spring", stiffness: 280, damping: 28, delay: 0.3 }}
                className="pointer-events-none absolute bottom-10 left-4 z-10"
              >
                <div className="pointer-events-auto">
                  <TelemetryPanel onInspect={inspectObject} lockedId={lockedObjectId} />
                </div>
              </motion.div>
            )}
          </section>
        </main>

        {/* ================= object detail modal ================= */}
        <ObjectModal
          objectId={selectedObjectId}
          lockedId={lockedObjectId}
          onClose={closeModal}
          onTargetLock={lockFromModal}
        />
      </div>
    </TrackerProvider>
  );
}

/**
 * Floating "target locked" indicator. Lives inside the provider so it can
 * read the live object; auto-releases if the target's layer is toggled off.
 */
function LockChip({ lockedId, onUnlock }: { lockedId: string | null; onUnlock: () => void }) {
  const obj = useTrackedObject(lockedId);

  // Target vanished (layer disabled / TLE dropped) — release the lock.
  useEffect(() => {
    if (lockedId && obj === null) onUnlock();
  }, [lockedId, obj, onUnlock]);

  return (
    <AnimatePresence>
      {lockedId && obj && (
        <motion.div
          initial={{ opacity: 0, y: -16, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.92 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full
                     border border-zenith-cyan/40 bg-panel/90 py-1.5 pl-3 pr-1.5 shadow-lg
                     shadow-black/40 backdrop-blur-md"
        >
          <span className="pulse-live h-1.5 w-1.5 rounded-full bg-zenith-cyan" />
          <span className="font-mono text-[11px] font-semibold tracking-wider text-zenith-cyan">
            TARGET LOCK
          </span>
          <span className="max-w-44 truncate font-mono text-[11px] text-starlight">{obj.name}</span>
          <button
            onClick={onUnlock}
            aria-label="Release target lock"
            className="rounded-full bg-grid/60 px-2 py-0.5 font-mono text-[10px] text-stardust
                       transition-colors hover:bg-alert/20 hover:text-alert"
          >
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Shown while the Cesium chunk streams in: a pure-CSS radar sweep, so the
 * "cosmic radar" identity lands before the 3D engine boots.
 */
function GlobeFallback() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-void">
      <div className="relative h-32 w-32">
        <div className="absolute inset-0 rounded-full border border-grid" />
        <div className="absolute inset-4 rounded-full border border-grid" />
        <div className="absolute inset-8 rounded-full border border-grid" />
        <div
          className="absolute inset-0 animate-spin rounded-full"
          style={{
            animationDuration: "2.4s",
            background:
              "conic-gradient(from 0deg, transparent 0deg, transparent 300deg, rgb(45 212 255 / 0.35) 360deg)",
          }}
        />
        <div className="glow-cyan absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zenith-cyan" />
      </div>
      <p className="font-mono text-xs tracking-[0.3em] text-stardust">INITIALIZING ORBITAL VIEW</p>
    </div>
  );
}
