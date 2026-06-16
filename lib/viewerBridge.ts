// =============================================================================
// lib/viewerBridge.ts — shared handle to the live Cesium Viewer
// =============================================================================
// CesiumGlobe owns the Viewer, but features like the FOV planner need to add
// their own entities and steer the camera. Importing "cesium" statically in
// those features would drag ~3 MB into the initial page bundle — so the globe
// registers BOTH its viewer and the already-loaded Cesium module here, and
// consumers pick them up via useSyncExternalStore.
// =============================================================================

"use client";

import { useSyncExternalStore } from "react";
import type { Viewer } from "cesium";

export interface ViewerBridge {
  viewer: Viewer;
  Cesium: typeof import("cesium");
}

let current: ViewerBridge | null = null;
const listeners = new Set<() => void>();

export function registerViewerBridge(bridge: ViewerBridge | null): void {
  current = bridge;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => current;
const getServerSnapshot = () => null;

/** The live viewer (null until the globe has booted). Re-renders on changes. */
export function useViewerBridge(): ViewerBridge | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
