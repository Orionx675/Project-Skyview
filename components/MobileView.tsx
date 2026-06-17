// =============================================================================
// components/MobileView.tsx — mobile-first UI (< 768px)
// =============================================================================
// A completely separate, touch-optimized shell that reuses the SAME engine and
// feature components as desktop (CesiumGlobe, RegaliaTab, ObjectModal, the
// planners, TimeMachine). The whole screen is the globe; controls live in a
// bottom sheet, navigation in a sticky bottom bar, and telemetry in an
// expandable pill — so persistent chrome is minimal. Includes a DeviceOrientation
// "Magic Window" mode that steers the camera as you move the phone.
// =============================================================================

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import {
  Menu,
  X,
  Compass,
  SatelliteDish,
  Sparkles,
  Clock,
  MapPin,
  Telescope,
  ChevronUp,
  Crosshair,
} from "lucide-react";
import GlobeFallback from "@/components/GlobeFallback";
import LockChip from "@/components/LockChip";
import RegaliaTab from "@/components/RegaliaTab";
import ObjectModal from "@/components/ObjectModal";
import FOVPlanner from "@/components/FOVPlanner";
import ClearSkyPlanner from "@/components/ClearSkyPlanner";
import LocationCallout from "@/components/LocationCallout";
import TimeMachine from "@/components/TimeMachine";
import SearchBar from "@/components/SearchBar";
import ToggleSwitch from "@/components/ui/ToggleSwitch";
import { useTrackerSnapshot } from "@/hooks/useTracker";
import { useViewerBridge } from "@/lib/viewerBridge";
import { azimuthToCompass } from "@/utils/orbitalMath";
import { DATA_LAYERS, type Observer } from "@/lib/layers";
import type { SkyViewProps } from "@/components/skyView";

const CesiumGlobe = dynamic(() => import("@/components/CesiumGlobe"), {
  ssr: false,
  loading: () => <GlobeFallback />,
});

export default function MobileView(props: SkyViewProps) {
  const {
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
    setMode,
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

  const [sheetOpen, setSheetOpen] = useState(false);
  const [magicOn, setMagicOn] = useState(false);

  // Magic Window (gyro) belongs ONLY to the FOV viewfinder — it must never
  // hijack the free globe view (disorienting + fights globe gestures). It is
  // active only while the shot planner is open, and the toggle is hidden
  // otherwise. Leaving the FOV view resets it.
  const fovView = fovPlannerOpen;
  const magicActive = magicOn && fovView;
  useMagicWindow(magicActive);
  useEffect(() => {
    if (!fovView && magicOn) setMagicOn(false);
  }, [fovView, magicOn]);

  // A full-width bottom sheet is up — hide the bottom-anchored pill/FAB/PLAN
  // so nothing stacks behind it.
  const bottomSheetOpen = fovPlannerOpen || clearSkyOpen || timeMachineOpen || sheetOpen;

  const toggleMagic = async () => {
    if (magicOn) {
      setMagicOn(false);
      return;
    }
    // iOS 13+ gates the sensor behind an explicit, gesture-triggered prompt.
    const DOE = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        if ((await DOE.requestPermission()) !== "granted") return;
      } catch {
        return;
      }
    }
    setMagicOn(true);
  };

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-void">
      {/* ===================== full-screen globe ===================== */}
      <CesiumGlobe
        observer={observer}
        selectedObjectId={focusObjectId}
        trackedObjectId={lockedObjectId}
        cameraSuppressed={fovPlannerOpen}
        regaliaActive={mode === "regalia"}
        onSelectLocation={selectLocation}
        onInspectObject={inspectObject}
      />

      {/* Regalia planetarium overlay (panels render themselves) */}
      <RegaliaTab active={mode === "regalia"} observer={observer} />

      {/* ===================== condensed header ===================== */}
      <header className="absolute inset-x-0 top-0 z-30 flex h-12 items-center justify-between gap-2 border-b border-grid bg-panel/80 px-3 backdrop-blur-md">
        <span className="flex items-center gap-1.5">
          <span className="pulse-live h-1.5 w-1.5 rounded-full bg-signal" />
          <span className="text-sm font-bold tracking-tight text-starlight">SkyView</span>
        </span>
        <div className="flex items-center gap-1.5">
          {/* Magic Window toggle — only in the FOV viewfinder, never in globe view */}
          {fovView && (
            <button
              onClick={toggleMagic}
              aria-pressed={magicOn}
              aria-label="Magic Window (device orientation)"
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 transition-colors ${
                magicActive
                  ? "border-zenith-cyan/60 bg-zenith-cyan/15 text-zenith-cyan"
                  : "border-grid text-stardust"
              }`}
            >
              <Compass size={16} />
              <span className="font-mono text-[10px] font-bold tracking-wider">GYRO</span>
            </button>
          )}
          {/* Burger → controls sheet */}
          <button
            onClick={() => setSheetOpen(true)}
            aria-label="Open controls"
            className="grid h-9 w-9 place-items-center rounded-lg border border-grid text-starlight active:bg-panel-raised"
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      {/* lock chip (tracker) */}
      {mode === "tracker" && <LockChip lockedId={lockedObjectId} onUnlock={unlock} />}

      {/* expandable telemetry pill — hidden when a bottom sheet is up so they
          don't stack at the same bottom anchor. */}
      {mode === "tracker" && !bottomSheetOpen && <TelemetryPill onInspect={inspectObject} />}

      {/* shared feature overlays (retained on mobile) */}
      {mode === "tracker" && (
        <>
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

      {/* FAB: open controls (alternative to the burger). Tracker mode only,
          and hidden while a bottom sheet occupies the same anchor. */}
      {mode === "tracker" && !bottomSheetOpen && (
        <button
          onClick={() => setSheetOpen(true)}
          aria-label="Open controls"
          className="absolute bottom-20 right-4 z-30 grid h-13 w-13 place-items-center rounded-full
                     border border-zenith-cyan/40 bg-zenith-cyan/15 p-3.5 text-zenith-cyan shadow-lg
                     shadow-black/50 backdrop-blur-md active:scale-95"
        >
          <Crosshair size={20} />
        </button>
      )}

      {/* PLAN SHOT (mobile) when a target is locked */}
      <AnimatePresence>
        {mode === "tracker" && lockedObjectId && !bottomSheetOpen && (
          <motion.button
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            onClick={() => setFovPlannerOpen(true)}
            className="absolute bottom-36 right-4 z-30 rounded-full border border-aurora/50 bg-panel/90
                       px-3 py-2 font-mono text-[10px] font-bold tracking-widest text-aurora
                       shadow-lg shadow-black/40 backdrop-blur-md active:scale-95"
          >
            ◱ PLAN
          </motion.button>
        )}
      </AnimatePresence>

      {/* ===================== controls bottom sheet ===================== */}
      <ControlsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        observer={observer}
        locating={locating}
        enabledLayerIds={enabledLayerIds}
        toggleLayer={toggleLayer}
        setCoordinates={setCoordinates}
        useMyLocation={useMyLocation}
        targetLock={targetLock}
        openClearSky={() => {
          setClearSkyOpen(true);
          setSheetOpen(false);
        }}
      />

      {/* ===================== sticky bottom navigation ===================== */}
      <nav className="absolute inset-x-0 bottom-0 z-30 grid h-16 grid-cols-3 border-t border-grid bg-panel/90 backdrop-blur-md">
        <NavTab
          label="Tracker"
          active={mode === "tracker"}
          accent="#2dd4ff"
          onClick={() => setMode("tracker")}
          Icon={SatelliteDish}
        />
        <NavTab
          label="Regalia"
          active={mode === "regalia"}
          accent="#a78bfa"
          onClick={() => setMode("regalia")}
          Icon={Sparkles}
        />
        <NavTab
          label="Time"
          active={timeMachineOpen}
          accent="#fbbf24"
          onClick={() => setTimeMachineOpen(!timeMachineOpen)}
          Icon={Clock}
        />
      </nav>

      {/* object detail modal (centered, responsive) */}
      <ObjectModal
        objectId={selectedObjectId}
        lockedId={lockedObjectId}
        onClose={closeModal}
        onTargetLock={lockFromModal}
      />
    </div>
  );
}

/* ----------------------------- bottom nav tab ---------------------------- */

function NavTab({
  label,
  active,
  accent,
  onClick,
  Icon,
}: {
  label: string;
  active: boolean;
  accent: string;
  onClick: () => void;
  Icon: typeof Clock;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="flex flex-col items-center justify-center gap-1 transition-colors active:bg-panel-raised"
      style={{ color: active ? accent : "var(--color-stardust)" }}
    >
      <Icon size={20} />
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">{label}</span>
    </button>
  );
}

/* --------------------------- telemetry pill ------------------------------ */

function TelemetryPill({ onInspect }: { onInspect: (id: string) => void }) {
  const { objects } = useTrackerSnapshot();
  const [expanded, setExpanded] = useState(false);

  const focus = useMemo(() => {
    if (objects.length === 0) return null;
    return (
      objects.find((o) => o.name.toUpperCase().includes("ISS")) ??
      [...objects].sort((a, b) => a.degreesFromZenith - b.degreesFromZenith)[0]
    );
  }, [objects]);

  if (!focus) return null;

  return (
    <div className="absolute bottom-20 left-3 z-30 w-56">
      <motion.button
        layout
        onClick={() => setExpanded((v) => !v)}
        className="w-full overflow-hidden rounded-2xl border border-grid bg-panel/90 text-left shadow-lg shadow-black/40 backdrop-blur-md"
      >
        {/* collapsed pill row */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${focus.aboveHorizon ? "bg-signal" : "bg-alert"}`}
          />
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-starlight">
            {focus.name}
          </span>
          <span className="font-mono text-[11px] text-zenith-cyan">{focus.altitude.toFixed(0)}°</span>
          <ChevronUp
            size={14}
            className={`shrink-0 text-faint transition-transform ${expanded ? "" : "rotate-180"}`}
          />
        </div>

        {/* expanded stats */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-grid"
            >
              <div className="grid grid-cols-2 gap-px bg-grid">
                <Stat label="ALT" value={`${focus.altitude.toFixed(1)}°`} />
                <Stat label="AZ" value={`${focus.azimuth.toFixed(0)}° ${azimuthToCompass(focus.azimuth)}`} />
                <Stat label="RANGE" value={`${Math.round(focus.rangeKm).toLocaleString()} km`} />
                <Stat label="FROM ZENITH" value={`${focus.degreesFromZenith.toFixed(0)}°`} />
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onInspect(focus.id);
                }}
                className="w-full bg-panel py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-zenith-cyan"
              >
                Inspect ↗
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-faint">{label}</p>
      <p className="mt-0.5 font-mono text-xs font-semibold text-starlight">{value}</p>
    </div>
  );
}

/* --------------------------- controls sheet ------------------------------ */

function ControlsSheet({
  open,
  onClose,
  observer,
  locating,
  enabledLayerIds,
  toggleLayer,
  setCoordinates,
  useMyLocation,
  targetLock,
  openClearSky,
}: {
  open: boolean;
  onClose: () => void;
  observer: Observer;
  locating: boolean;
  enabledLayerIds: Set<string>;
  toggleLayer: (id: string) => void;
  setCoordinates: (lat: number, lon: number) => void;
  useMyLocation: () => void;
  targetLock: (id: string) => void;
  openClearSky: () => void;
}) {
  const [lat, setLat] = useState(observer.latitude.toFixed(4));
  const [lon, setLon] = useState(observer.longitude.toFixed(4));
  useEffect(() => {
    setLat(observer.latitude.toFixed(4));
    setLon(observer.longitude.toFixed(4));
  }, [observer.latitude, observer.longitude]);

  const latN = Number(lat);
  const lonN = Number(lon);
  const valid =
    lat.trim() !== "" &&
    lon.trim() !== "" &&
    Number.isFinite(latN) &&
    Number.isFinite(lonN) &&
    Math.abs(latN) <= 90 &&
    Math.abs(lonN) <= 180;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-void/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 36 }}
            className="scrollbar-thin absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl
                       border-t border-grid bg-panel/95 pb-8 backdrop-blur-md"
          >
            {/* drag handle + header */}
            <div className="sticky top-0 z-10 bg-panel/95 px-5 pt-3 backdrop-blur">
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-grid" />
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold tracking-tight text-starlight">Controls</h2>
                <button
                  onClick={onClose}
                  aria-label="Close controls"
                  className="grid h-8 w-8 place-items-center rounded-lg text-stardust active:bg-panel-raised"
                >
                  <X size={18} />
                </button>
              </div>
              <SearchBar onTargetLock={(id) => { targetLock(id); onClose(); }} />
            </div>

            <div className="space-y-5 px-5 pt-4">
              {/* observer position — touch-optimized */}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-stardust">
                  <MapPin size={12} /> Observer Position
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] text-faint">LATITUDE</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.0001"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      aria-label="Latitude"
                      className="h-12 w-full rounded-xl border border-grid bg-void/60 px-3 font-mono text-base
                                 text-zenith-cyan focus:border-zenith-cyan/60 focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] text-faint">LONGITUDE</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.0001"
                      value={lon}
                      onChange={(e) => setLon(e.target.value)}
                      aria-label="Longitude"
                      className="h-12 w-full rounded-xl border border-grid bg-void/60 px-3 font-mono text-base
                                 text-zenith-cyan focus:border-zenith-cyan/60 focus:outline-none"
                    />
                  </label>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button
                    disabled={!valid}
                    onClick={() => {
                      if (valid) {
                        setCoordinates(latN, lonN);
                        onClose();
                      }
                    }}
                    className="h-12 rounded-xl border border-zenith-cyan/40 bg-zenith-cyan/10 font-mono
                               text-xs font-bold uppercase tracking-wider text-zenith-cyan
                               active:bg-zenith-cyan/20 disabled:opacity-40"
                  >
                    ⌖ Go
                  </button>
                  <button
                    disabled={locating}
                    onClick={useMyLocation}
                    className="h-12 rounded-xl border border-grid font-mono text-xs font-bold uppercase
                               tracking-wider text-stardust active:bg-panel-raised disabled:opacity-50"
                  >
                    {locating ? "Locating…" : "◎ My location"}
                  </button>
                </div>
                {observer.label && (
                  <p className="mt-2 truncate text-xs text-stardust">{observer.label}</p>
                )}
              </section>

              {/* data layers (incl. Solar System) */}
              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-stardust">
                  Data Layers
                </h3>
                <ul className="space-y-2">
                  {DATA_LAYERS.map((layer) => (
                    <li
                      key={layer.id}
                      className="flex items-center gap-3 rounded-xl border border-grid bg-void/40 p-3"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: layer.color, boxShadow: `0 0 8px ${layer.color}66` }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-starlight">{layer.label}</span>
                        <span className="block truncate text-[11px] text-faint">{layer.description}</span>
                      </span>
                      <ToggleSwitch
                        checked={enabledLayerIds.has(layer.id)}
                        color={layer.color}
                        label={`${layer.label} layer`}
                        onChange={() => toggleLayer(layer.id)}
                      />
                    </li>
                  ))}
                </ul>
              </section>

              {/* Clear Sky launcher (feature retained on mobile) */}
              <button
                onClick={openClearSky}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-grid
                           font-mono text-xs font-bold uppercase tracking-wider text-stardust active:bg-panel-raised"
              >
                <Telescope size={15} /> Clear Sky Planner
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* --------------------------- magic window hook --------------------------- */

/** Steer the Cesium camera from the phone's DeviceOrientation (alpha→heading,
 *  beta→pitch) while enabled. Position is held; only the look direction moves. */
function useMagicWindow(enabled: boolean) {
  const bridge = useViewerBridge();
  const latest = useRef<{ alpha: number | null; beta: number | null } | null>(null);

  useEffect(() => {
    if (!enabled || !bridge) return;
    const { viewer, Cesium } = bridge;

    const onOrient = (e: DeviceOrientationEvent) => {
      latest.current = { alpha: e.alpha, beta: e.beta };
    };
    window.addEventListener("deviceorientation", onOrient, true);

    const remove = viewer.scene.preRender.addEventListener(() => {
      const o = latest.current;
      if (!o || o.alpha == null || o.beta == null || viewer.isDestroyed()) return;
      const heading = Cesium.Math.toRadians(o.alpha);
      const pitch = Cesium.Math.toRadians(Math.max(-85, Math.min(85, o.beta - 90)));
      viewer.camera.setView({
        destination: Cesium.Cartesian3.clone(viewer.camera.positionWC, new Cesium.Cartesian3()),
        orientation: { heading, pitch, roll: 0 },
      });
    });

    return () => {
      window.removeEventListener("deviceorientation", onOrient, true);
      remove();
    };
  }, [enabled, bridge]);
}
