// =============================================================================
// app/page.tsx — composition root + responsive view switch
// =============================================================================
// Owns ALL user-intent state (observer, layers, mode, selection, camera lock,
// panel flags, intro phase) and the single <TrackerProvider>, then renders the
// touch-first <MobileView/> below 768px or the desktop <DesktopView/> above it.
// The switch is hydration-safe: useIsMobile is false on the server and the
// first client paint, then flips in an effect (see hooks/useIsMobile.ts).
// =============================================================================

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import IntroOverlay from "@/components/IntroOverlay";
import DesktopView from "@/components/DesktopView";
import MobileView from "@/components/MobileView";
import GlobeFallback from "@/components/GlobeFallback";
import { TrackerProvider } from "@/hooks/useTracker";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DATA_LAYERS, type Observer } from "@/lib/layers";
import type { AppMode, SkyViewProps } from "@/components/skyView";

// Default observer: New Delhi. Replaced the moment the user clicks the globe,
// types coordinates, or grants geolocation — guarantees a meaningful first paint.
const DEFAULT_OBSERVER: Observer = {
  latitude: 28.6139,
  longitude: 77.209,
  label: "New Delhi, IN (default)",
};

export default function DashboardPage() {
  const isMobile = useIsMobile(768);

  // Crossing the breakpoint at runtime (e.g. tablet rotation) swaps which view
  // owns the Cesium viewer. Tearing one viewer down WHILE building the other in
  // the same commit races inside Cesium. So serialize it: when the breakpoint
  // flips, unmount the active view first (radar fallback for a beat → old
  // viewer fully destroyed + async settled), then mount the new one.
  const [activeIsMobile, setActiveIsMobile] = useState(isMobile);
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    if (isMobile === activeIsMobile) return;
    setSwitching(true);
    const t = setTimeout(() => {
      setActiveIsMobile(isMobile);
      setSwitching(false);
    }, 450);
    return () => clearTimeout(t);
  }, [isMobile, activeIsMobile]);

  // --------------------------- user-intent state (NOT live data) -----------
  const [introDone, setIntroDone] = useState(false);
  const [observer, setObserver] = useState<Observer>(DEFAULT_OBSERVER);
  const [locating, setLocating] = useState(false);
  const [enabledLayerIds, setEnabledLayerIds] = useState<Set<string>>(
    () => new Set(DATA_LAYERS.filter((l) => l.defaultEnabled).map((l) => l.id))
  );
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null); // modal
  const [lockedObjectId, setLockedObjectId] = useState<string | null>(null); // camera lock
  const [fovPlannerOpen, setFovPlannerOpen] = useState(false);
  const [clearSkyOpen, setClearSkyOpen] = useState(false);
  const [mode, setMode] = useState<AppMode>("tracker");
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
    setPickedLocation({ latitude, longitude });
  }, []);

  const setCoordinates = useCallback((latitude: number, longitude: number) => {
    setObserver({ latitude, longitude, label: "Manual coordinates" });
    setPickedLocation({ latitude, longitude });
  }, []);

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

  // Highlight + orbit trail follow whichever focus exists; the lock is its own channel.
  const focusObjectId = lockedObjectId ?? selectedObjectId;

  // Single props object handed to whichever view is active.
  const viewProps: SkyViewProps = useMemo(
    () => ({
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
    }),
    [
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
    ]
  );

  return (
    <TrackerProvider observer={observer} enabledLayerIds={enabledLayerIds}>
      {/* Boot sequence — the active view mounts underneath it. */}
      <AnimatePresence>
        {!introDone && <IntroOverlay key="intro" onComplete={finishIntro} />}
      </AnimatePresence>

      {switching ? (
        <div className="fixed inset-0 bg-void">
          <GlobeFallback />
        </div>
      ) : activeIsMobile ? (
        <MobileView {...viewProps} />
      ) : (
        <DesktopView {...viewProps} />
      )}
    </TrackerProvider>
  );
}
