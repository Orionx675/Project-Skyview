// =============================================================================
// components/skyView.ts — shared props contract for Desktop & Mobile views
// =============================================================================
// page.tsx owns ALL user-intent state + the single <TrackerProvider>, then
// hands this one object to whichever view is active. Keeping the contract in
// one place means the two view trees stay interchangeable.
// =============================================================================

import type { Observer } from "@/lib/layers";

export type AppMode = "tracker" | "regalia";

export interface SkyViewProps {
  // ---- state ----
  introDone: boolean;
  observer: Observer;
  locating: boolean;
  enabledLayerIds: Set<string>;
  selectedObjectId: string | null; // object-detail modal
  lockedObjectId: string | null; // camera target lock
  focusObjectId: string | null; // lock ?? selection (highlight + trail)
  fovPlannerOpen: boolean;
  clearSkyOpen: boolean;
  timeMachineOpen: boolean;
  mode: AppMode;
  pickedLocation: { latitude: number; longitude: number } | null;

  // ---- actions ----
  setMode: (mode: AppMode) => void;
  toggleLayer: (layerId: string) => void;
  selectLocation: (latitude: number, longitude: number) => void;
  setCoordinates: (latitude: number, longitude: number) => void;
  inspectObject: (id: string) => void;
  closeModal: () => void;
  targetLock: (id: string) => void;
  unlock: () => void;
  lockFromModal: (id: string) => void;
  useMyLocation: () => void;
  setFovPlannerOpen: (open: boolean) => void;
  setClearSkyOpen: (open: boolean) => void;
  setTimeMachineOpen: (open: boolean) => void;
}
