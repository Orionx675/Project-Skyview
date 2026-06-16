// =============================================================================
// hooks/useTracker.tsx — React bindings for the ZenithTracker engine
// =============================================================================
// The tracker itself is a plain class (lib/tracker.ts). These hooks are the
// ONLY place React touches it:
//
//   <TrackerProvider>   owns one tracker instance, feeds it observer/layer
//                       changes, starts/stops the tick loop with the tree.
//   useTracker()        the raw instance — for imperative consumers
//                       (CesiumGlobe) and one-shot reads (modal metadata).
//   useTrackerSnapshot()  subscribes via useSyncExternalStore — the component
//                       re-renders once per tick. Use ONLY in small leaves
//                       (telemetry, header stats), never near the globe.
// =============================================================================

"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { ZenithTracker, type TrackerSnapshot } from "@/lib/tracker";
import type { Observer, TrackedObject } from "@/lib/layers";

const TrackerContext = createContext<ZenithTracker | null>(null);

interface TrackerProviderProps {
  observer: Observer;
  enabledLayerIds: Set<string>;
  children: React.ReactNode;
}

export function TrackerProvider({ observer, enabledLayerIds, children }: TrackerProviderProps) {
  // Lazy useState (not useRef) guarantees exactly one instance per mounted
  // tree, created during the first render.
  const [tracker] = useState(() => new ZenithTracker(observer));

  // Tick loop lives and dies with the provider. start()/stop() are idempotent
  // so React Strict Mode's double-invoked effects are harmless.
  useEffect(() => {
    tracker.start();
    return () => tracker.stop();
  }, [tracker]);

  // Push prop changes INTO the engine (one-way data flow: React owns user
  // intent, the tracker owns time).
  useEffect(() => {
    tracker.setObserver(observer);
  }, [tracker, observer]);

  useEffect(() => {
    tracker.setEnabledLayers(enabledLayerIds);
  }, [tracker, enabledLayerIds]);

  return <TrackerContext.Provider value={tracker}>{children}</TrackerContext.Provider>;
}

/** The raw engine. Does NOT subscribe — reading it never causes re-renders. */
export function useTracker(): ZenithTracker {
  const tracker = useContext(TrackerContext);
  if (!tracker) throw new Error("useTracker must be used inside <TrackerProvider>");
  return tracker;
}

/** Live snapshot — re-renders the calling component once per tick (1 Hz). */
export function useTrackerSnapshot(): TrackerSnapshot {
  const tracker = useTracker();
  // subscribe/getSnapshot are stable arrow properties on the class; the third
  // argument serves SSR (the empty pre-start snapshot, hydration-safe).
  return useSyncExternalStore(tracker.subscribe, tracker.getSnapshot, tracker.getSnapshot);
}

/** Live data for a single object (modal use). Null until it exists. */
export function useTrackedObject(id: string | null): TrackedObject | null {
  const snapshot = useTrackerSnapshot();
  if (!id) return null;
  return snapshot.objects.find((o) => o.id === id) ?? null;
}
