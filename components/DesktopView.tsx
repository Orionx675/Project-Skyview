// =============================================================================
// components/DesktopView.tsx — the desktop dashboard (sidebar + globe)
// =============================================================================
// The original Project SkyView layout, unchanged in behaviour. Renders only at
// ≥768px (the mobile breakpoint is owned by MobileView). All user-intent state
// is owned by page.tsx and arrives via SkyViewProps.
// =============================================================================

"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Telescope, Info, Frame } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import NightVisionToggle from "@/components/NightVisionToggle";
import TelemetryPanel from "@/components/TelemetryPanel";
import HeaderStats from "@/components/HeaderStats";
import ObjectModal from "@/components/ObjectModal";
import SearchBar from "@/components/SearchBar";
import FOVPlanner from "@/components/FOVPlanner";
import ClearSkyPlanner from "@/components/ClearSkyPlanner";
import LocationCallout from "@/components/LocationCallout";
import TimeMachine from "@/components/TimeMachine";
import LockChip from "@/components/LockChip";
import GlobeFallback from "@/components/GlobeFallback";
import AuroraLayer from "@/components/AuroraLayer";
import { useSpaceWeather } from "@/hooks/useSpaceWeather";
import type { SkyViewProps } from "@/components/skyView";

const CesiumGlobe = dynamic(() => import("@/components/CesiumGlobe"), {
  ssr: false,
  loading: () => <GlobeFallback />,
});

const enter = (delay: number) => ({
  initial: { opacity: 0, y: -16 },
  transition: { type: "spring" as const, stiffness: 260, damping: 26, delay },
});

export default function DesktopView(props: SkyViewProps) {
  const {
    introDone,
    observer,
    locating,
    enabledLayerIds,
    selectedObjectId,
    lockedObjectId,
    focusObjectId,
    fovPlannerOpen,
    clearSkyOpen,
    timeMachineOpen,
    mode,
    pickedLocation,
    toggleLayer,
    selectLocation,
    setCoordinates,
    inspectObject,
    closeModal,
    targetLock,
    unlock,
    lockFromModal,
    useMyLocation,
    setFovPlannerOpen,
    setClearSkyOpen,
    setTimeMachineOpen,
  } = props;

  // Reserve space at the top for the geomagnetic-storm banner when it's showing.
  const { severe } = useSpaceWeather();

  return (
    <div className={`flex h-dvh flex-col${severe ? " pt-9" : ""}`}>
      {/* ================= header / status bar ================= */}
      <motion.header
        {...enter(0.05)}
        animate={introDone ? { opacity: 1, y: 0 } : {}}
        className="flex h-14 shrink-0 items-center gap-3 border-b border-grid/80 bg-void/65 px-4 backdrop-blur-xl shadow-[0_8px_24px_-16px_rgba(0,0,0,0.9)]"
      >
        <h1 className="flex items-baseline gap-2">
          <span className="font-display text-base font-bold tracking-tight text-starlight">PROJECT&nbsp;SKYVIEW</span>
          <span className="hidden font-display text-[11px] uppercase tracking-[0.25em] text-stardust lg:inline">
            The Celestial Eye
          </span>
        </h1>

        {mode === "tracker" && (
          <span className="flex items-center gap-1.5 rounded-full border border-signal/30 bg-signal/10 px-2.5 py-1">
            <span className="pulse-live h-1.5 w-1.5 rounded-full bg-signal" />
            <span className="font-mono text-[10px] font-bold tracking-widest text-signal">LIVE</span>
          </span>
        )}

        {/* About → the cinematic landing page at /about */}
        <Link
          href="/about"
          className="focus-ring flex shrink-0 items-center gap-1.5 rounded-full border border-grid px-3 py-1.5
                     font-mono text-[10px] font-bold uppercase tracking-widest text-stardust transition-colors
                     hover:border-aurora/50 hover:bg-aurora/10 hover:text-aurora"
        >
          <Info size={12} /> About
        </Link>

        {mode === "tracker" && (
          <>
            <div className="hidden flex-1 justify-center px-4 sm:flex">
              <SearchBar onTargetLock={targetLock} />
            </div>

            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setTimeMachineOpen(!timeMachineOpen)}
              aria-pressed={timeMachineOpen}
              className={`focus-ring flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono
                text-[10px] font-bold tracking-widest transition-colors
                ${
                  timeMachineOpen
                    ? "border-aurora/60 bg-aurora/15 text-aurora shadow-[0_0_16px_rgba(179,155,255,0.3)]"
                    : "border-grid text-stardust hover:bg-panel-raised hover:text-starlight"
                }`}
            >
              <Clock size={13} />
              <span className="hidden sm:inline">TIME</span>
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                setFovPlannerOpen(false);
                setClearSkyOpen(!clearSkyOpen);
              }}
              aria-pressed={clearSkyOpen}
              className={`focus-ring flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono
                text-[10px] font-bold tracking-widest transition-colors
                ${
                  clearSkyOpen
                    ? "border-zenith-cyan/60 bg-zenith-cyan/15 text-zenith-cyan shadow-[0_0_16px_rgba(56,217,255,0.3)]"
                    : "border-grid text-stardust hover:bg-panel-raised hover:text-starlight"
                }`}
            >
              <Telescope size={13} />
              <span className="hidden sm:inline">CLEAR SKY</span>
            </motion.button>

            <HeaderStats />
            <NightVisionToggle className="h-8 w-8 rounded-full" />
          </>
        )}

      </motion.header>

      {/* ================= main: sidebar + globe ================= */}
      <main className="flex min-h-0 flex-1">
        {mode === "tracker" && (
          <motion.div
            initial={{ opacity: 0, x: -32 }}
            animate={introDone ? { opacity: 1, x: 0 } : {}}
            transition={{ type: "spring", stiffness: 240, damping: 28, delay: 0.15 }}
            className="flex"
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

        {/* Globe stage */}
        <section className="relative min-w-0 flex-1 bg-void" aria-label="Mission display">
          <CesiumGlobe
            observer={observer}
            selectedObjectId={focusObjectId}
            trackedObjectId={lockedObjectId}
            cameraSuppressed={fovPlannerOpen}
            onSelectLocation={selectLocation}
            onInspectObject={inspectObject}
          />

          {/* Procedural auroral-oval rings, scaled by live Kp index. */}
          <AuroraLayer />

          {/* HUD dressing: edge vignette + corner brackets */}
          <div className="globe-vignette pointer-events-none absolute inset-0 z-[5]" />
          <div className="pointer-events-none absolute inset-3 z-[6]" aria-hidden>
            <span className="absolute left-0 top-0 h-5 w-5 rounded-tl border-l-2 border-t-2 border-zenith-cyan/25" />
            <span className="absolute right-0 top-0 h-5 w-5 rounded-tr border-r-2 border-t-2 border-zenith-cyan/25" />
            <span className="absolute bottom-0 left-0 h-5 w-5 rounded-bl border-b-2 border-l-2 border-zenith-cyan/25" />
            <span className="absolute bottom-0 right-0 h-5 w-5 rounded-br border-b-2 border-r-2 border-zenith-cyan/25" />
          </div>

          {mode === "tracker" && (
            <>
              <LockChip lockedId={lockedObjectId} onUnlock={unlock} />

              <FOVPlanner
                open={fovPlannerOpen}
                targetId={lockedObjectId}
                observer={observer}
                onClose={() => setFovPlannerOpen(false)}
              />

              <ClearSkyPlanner
                open={clearSkyOpen}
                observer={observer}
                onClose={() => setClearSkyOpen(false)}
                onTrackPass={(id) => {
                  targetLock(id);
                  setClearSkyOpen(false);
                }}
              />

              <LocationCallout location={pickedLocation} />

              <TimeMachine open={timeMachineOpen} onClose={() => setTimeMachineOpen(false)} />
            </>
          )}

          <AnimatePresence>
            {mode === "tracker" && lockedObjectId && !fovPlannerOpen && (
              <motion.button
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setFovPlannerOpen(true)}
                className="focus-ring absolute bottom-10 right-4 z-10 flex items-center gap-1.5 rounded-full
                           border border-zenith-cyan/40 bg-void/80 px-4 py-2.5 font-mono text-[11px] font-bold
                           tracking-widest text-zenith-cyan shadow-panel backdrop-blur-xl
                           transition-colors hover:bg-zenith-cyan/15 hover:shadow-[0_0_20px_rgba(56,217,255,0.4)]"
              >
                <Frame size={13} /> PLAN SHOT
              </motion.button>
            )}
          </AnimatePresence>

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

      <ObjectModal
        objectId={selectedObjectId}
        lockedId={lockedObjectId}
        onClose={closeModal}
        onTargetLock={lockFromModal}
      />
    </div>
  );
}
