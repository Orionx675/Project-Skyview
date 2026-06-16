// =============================================================================
// lib/tracker.ts — ZenithTracker: the real-time engine, OUTSIDE React
// =============================================================================
// THE architectural answer to "poll live data every second without making the
// page or the Cesium globe stutter":
//
//   React state updates re-render component subtrees. A naive `useState` tick
//   at 1 Hz re-renders the page — including the component that owns a Cesium
//   Viewer — sixty times a minute. Instead, all live data lives in this plain
//   class. Components OPT IN to ticks:
//
//     · TelemetryPanel / HeaderStats / Sidebar subscribe via
//       useSyncExternalStore (hooks/useTracker.tsx) — they re-render at 1 Hz,
//       which is fine: they're a handful of DOM nodes.
//     · page.tsx NEVER subscribes — it re-renders only on user actions.
//     · CesiumGlobe NEVER re-renders from ticks at all. It subscribes
//       imperatively and mutates Cesium entities in place; satellite
//       positions don't even use the tick — they're CallbackProperties that
//       propagate per rendered frame (see CesiumGlobe.tsx).
//
// Two cadences, deliberately separated:
//   SLOW (2 h + on toggle): fetch parsed TLE JSON from /api/tle, compile each
//        TLE into an SGP4 satrec ONCE. Compilation is the expensive step.
//   FAST (1 Hz): propagate every compiled satrec + ephemeris body to "now",
//        publish an immutable snapshot to subscribers.
// =============================================================================

import type { SatRec } from "satellite.js";
import type { Body } from "astronomy-engine";
import { getLookAngles, tleToSatrec } from "@/utils/orbitalMath";
import { getBodySky, SOLAR_SYSTEM_BODIES } from "@/lib/celestialBodies";
import { DATA_LAYERS, type Observer, type TrackedObject } from "@/lib/layers";

/** Telemetry recompute cadence. 1 Hz reads as "live" for LEO objects. */
const TICK_INTERVAL_MS = 1000;
/** TLE re-fetch cadence — elements barely drift inside 2 hours. */
const TLE_REFRESH_MS = 2 * 60 * 60 * 1000;

/** One object in the compiled catalog (static per TLE-sync). */
export interface CatalogEntry {
  id: string;
  name: string;
  layerId: string;
  color: string;
  kind: "satellite" | "planet";
  // -- satellites ----------------------------------------------------------
  satrec?: SatRec;
  noradId?: string;
  line1?: string;
  line2?: string;
  periodMin?: number;
  inclinationDeg?: number;
  eccentricity?: number;
  apogeeKm?: number;
  perigeeKm?: number;
  // -- solar-system bodies ---------------------------------------------------
  body?: Body;
}

/** Immutable per-tick snapshot consumed by useSyncExternalStore. */
export interface TrackerSnapshot {
  objects: TrackedObject[];
  tickTime: Date | null;
  /** Bumped whenever the COMPILED CATALOG changes (layer toggled / TLE sync) —
   *  CesiumGlobe rebuilds entities only when this moves, never per tick. */
  catalogVersion: number;
  loadingLayers: ReadonlySet<string>;
  error: string | null;
  lastTleSync: Date | null;
  overheadCounts: ReadonlyMap<string, number>;
  totalOverhead: number;
}

const EMPTY_SNAPSHOT: TrackerSnapshot = {
  objects: [],
  tickTime: null,
  catalogVersion: 0,
  loadingLayers: new Set(),
  error: null,
  lastTleSync: null,
  overheadCounts: new Map(),
  totalOverhead: 0,
};

/** Shape of /api/tle?format=json entries. */
interface ApiSatellite {
  name: string;
  noradId: string;
  line1: string;
  line2: string;
  periodMin: number;
  inclinationDeg: number;
  eccentricity: number;
  apogeeKm: number;
  perigeeKm: number;
}

export class ZenithTracker {
  private catalogByLayer = new Map<string, CatalogEntry[]>();
  private observer: Observer;
  private enabledLayers = new Set<string>();
  private listeners = new Set<() => void>();
  private snapshot: TrackerSnapshot = EMPTY_SNAPSHOT;

  private catalogVersion = 0;
  private loadingLayers = new Set<string>();
  private error: string | null = null;
  private lastTleSync: Date | null = null;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  // Source of "now" for propagation. Defaults to wall-clock; CesiumGlobe swaps
  // it to read viewer.clock.currentTime so the Cosmic Time Machine (scrubbing
  // the clock) re-plots satellites + planets at any past/future instant.
  private timeProvider: () => Date = () => new Date();

  constructor(initialObserver: Observer) {
    this.observer = initialObserver;
  }

  /** Point propagation at a custom clock (e.g. Cesium's). Re-ticks immediately. */
  setTimeProvider(provider: () => Date): void {
    this.timeProvider = provider;
    this.tick();
  }

  // ------------------------------------------------------------ store API --
  // Arrow properties: stable identities, safe to hand to useSyncExternalStore.

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TrackerSnapshot => this.snapshot;

  getObserver = (): Observer => this.observer;

  /** Static metadata for one object (modal content). */
  getCatalogEntry(id: string): CatalogEntry | null {
    for (const entries of this.catalogByLayer.values()) {
      const hit = entries.find((e) => e.id === id);
      if (hit) return hit;
    }
    return null;
  }

  /** Full compiled catalog — CesiumGlobe builds its entities from this. */
  getCatalog(): CatalogEntry[] {
    return [...this.catalogByLayer.values()].flat();
  }

  // ------------------------------------------------------------ lifecycle --

  /** Idempotent; safe under React Strict Mode's mount/unmount/mount dance. */
  start(): void {
    if (this.tickTimer) return;
    this.tick(); // immediate first publish — no one-second blank UI
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.refreshTimer = setInterval(() => {
      for (const layerId of this.enabledLayers) void this.loadLayer(layerId, true);
    }, TLE_REFRESH_MS);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.tickTimer = null;
    this.refreshTimer = null;
  }

  // -------------------------------------------------------------- inputs --

  setObserver(observer: Observer): void {
    this.observer = observer;
    this.tick(); // re-anchor look angles immediately, not at next interval
  }

  setEnabledLayers(layerIds: Set<string>): void {
    this.enabledLayers = new Set(layerIds);

    // Drop catalogs for layers toggled off…
    let dropped = false;
    for (const key of [...this.catalogByLayer.keys()]) {
      if (!layerIds.has(key)) {
        this.catalogByLayer.delete(key);
        dropped = true;
      }
    }
    if (dropped) this.catalogVersion++;

    // …and load the ones we don't have yet.
    for (const layerId of layerIds) {
      if (!this.catalogByLayer.has(layerId) && !this.loadingLayers.has(layerId)) {
        void this.loadLayer(layerId, false);
      }
    }

    this.tick();
  }

  // ------------------------------------------------------------ slow loop --

  private async loadLayer(layerId: string, isRefresh: boolean): Promise<void> {
    const layer = DATA_LAYERS.find((l) => l.id === layerId);
    if (!layer) return;

    // Solar-system layer: no network, no compilation — instant local catalog.
    if (layer.kind === "planet") {
      this.catalogByLayer.set(
        layerId,
        SOLAR_SYSTEM_BODIES.slice(0, layer.maxObjects).map(({ body, name }) => ({
          id: `${layerId}:${name.toLowerCase()}`,
          name,
          layerId,
          color: layer.color,
          kind: "planet" as const,
          body,
        }))
      );
      this.catalogVersion++;
      this.tick();
      return;
    }

    // Satellite layer: fetch server-parsed JSON, compile satrecs once.
    if (!layer.celestrakGroup) return;
    this.loadingLayers.add(layerId);
    if (!isRefresh) this.tick(); // surface the loading state right away

    try {
      const res = await fetch(
        `/api/tle?group=${layer.celestrakGroup}&format=json&limit=${layer.maxObjects}`
      );
      if (!res.ok) throw new Error(`TLE fetch failed (${res.status})`);
      const payload = (await res.json()) as { satellites: ApiSatellite[] };

      // The layer may have been toggled off while the fetch was in flight.
      if (!this.enabledLayers.has(layerId)) return;

      this.catalogByLayer.set(
        layerId,
        payload.satellites.map((sat) => ({
          id: `${layerId}:${sat.noradId}`,
          name: sat.name,
          layerId,
          color: layer.color,
          kind: "satellite" as const,
          satrec: tleToSatrec(sat.line1, sat.line2),
          noradId: sat.noradId,
          line1: sat.line1,
          line2: sat.line2,
          periodMin: sat.periodMin,
          inclinationDeg: sat.inclinationDeg,
          eccentricity: sat.eccentricity,
          apogeeKm: sat.apogeeKm,
          perigeeKm: sat.perigeeKm,
        }))
      );
      this.catalogVersion++;
      this.lastTleSync = new Date();
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "TLE sync failed";
    } finally {
      this.loadingLayers.delete(layerId);
      this.tick();
    }
  }

  // ------------------------------------------------------------ fast loop --

  private tick(): void {
    const now = this.timeProvider(); // wall-clock, or the scrubbed Cesium clock
    const objects: TrackedObject[] = [];
    const overheadCounts = new Map<string, number>();
    let totalOverhead = 0;

    for (const entries of this.catalogByLayer.values()) {
      for (const entry of entries) {
        let sky: Omit<TrackedObject, "id" | "name" | "layerId" | "color" | "kind"> | null = null;

        if (entry.kind === "satellite" && entry.satrec) {
          sky = getLookAngles(entry.satrec, this.observer, now);
        } else if (entry.kind === "planet" && entry.body) {
          sky = getBodySky(entry.body, this.observer, now);
        }
        if (!sky) continue; // decayed satellite — drop from this tick

        if (sky.aboveHorizon) {
          totalOverhead++;
          overheadCounts.set(entry.layerId, (overheadCounts.get(entry.layerId) ?? 0) + 1);
        }

        objects.push({
          id: entry.id,
          name: entry.name,
          layerId: entry.layerId,
          color: entry.color,
          kind: entry.kind,
          ...sky,
        });
      }
    }

    // Fresh immutable snapshot: useSyncExternalStore compares by identity.
    this.snapshot = {
      objects,
      tickTime: now,
      catalogVersion: this.catalogVersion,
      loadingLayers: new Set(this.loadingLayers),
      error: this.error,
      lastTleSync: this.lastTleSync,
      overheadCounts,
      totalOverhead,
    };

    for (const listener of this.listeners) listener();
  }
}
